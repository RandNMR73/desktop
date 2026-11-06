/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

const SYNC_ONLY_TYPES = new Set([
  "url-what-you-typed", "search-what-you-typed", "pedal",
  "tile-navsuggest", "tile-suggestion",
]);

/** Carry unfinished providers' previous matches into an intermediate batch.
 * Inputs have already been deduplicated and sorted, with a defaultable first
 * result. This happens BEFORE the shared result limit and scope filtering.
 * Keeping the lowest old matches preserves the provider's previous count;
 * choosing its highest matches would change which new results survive culling.
 * The final provider batch must be processed without this carry-over.
 *
 * Mirrors AutocompleteResult::TransferOldMatches/MergeMatchesByProvider in
 * Chromium 156.0.8078.74. Inputs are never mutated. `destinationKey` supplies
 * the same URL normalization as the caller's destination deduplication.
 */
export function transferCommandMatches(current, previous, {
  doneProviders = new Set(), destinationKey = match => match.url,
  preventInline = false, canRemainDefault = () => false,
} = {}) {
  const eligible = previous.filter(match => !doneProviders.has(match.providerName) &&
    !SYNC_ONLY_TYPES.has(match.type));
  if (!eligible.length) return [...current];
  if (!current.length) return eligible.map(match => ({ ...match, fromPrevious: true }));

  const result = [...current], oldGroups = new Map(), newGroups = new Map();
  for (const [matches, groups] of [[eligible, oldGroups], [current, newGroups]]) {
    for (const match of matches) {
      const group = groups.get(match.providerName);
      if (group) group.push(match);
      else groups.set(match.providerName, [match]);
    }
  }
  for (const [provider, oldMatches] of oldGroups) {
    const newMatches = newGroups.get(provider) ?? [];
    let remaining = oldMatches.length - newMatches.length;
    if (remaining <= 0) continue;
    const bestDefault = newMatches.find(match => match.allowedToBeDefaultMatch) ?? current[0];
    const ceiling = bestDefault.relevance - 1;
    const destinations = new Set(newMatches.map(destinationKey));
    for (let index = oldMatches.length - 1; index >= 0 && remaining > 0; index--) {
      const match = oldMatches[index];
      if (destinations.has(destinationKey(match))) continue;
      result.push({
        ...match,
        relevance: Math.min(ceiling, match.relevance),
        fromPrevious: true,
        allowedToBeDefaultMatch: !!(preventInline && match.allowedToBeDefaultMatch &&
          canRemainDefault(match)),
      });
      remaining--;
    }
  }
  return result;
}

/** One accumulator per query, after each batch has been independently ranked.
 * Arc's publisher appends new identities and retains the FIRST instance of an
 * existing identity, including its position and score. Re-sorting the union,
 * replacing a duplicate with a better score, or dropping an absent result all
 * change the visible order. Discard this object on query cancellation/end.
 */
export class CommandResultAccumulator {
  #identity;
  #seen = new Set();
  #results = [];

  constructor(identity) {
    this.#identity = identity;
  }

  append(batch) {
    const added = [];
    for (const result of batch) {
      const identity = this.#identity(result);
      if (this.#seen.has(identity)) continue;
      this.#seen.add(identity);
      this.#results.push(result);
      added.push(result);
    }
    return added;
  }

  get results() {
    return [...this.#results];
  }
}
