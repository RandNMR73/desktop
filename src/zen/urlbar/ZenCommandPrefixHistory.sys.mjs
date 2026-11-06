/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const DAY = 86400000;
export const COMMAND_URL_PREFIXES = Object.freeze([
  ["http://www.", 2], ["https://www.", 2], ["ftp://www.", 2],
  ["http://", 1], ["https://", 1], ["ftp://", 1], ["", 0],
].map(Object.freeze));
const TYPED_BUCKETS = [[1, 1413], [0.97, 1390], [0.93, 1360], [0.85, 1340],
  [0.72, 1320], [0.5, 1250], [0, 1203]];
const VISIT_BUCKETS = [[4, 790], [0.5, 590], [0, 100]];
const compareURL = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const byDatabaseRank = (a, b) => b.typedCount - a.typedCount ||
  b.visitCount - a.visitCount || b.lastVisit - a.lastVisit;

function hostOnly(row) {
  try {
    const url = new URL(row.url);
    return url.pathname === "/" && !url.search && !url.hash;
  } catch { return false; }
}

function canInline(row) {
  return row.typedCount > 0 && (row.typedCount > 1 || hostOnly(row));
}

function compareMatches(a, b) {
  return Number(b.row.typedCount > 0) - Number(a.row.typedCount > 0) ||
    Number(b.innermost) - Number(a.innermost) || b.row.typedCount - a.row.typedCount ||
    (a.row.typedCount === 1 ? Number(hostOnly(b.row)) - Number(hostOnly(a.row)) : 0) ||
    b.row.visitCount - a.row.visitCount || b.row.lastVisit - a.row.lastVisit ||
    compareURL(b.row.url, a.row.url);
}

function demote(row, score, now) {
  const decay = Math.pow(2, -Math.max(0, now - row.lastVisit) / (30 * DAY));
  score = Math.min(score, TYPED_BUCKETS.find(([count]) => row.typedCount * decay >= count)[1]);
  if (!row.typedCount)
    score = Math.min(score, VISIT_BUCKETS.find(([count]) => row.visitCount * decay >= count)[1]);
  return score;
}

function promote(matches, row, template, toFront) {
  const existing = matches.findIndex(match => match.row.url === row.url);
  if (existing >= 0) {
    if (toFront) matches.unshift(...matches.splice(existing, 1));
  } else {
    const match = { ...template, row };
    if (toFront) matches.unshift(match);
    else matches.push(match);
  }
}

function removeRedirectDuplicates(matches, redirects, maximum) {
  // Only inspect chains whose source survives the provider limit. A later
  // source may point back to a better match, which must remain in place.
  for (let source = 0; source < matches.length && source < maximum;) {
    const url = matches[source].row.url;
    const chain = redirects.get(url);
    if (!chain?.length) { source++; continue; }
    const urls = new Set([url, ...chain]);
    let first = true, next = source + 1;
    for (let index = 0; index < matches.length;) {
      if (!urls.has(matches[index].row.url)) { index++; continue; }
      if (first) { first = false; index++; continue; }
      matches.splice(index, 1);
      if (index < next) next--;
    }
    source = next;
  }
  matches.length = Math.min(matches.length, maximum);
}

/** HistoryURL's two passes, before cross-provider deduplication and culling.
 * `text` is the input AFTER browser URL fixup, with its original slash count;
 * `canonicalize` must implement that browser's URL interpretation. Keep this
 * boundary explicit: URL parsing cannot be replaced by a hostname substring.
 * `rows` contains prefix candidates plus exact/shorter URL lookup records.
 * The database adapter must apply its indexed prefix limit before significance
 * filtering, and supply redirect chains for the asynchronous pass.
 *
 * Follows HistoryURLProvider in Chromium 156.0.8078.74 with Arc's observed
 * significance policy: one typed visit, two ordinary visits, or a visit in the
 * last 90 days. The first pass can only see typed URLs. The final pass preserves
 * its promotion decision when an untyped exact URL becomes visible, to avoid
 * changing inline completion.
 */
export function commandPrefixHistory(rows, {
  text, canonicalize, now = Date.now(), limit = 3,
  allowWhatYouTyped = false, preventInline = false,
  exclude = () => false, redirects = new Map(), intranetURL = null,
}) {
  if (!text || limit <= 0) return { initial: [], final: [] };
  const canonical = canonicalize(text);
  const whatURL = canonical?.url;
  const visible = rows.filter(row => !row.hidden);

  function pass(typedOnly, previousPromotion) {
    const available = typedOnly ? visible.filter(row => row.typedCount > 0) : visible;
    const lookup = new Map(available.map(row => [row.url, row]));
    let matches = [];
    for (const [prefix, components] of COMMAND_URL_PREFIXES) {
      const found = available.filter(row => row.url.startsWith(prefix + text))
        .sort(byDatabaseRank).slice(0, limit * 2);
      for (const row of found) {
        if (exclude(row.url) || !(row.typedCount >= 1 || row.visitCount >= 2 ||
            row.lastVisit >= now - 90 * DAY)) continue;
        const bestPrefix = COMMAND_URL_PREFIXES.find(([value]) => row.url.startsWith(value));
        matches.push({ row, offset: prefix.length, innermost: components >= bestPrefix[1] });
      }
    }
    matches.sort(compareMatches);
    const seen = new Set();
    matches = matches.filter(match => {
      if (seen.has(match.row.url)) return false;
      seen.add(match.row.url);
      return true;
    });

    // Promote a sufficiently visited shorter prefix, or synthesize the host
    // only when it is distinct from the what-you-typed suggestion.
    let shorterInline = false;
    if (matches.length) {
      const best = matches[0];
      let base;
      try {
        const url = new URL(best.row.url);
        if (["http:", "https:", "ftp:"].includes(url.protocol)) {
          url.pathname = "/"; url.search = ""; url.hash = "";
          if (url.href.slice(best.offset, best.offset + text.length) === text) base = url.href;
        }
      } catch { /* Non-authority URLs cannot be shortened to a host. */ }
      let mayAddBase = !allowWhatYouTyped;
      if (base) mayAddBase ||= base !== whatURL;
      else base = canonicalize(best.row.url.slice(0, best.offset + text.length))?.url;
      if (base && base !== best.row.url) {
        const minimumVisits = Math.ceil(best.row.visitCount / 3);
        const minimumTyped = best.row.typedCount ? 1 : 0;
        let shorter = available.filter(row => (mayAddBase ? row.url >= base : row.url > base) &&
          row.url < best.row.url && best.row.url.startsWith(row.url) &&
          row.visitCount >= minimumVisits && row.typedCount >= minimumTyped)
          .sort((a, b) => compareURL(a.url, b.url))[0];
        let toFront = true;
        if (!shorter && mayAddBase) {
          shorter = lookup.get(base) ?? { url: base, typedCount: 0, visitCount: 0, lastVisit: 0 };
          toFront = best.row.typedCount <= 1;
        }
        if (shorter) {
          shorterInline = toFront && canInline(best.row);
          promote(matches, shorter, best, toFront);
        }
      }
    }

    let exact = null;
    if (whatURL && !canonical.hasCredentials && previousPromotion !== "front") {
      for (const [prefix] of [...COMMAND_URL_PREFIXES].reverse()) {
        const parsed = canonicalize(prefix + text);
        exact = parsed && lookup.get(parsed.url);
        if (exact) break;
      }
    }
    const exactURL = exact?.url ?? intranetURL;
    const exactScore = exact ? (exact.typedCount ? 1413 : 1203) : intranetURL ? 1403 : 1203;
    const haveWhatTyped = allowWhatYouTyped || !!intranetURL;
    // Unvisited intranet results defer to an inlineable history suggestion.
    const exactPromoted = !!exact || !!(intranetURL && !matches.length);
    if (exactPromoted) promote(matches, exact ?? {
      url: intranetURL, typedCount: 0, visitCount: 0, lastVisit: 0,
    }, { offset: 0, innermost: false }, true);
    const promotion = exactPromoted ? "exact" : matches.length &&
      (shorterInline || canInline(matches[0].row)) ? "front" : haveWhatTyped ? "verbatim" : "none";
    const maximum = limit + Number(exactPromoted);
    if (typedOnly) matches.length = Math.min(matches.length, maximum);
    else removeRedirectDuplicates(matches, redirects, maximum);

    const navigation = (match, relevance) => ({ ...match.row, providerName: "HistoryURL",
      type: "history-url", relevance, allowedToBeDefaultMatch: !preventInline ||
        match.offset + text.length === match.row.url.length });
    const result = [];
    if (promotion === "front") result.push(navigation(matches[0], 1413));
    if ((promotion === "exact" || promotion === "verbatim" ||
        (promotion === "front" && !result[0].allowedToBeDefaultMatch && haveWhatTyped)) &&
        (exactURL || whatURL)) {
      result.push({ ...(exact ?? {}), url: exactURL || whatURL, providerName: "HistoryURL",
        type: "url-what-you-typed", relevance: exactScore,
        allowedToBeDefaultMatch: !!exactURL || haveWhatTyped });
    }
    if (!typedOnly) {
      let relevance = result.length ? result[0].relevance : 900 + matches.length - 1;
      for (let index = exactPromoted || promotion === "front" ? 1 : 0; index < matches.length; index++) {
        relevance--;
        if (result.length) relevance = demote(matches[index].row, relevance, now);
        result.push(navigation(matches[index], relevance));
      }
    }
    return { result, promotion };
  }
  const initial = pass(true);
  return { initial: initial.result, final: pass(false, initial.promotion).result };
}
