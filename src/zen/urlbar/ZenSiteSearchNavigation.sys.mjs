/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { collapseSiteSearchWhitespace } from "./ZenSiteSearchTerms.sys.mjs";

const f32 = Math.fround;
const DAY = 86400000;
const BUCKETS = [[0, 550], [1, 625], [9, 1300], [90, 1399]];
const TOPICALITY = Array.from({ length: 30 }, (_, n) =>
  f32(n < 10 ? 0.1 * n : 1 + 2.25 * Math.log10(0.1 * n)));

/** Chromium's ICU tailoring breaks hostnames and email addresses into words.
 * The omnibox then splits ASCII digit runs and underscores. Keep UTF-16 offsets:
 * these are used against URL component and match offsets, not code-point counts.
 */
export function siteSearchNavigationWords(locale) {
  const segmenter = new Intl.Segmenter(locale, { granularity: "word" });
  return text => {
    const tailored = text.replace(/@|[.\uff0e]/gu, (character, at) =>
      character !== "@" && /\p{Decimal_Number}/u.test(text[at - 1] ?? "") &&
        /\p{Decimal_Number}/u.test(text[at + 1] ?? "") ? character : " ");
    const words = [];
    for (const part of segmenter.segment(tailored)) {
      if (!part.isWordLike) continue;
      const original = text.slice(part.index, part.index + part.segment.length);
      for (const match of original.matchAll(/[0-9]+|[^0-9_]+/g)) {
        words.push({ text: match[0], index: part.index + match.index });
      }
    }
    return words;
  };
}

function unescape(text) {
  return text.replace(/(?:%[0-9a-f]{2})+/gi, escaped => {
    try { return decodeURIComponent(escaped); } catch { return escaped; }
  });
}

function prepare(row, words, locale, displayHost, variants) {
  let uri;
  try { uri = new URL(row.url); } catch { return null; }
  if (!/^https?:$/.test(uri.protocol)) return null;
  uri.username = "";
  uri.password = "";
  // Compute components before unescaping: an escaped slash/question mark is
  // text within its original component, never a new component boundary.
  const host = uri.protocol.length + 2;
  const path = host + uri.host.length;
  const query = path + uri.pathname.length;
  const display = displayHost(uri.hostname);
  const clean = value => unescape(value).toLocaleLowerCase(locale);
  const hostDelta = clean(display).length - uri.hostname.length;
  const adjust = at => clean(uri.href.slice(0, at)).length + (at >= path ? hostDelta : 0);
  const raw = uri.href.slice(0, 1024).replace(/%(?:[0-9a-f]?)$/i, "");
  const url = clean(raw.slice(0, host) + display + raw.slice(host + uri.hostname.length));
  const title = String(row.title ?? "").slice(0, 1024).toLocaleLowerCase(locale);
  // Reject impossible matches before allocating ICU word segments. Histories
  // typically contain many pages for a keyword but few for the typed terms.
  if (!variants.some(variant => variant.queryWords.every(word => url.includes(word) || title.includes(word))))
    return null;
  const urlWords = words(url), titleWords = words(title);
  return { row, url, title, host: adjust(host), path: adjust(path), query: adjust(query),
    lastDot: display.includes(".") ? adjust(host) + clean(display).lastIndexOf(".") : Infinity,
    hostname: uri.hostname,
    hostOnly: uri.pathname === "/" && !uri.search && !uri.hash,
    urlStarts: urlWords.filter(w => w.index < 200).map(w => w.index),
    titleStarts: titleWords.filter(w => w.index < 200).map(w => w.index),
    indexedWords: [...urlWords, ...titleWords].map(w => w.text.slice(0, 200)) };
}

function occurrences(text, terms) {
  return terms.flatMap((term, i) => {
    const matches = [];
    // Overlapping occurrences count independently until after scoring.
    for (let at = text.indexOf(term); at >= 0; at = text.indexOf(term, at + 1))
      matches.push({ at, end: at + term.length, i });
    return matches;
  }).sort((a, b) => a.at - b.at || b.end - a.end);
}

function filterMatches(matches, offsets, starts, begin = 0, end = Infinity) {
  let previousEnd = 0;
  const boundaries = new Set(starts);
  return matches.filter(match => {
    if (match.at < begin || match.at >= end || boundaries.has(match.at + offsets[match.i]) ||
        offsets[match.i] === match.end - match.at || match.at === previousEnd) {
      previousEnd = match.end;
      return true;
    }
    return false;
  });
}

function topicality(item, terms, offsets) {
  const urlMatches = occurrences(item.url, terms), titleMatches = occurrences(item.title, terms);
  if (terms.some((_, i) => !urlMatches.some(m => m.i === i) && !titleMatches.some(m => m.i === i)))
    return 0;
  const points = terms.map(() => 0), boundaries = new Set(item.urlStarts);
  for (const match of filterMatches(
    filterMatches(urlMatches, offsets, item.urlStarts, item.path),
    offsets, item.urlStarts, 0, item.host)) {
    const at = match.at + offsets[match.i];
    points[match.i] += at >= item.query ? 5 : at >= item.path ? 8 :
      at >= item.host && at < item.lastDot ? (boundaries.has(at) ? 10 : 2) : 0;
  }
  for (const match of filterMatches(titleMatches, offsets, item.titleStarts)) {
    const at = match.at + offsets[match.i];
    if (item.titleStarts.filter(start => start < at).length >= 20) break;
    points[match.i] += 8;
  }
  const value = f32(points.reduce((sum, n) => f32(sum + TOPICALITY[Math.min(29, n)]), 0) / terms.length);
  return value < 0.5 ? 0 : value;
}

/** Select candidates before fetching individual visits. Each cursor variant has
 * its own 500-row pool and host count. Even a row later rejected by raw terms
 * contributes to that count; counting just scored results changes relevance.
 * Caller supplies visible history excluding its default engine's search URLs.
 */
export function prepareSiteSearchNavigation(rows, input, {
  locale, cursorPosition = input.length, displayHost = host => host,
} = {}) {
  const words = siteSearchNavigationWords(locale);
  const inputs = [input];
  if (cursorPosition > 0 && cursorPosition < input.length)
    inputs.push(input.slice(0, cursorPosition) + " " + input.slice(cursorPosition));
  const seen = new Set(), results = [], variants = [];
  for (const variant of inputs) {
    const lower = variant.toLocaleLowerCase(locale);
    const queryWords = words(unescape(lower)).map(w => w.text);
    const key = JSON.stringify(queryWords);
    if (!queryWords.length || seen.has(key)) continue;
    seen.add(key);
    variants.push({ lower, queryWords });
  }
  if (!variants.length) return [];
  const prepared = rows.map(row => prepare(row, words, locale, displayHost, variants)).filter(Boolean);
  for (const { lower, queryWords } of variants) {
    const pool = prepared.filter(item => queryWords.every(word =>
      item.indexedWords.some(candidate => candidate.includes(word))))
      .sort((a, b) => (b.row.typedCount ?? 0) - (a.row.typedCount ?? 0) ||
        b.row.visitCount - a.row.visitCount || b.row.lastVisit - a.row.lastVisit).slice(0, 500);
    const hosts = new Set(pool.map(item => item.hostname)).size;
    const specificity = [3, 3, 2.5, 2, 1.5][Math.min(4, hosts)];
    const terms = collapseSiteSearchWhitespace(lower).split(" ").filter(Boolean);
    if (!terms.length) continue;
    const offsets = terms.map(term => words(term)[0]?.index ?? term.length);
    for (const item of pool) {
      const value = topicality(item, terms, offsets);
      if (value) results.push({ ...item, topicality: value, specificity });
    }
  }
  return results;
}

export function siteSearchVisitRecency(days) {
  const d = Math.max(0, Math.min(365, Math.trunc(days)));
  const value = d <= 4 ? 100 : d <= 14 ? 70 + Math.trunc((14 - d) * 30 / 10) :
    d <= 31 ? 50 + Math.trunc((31 - d) * 20 / 17) :
    d <= 90 ? 30 + Math.trunc((90 - d) * 20 / 60) :
    10 + Math.trunc((365 - d) * 10 / 275);
  return f32(value / 100);
}

function relevance(item, now) {
  const frequency = (item.row.visits ?? []).slice(0, 10).reduce((sum, visit) =>
    f32(sum + f32(Math.max(visit.typed ? 1.5 : 1, item.row.bookmarked ? 10 : 0) *
      siteSearchVisitRecency((now - visit.date) / DAY))), 0);
  const intermediate = f32(f32(item.topicality * frequency) * item.specificity);
  for (let i = 1; i < BUCKETS.length; ++i) {
    const [x, y] = BUCKETS[i], [previousX, previousY] = BUCKETS[i - 1];
    if (intermediate < x) return Math.trunc(f32(previousY +
      f32(f32((y - previousY) / (x - previousX)) * f32(intermediate - previousX))));
  }
  return BUCKETS.at(-1)[1];
}

/** Navigation relevance is distinct from SearchProvider's history relevance.
 * Keep seven keyword-mode matches with strictly descending integer scores.
 * Multiple cursor passes identify one URL record, not independent suggestions.
 */
export function rankSiteSearchNavigation(items, { now = Date.now(), limit = 7 } = {}) {
  if (limit <= 0) return [];
  const scored = items.map(item => ({ ...item, relevance: relevance(item, now) })).sort((a, b) =>
    b.relevance - a.relevance || (b.row.typedCount ?? 0) - (a.row.typedCount ?? 0) ||
    (a.row.typedCount === 1 ? Number(b.hostOnly) - Number(a.hostOnly) : 0) ||
    b.row.visitCount - a.row.visitCount || b.row.lastVisit - a.row.lastVisit);
  const seen = new Set(), results = [];
  let ceiling = Infinity;
  for (const item of scored) {
    const key = item.row.id ?? item.row.url;
    if (seen.has(key)) continue;
    seen.add(key);
    ceiling = Math.min(item.relevance, ceiling - 1);
    results.push({ ...item.row, relevance: ceiling });
    if (results.length >= limit) break;
  }
  return results;
}
