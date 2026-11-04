/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { rankCommandCandidates } from "./ZenCommandRanking.sys.mjs";

/** Prepare the browser-client search results before Arc's command ranking.
 * The literal enters the map first. A case-insensitive duplicate replaces it
 * only with a strictly stronger relevance, matching BaseSearchProvider.
 * The caller supplies canonical engine submissions, never a history URL with
 * tracking parameters. History timestamps/counts affect Chromium relevance;
 * they are not additional navigation features on search results.
 */
export function siteSearchCandidates(query, rows, { submissionURL, locale, limit = 10 }) {
  const key = text => text.toLocaleLowerCase(locale);
  const unique = new Map([[key(query), { query, relevance: 1500, literal: true }]]);
  for (const row of rows) {
    if (!(row.relevance > 0)) continue;
    const previous = unique.get(key(row.query));
    if (!previous || row.relevance > previous.relevance) unique.set(key(row.query), row);
  }
  return [...unique.values()].sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit).map((row, index) => ({
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
