/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Typed keyword-history candidate preparation. This is separate from the
 * empty scope's 14-day recent list and from final command-result ranking.
 * See tools/site-search-history/README.md for the reference and rollout status. */

// Chromium's set differs from ECMAScript \s: NEL belongs here, BOM does not.
const WHITESPACE = /[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;
const TWO_DAYS = 172800;
const DUPLICATE_INTERVAL_MS = 300000;

let completionCharacters;

/** Arc's input checks Swift String.hasPrefix, including canonical equivalence
 * and whole Characters. A raw UTF-16 prefix can end inside an accented letter,
 * flag or joined emoji. The default result leaves such input alone; explicitly
 * selecting another row uses its full text with the caret at the end instead.
 * Selection offsets use NSString/DOM UTF-16 lengths, not Character counts.
 */
export function siteSearchCompletion(query, suggestion, selectedIndex = 0) {
  if (!query || typeof suggestion !== "string") return null;
  const prefix = query.normalize("NFC");
  const text = suggestion.normalize("NFC");
  let matches = false;
  if (text.startsWith(prefix)) {
    completionCharacters ??= new Intl.Segmenter("und", { granularity: "grapheme" });
    const last = completionCharacters.segment(text).containing(prefix.length - 1);
    matches = last.index + last.segment.length === prefix.length;
  }
  if (!matches && selectedIndex <= 0) return null;
  return {
    value: suggestion,
    selectionStart: matches ? Math.min(query.length, suggestion.length) : suggestion.length,
    selectionEnd: suggestion.length,
  };
}

export function collapseSiteSearchWhitespace(value) {
  return value.replace(WHITESPACE, " ").replace(/^ | $/g, "");
}

export function siteSearchTermKey(value, locale) {
  return collapseSiteSearchWhitespace(value.toLocaleLowerCase(locale));
}

/** Input rows belong to one engine. Each is a distinct search URL's lifetime
 * visit count and last visit, not one row per visit. Dates are Unix milliseconds.
 * Nearby URL variants retain the earlier representative; more distant variants
 * accumulate counts and take the newer spelling. Never change the caller's rows. */
export function collectSiteSearchTerms(rows, query, { limit = 50, locale } = {}) {
  const prefix = siteSearchTermKey(query, locale);
  if (!prefix || limit <= 0) return [];
  const candidates = rows.filter(row => typeof row?.query === "string" &&
    Number.isFinite(row.date) && Number.isSafeInteger(row.visitCount) && row.visitCount >= 0)
    .map(row => ({ ...row, key: siteSearchTermKey(row.query, locale) }))
    .filter(row => row.key.startsWith(prefix))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.date - b.date));
  const unique = [];
  for (const row of candidates) {
    const previous = unique.at(-1);
    if (previous?.key !== row.key) {
      unique.push(row);
    } else if (row.date - previous.date > DUPLICATE_INTERVAL_MS) {
      unique[unique.length - 1] = { ...row, visitCount: row.visitCount + previous.visitCount };
    }
  }
  return unique.sort((a, b) => b.date - a.date).slice(0, limit);
}

/** Chromium history relevance, verified against the installed reference's
 * ARM64 routine with synthetic inputs. This is not Arc's final displayed rank. */
export function siteSearchHistoryRelevance(ageSeconds, {
  keyword = true, hasKeyword = true, inputIsURL = false, aggressive = true,
} = {}) {
  if (!Number.isFinite(ageSeconds)) return 0;
  let age = Math.max(ageSeconds, 0);
  const primary = keyword || !hasKeyword;
  if (primary && aggressive) {
    if (age < TWO_DAYS) {
      return (keyword ? 1599 : 1399) - Math.trunc(99 * (age / TWO_DAYS) ** 2.5);
    }
    age -= TWO_DAYS;
  }
  const base = primary ? (inputIsURL ? 750 : 1050) : 200;
  return Math.max(0, base - Math.trunc(6.5 * age ** 0.3));
}

/** Word breaks, not spaces: punctuation and CJK searches can contain several
 * words too. Construct one segmenter per query batch, rather than per row. */
export function siteSearchWordCounter(locale) {
  const segmenter = new Intl.Segmenter(locale, { granularity: "word" });
  return value => {
    let count = 0;
    for (const segment of segmenter.segment(value)) {
      if (segment.isWordLike && ++count > 1) return true;
    }
    return false;
  };
}

/** Score a prepared, recency-ordered history list. The caller supplies URL
 * classification using the browser, including its configured search engines.
 * The default does not guess URL status from punctuation in a search query. */
export function scoreSiteSearchTerms(rows, query, {
  now = Date.now(), keyword = true, hasKeyword = true,
  preventInline = false, inputIsURL = false, locale,
  hasMultipleWords = siteSearchWordCounter(locale), isNavigation = () => false,
} = {}) {
  if (!rows.length) return [];
  const typed = collapseSiteSearchWhitespace(query);
  const prevent = preventInline || inputIsURL;
  const score = multiple => {
    const results = rows.map(row => {
      const term = collapseSiteSearchWhitespace(row.query);
      const aggressive = !prevent && (multiple || row.visitCount >= 2 || !hasMultipleWords(term));
      return { ...row, query: term, relevance: siteSearchHistoryRelevance((now - row.date) / 1000,
        { keyword, hasKeyword, inputIsURL, aggressive }) };
    });
    const exact = results.findIndex(row => row.query === typed);
    const first = exact < 0 ? [] : results.splice(exact, 1);
    results.sort((a, b) => b.relevance - a.relevance);
    results.unshift(...first);
    let ceiling = !prevent && exact < 0 && results[0].relevance >= 1200 &&
      isNavigation(results[0].query)
      ? siteSearchHistoryRelevance(0, { keyword, hasKeyword, inputIsURL, aggressive: false }) : 0;
    for (const row of results) {
      if (ceiling !== 0 && row.relevance >= ceiling) row.relevance = ceiling - 1;
      ceiling = row.relevance;
    }
    return results;
  };
  if (!prevent && hasMultipleWords(query)) {
    const previous = score(false);
    if (previous[0].relevance >= 1200 && hasMultipleWords(previous[0].query)) return previous;
  }
  return score(hasMultipleWords(query));
}
