/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { rankCommandCandidates } from "./ZenCommandRanking.sys.mjs";

// SearchProvider's local suggestion budget is independent of the popup's
// final row limit. The literal query does not consume this budget.
export const SITE_SEARCH_LOCAL_SUGGESTIONS = 3;
export const SITE_SEARCH_HISTORY_CANDIDATES = SITE_SEARCH_LOCAL_SUGGESTIONS * 5;

/** Prepare the browser-client search results before Arc's command ranking.
 * The literal enters the map first. A case-insensitive duplicate replaces it
 * only with a strictly stronger relevance, matching BaseSearchProvider.
 * The caller supplies canonical engine submissions, never a history URL with
 * tracking parameters. History timestamps/counts affect Chromium relevance;
 * they are not additional navigation features on search results.
 */
export function siteSearchCandidates(query, rows, {
  submissionURL, locale, limit = 10, navigation = [], navigationKey = url => url,
}) {
  if (limit <= 0) return [];
  const key = text => text.toLocaleLowerCase(locale);
  const unique = new Map([[key(query), { query, relevance: 1500, literal: true }]]);
  for (const row of rows) {
    if (!(row.relevance > 0)) continue;
    const previous = unique.get(key(row.query));
    if (!previous || row.relevance > previous.relevance) unique.set(key(row.query), row);
  }
  let suggestions = 0;
  const searches = [...unique.values()].sort((a, b) => b.relevance - a.relevance)
    .filter(row => row.literal || suggestions++ < SITE_SEARCH_LOCAL_SUGGESTIONS)
    .map(row => ({ ...row, destination: submissionURL(row.query), search: true }));
  // A duplicate navigation URL upgrades a search's relevance without adding
  // navigation visit/age features to its later command-ranking record.
  const combined = new Map(searches.map(row => [navigationKey(row.destination), row]));
  for (const row of navigation) {
    const destination = navigationKey(row.url);
    const previous = combined.get(destination);
    if (previous) {
      previous.relevance = Math.max(previous.relevance, row.relevance);
    } else {
      combined.set(destination, { ...row, destination, search: false });
    }
  }
  // Chromium culls its shared eight-result batch before Arc's scope filter.
  // Navigation rows consume slots but never become site-search suggestions.
  return [...combined.values()].sort((a, b) => b.relevance - a.relevance ||
    ((a.query ?? a.url) < (b.query ?? b.url) ? -1 : (a.query ?? a.url) > (b.query ?? b.url) ? 1 : 0))
    .slice(0, 8).filter(row => row.search).slice(0, limit).map((row, index) => ({
      row,
      title: row.query,
      completionText: row.query,
      url: submissionURL(row.query),
      archetype: row.literal ? "chromiumSearchOtherEngine" :
        key(row.query) === key(query) ? "chromiumSearchWhatYouTyped" : "chromiumSearchHistory",
      features: { chromiumRank: index + 1, chromiumRelevanceScore: row.relevance },
    }));
}

/** Native matching is batched once; no site-specific ordering or colors. */
export function rankSiteSearchCandidates(candidates, signals, rules) {
  if (!Array.isArray(signals) || signals.length !== candidates.length || !rules) return candidates;
  return rankCommandCandidates(candidates.map((candidate, index) => ({
    ...candidate,
    ...signals[index],
    features: { ...candidate.features, ...signals[index].features },
  })), {
    preferredMaximumRanks: rules.preferredMaxRanks,
    isPhraseSearch: rules.isPhraseSearch,
  }).map(result => result.candidate);
}
