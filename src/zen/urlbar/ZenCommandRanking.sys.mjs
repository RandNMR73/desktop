/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Command-result scoring, independent of providers and selection state.
 *
 * Signals are normalized over the candidates in this query. Available signals
 * are averaged within their category, then categories and applicable boosts
 * are averaged together. Missing signals receive the reference's defaults
 * before normalization, including nonzero defaults for ages and ranks.
 * See tools/command-ranking/README.md for the reference and integration status.
 */

const freeze = (value) => {
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      freeze(child);
    }
  }
  return Object.freeze(value);
};

export const COMMAND_RANKING_DEFAULTS = freeze({
  archetype: {
    weight: 35,
    items: {
      searchAutocomplete: 73,
      tab: 101,
      list: 101,
      project: 101,
      navigateWhatYouTyped: 1,
      searchWhatYouTyped: 1,
      askGPTWhatYouTyped: 2,
      document: 103.5,
      easel: 103.5,
      typeTravel: 104,
      topDomains: 96.1,
      scopedSearch: 1,
      please: 1,
      instantLinks: 1,
      memoryStore: 105,
      askAssistant: 106,
      assistantHistory: 107,
      chromiumSearchWhatYouTyped: 100,
      chromiumSearchSuggestion: 95,
      chromiumSearchHistory: 99,
      chromiumHistory: 100,
      chromiumNavigateWhatYouTyped: 100,
      chromiumNavigateSuggestion: 96,
      chromiumSearchOtherEngine: 96.2,
      chromiumSearchCalculatorAnswer: 1,
    },
  },
  match: {
    weight: 2,
    items: {
      urlMatchScore: 1,
      urlMatchPosition: 1,
      urlMatchPercentage: 1,
      titleMatchScore: 0.5,
      titleMatchPosition: 0.5,
      titleMatchPercentage: 0.5,
      hotWordsMatchScore: 1.5,
      hotWordsMatchPosition: 1.5,
      hotWordsMatchPercentage: 1.5,
      fuzzySearchConfidence: 20,
    },
  },
  importance: {
    weight: 10,
    items: {
      frequencyEver: 3,
      typedCountEver: 4,
      mostVisitedRank: 2,
      siteEngagementScore: 2,
      globalSiteRank: 1,
      typeTravelCandidateBump: 1,
    },
  },
  recency: { weight: 15, items: { lastNavigated: 3 } },
  chromium: {
    weight: 25,
    items: { chromiumRank: 5, chromiumRelevanceScore: 3 },
  },
  save: { weight: 15, items: { saveLevel: 3 } },
  boosts: {
    exactBaseDomain: { weight: 100, score: 15 },
    exactURL: { weight: 40, score: 3 },
    exactHotWord: { weight: 100, score: 15 },
    baseDomain: { weight: 40, score: 3 },
    autocompleteDefault: { weight: 15, score: 3 },
    autocompleteSearchOnly: { weight: 15, score: 2 },
    chromiumSpecialSearchFunction: { weight: 40, score: 3 },
    customTitlePrefix: { weight: 15, score: 3 },
    veryRecentTabOrDocumentBoost: { weight: 15, score: 3 },
    topApp: { weight: 15, score: 3 },
    recentlyUseTypeTravel: { weight: 15, score: 3 },
    typeTravelPrefixForLongQuery: { weight: 40, score: 3 },
    unboxingPromotedAction: { weight: 40, score: 3 },
    highFuzzySearchConfidence: { weight: 100, score: 15 },
  },
});

export const COMMAND_FEATURE_DEFAULTS = Object.freeze({
  archetype: 0,
  urlMatchScore: 0,
  urlMatchPosition: 30,
  urlMatchPercentage: 0,
  titleMatchScore: 0,
  titleMatchPosition: 30,
  titleMatchPercentage: 0,
  hotWordsMatchScore: 0,
  hotWordsMatchPosition: 30,
  hotWordsMatchPercentage: 0,
  fuzzySearchConfidence: 0,
  lastNavigated: 5184000,
  frequencyEver: 0,
  typedCountEver: 0,
  mostVisitedRank: 20,
  siteEngagementScore: 0,
  globalSiteRank: 505,
  typeTravelCandidateBump: 0,
  chromiumRank: 11,
  chromiumRelevanceScore: 0,
  saveLevel: 8,
});

const CATEGORIES = ["match", "importance", "recency", "chromium", "save"];
const LOWER_IS_BETTER = new Set([
  "urlMatchPosition",
  "titleMatchPosition",
  "hotWordsMatchPosition",
  "lastNavigated",
  "mostVisitedRank",
  "globalSiteRank",
  "chromiumRank",
  "saveLevel",
]);
const CHROMIUM_ARCHETYPES = new Set([
  "chromiumSearchWhatYouTyped", "chromiumNavigateWhatYouTyped",
  "chromiumSearchSuggestion", "chromiumSearchHistory",
  "chromiumNavigateSuggestion", "chromiumHistory", "chromiumSearchOtherEngine",
  "chromiumSearchCalculatorAnswer", "chromiumBookmark",
]);

function presentNumber(object, key) {
  return Object.hasOwn(object, key) && Number.isFinite(object[key]);
}

/** Population statistics over the values that actually exist in this query. */
function normalizers(features) {
  const sums = new Map();
  for (const values of features) {
    for (const [name, value] of Object.entries(values)) {
      const entry = sums.get(name) ?? { sum: 0, count: 0, squares: 0 };
      entry.sum += value;
      entry.count++;
      sums.set(name, entry);
    }
  }
  for (const entry of sums.values()) {
    entry.mean = entry.sum / entry.count;
  }
  // Two passes mirror the reference and avoid cancellation in E[x²] - E[x]²
  // when timestamps have a large common offset.
  for (const values of features) {
    for (const [name, value] of Object.entries(values)) {
      const entry = sums.get(name);
      entry.squares += (value - entry.mean) ** 2;
    }
  }
  for (const entry of sums.values()) {
    entry.deviation = Math.sqrt(entry.squares / entry.count);
  }
  return sums;
}

function normalized(value, name, stats) {
  const { mean, deviation } = stats.get(name);
  if (!deviation) {
    return 0;
  }
  const score = (value - mean) / deviation;
  return LOWER_IS_BETTER.has(name) ? -score : score;
}

/**
 * @param {Array<object>} candidates Provider-independent candidates with an
 *   archetype, a `features` record of measured numeric signals, and a `boosts`
 *   iterable of applicable boost names. Callers retain their own result object
 *   on the candidate; this function neither mutates nor activates it.
 * @param {object} options `explain` includes category contributions for audits.
 * @returns {Array<{candidate: object, score: number}>} In input order.
 */
export function scoreCommandCandidates(
  candidates,
  { config = COMMAND_RANKING_DEFAULTS, explain = false } = {},
) {
  const sections = CATEGORIES.map((name) => ({
    name,
    weight: config[name].weight,
    items: Object.entries(config[name].items),
  }));
  const features = candidates.map((candidate) => {
    const values = { ...COMMAND_FEATURE_DEFAULTS };
    if (presentNumber(config.archetype.items, candidate.archetype)) {
      values.archetype = config.archetype.items[candidate.archetype];
    }
    for (const section of sections) {
      for (const [name] of section.items) {
        if (candidate.features && presentNumber(candidate.features, name)) {
          values[name] = candidate.features[name];
        }
      }
    }
    return values;
  });
  const stats = normalizers(features);
  return candidates.map((candidate, index) => {
    const values = features[index];
    const components = [];
    const add = (name, score, weight) => {
      if (weight) {
        components.push({ name, score, weight });
      }
    };
    if (Object.hasOwn(values, "archetype")) {
      add(
        "archetype",
        normalized(values.archetype, "archetype", stats),
        config.archetype.weight,
      );
    }
    for (const section of sections) {
      if (!section.weight) {
        continue;
      }
      const present = section.items.filter(([name]) =>
        Object.hasOwn(values, name),
      );
      if (!present.length) {
        continue;
      }
      const weight = present.reduce((sum, [, w]) => sum + w, 0);
      let score = 0;
      if (weight > 0) {
        for (const [name, w] of present) {
          score += (normalized(values[name], name, stats) * w) / weight;
        }
      }
      add(section.name, score, section.weight);
    }
    // A configured bonus is applied once, even if several providers identify
    // the same reason. Its weight belongs in the final denominator too.
    const boosts = new Set(candidate.boosts ?? []);
    for (const [name, boost] of Object.entries(config.boosts)) {
      if (boosts.has(name)) {
        add(name, boost.score, boost.weight);
      }
    }
    const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
    const score = totalWeight > 0
      ? components.reduce(
          (sum, item) => sum + (item.score * item.weight) / totalWeight,
          0,
        )
      : 0;
    return {
      candidate,
      score,
      ...(explain ? { components } : {}),
    };
  });
}

/** Descending scores, followed by the implemented reference ordering rules.
 * Provider order is preserved for equal scores before those rules run. */
export function rankCommandCandidates(candidates, options = {}) {
  const ranked = scoreCommandCandidates(candidates, options).sort(
    (a, b) => b.score - a.score,
  );
  return applyInstantLinksPosition(applyPreferredMaximumRanks(
    applyCurrentItemRules(applyInitialCommandRules(ranked), options),
    options.preferredMaximumRanks,
  ));
}

function candidateURL(candidate) {
  const kind = candidate?.archetype;
  return CHROMIUM_ARCHETYPES.has(kind) ||
    ["navigateWhatYouTyped", "tab", "document", "easel", "topDomains"].includes(kind)
    ? stringKey(candidate.url) : undefined;
}

/** Move the first alternative ahead of a leading result for the current URL.
 * Reference URL equality is raw Swift String equality, not the prepared URL
 * key used for history/tab deduplication. The provider must supply the native
 * root-page predicate; unknown root status does not enable this rule. */
export function applyCurrentItemRules(ranked, {
  derankCurrentItemURL = false, currentItem, mostVisitedURLs = [],
} = {}) {
  const results = ranked.slice();
  const currentURL = stringKey(currentItem?.url);
  if (derankCurrentItemURL !== true || results.length < 2 ||
      stringKey(currentItem?.id) === undefined || currentURL === undefined ||
      currentItem.isRootURL !== false || candidateURL(results[0].candidate) !== currentURL ||
      ["navigateWhatYouTyped", "chromiumNavigateWhatYouTyped"].includes(results[0].candidate.archetype) ||
      mostVisitedURLs.some(url => stringKey(url) === currentURL)) return results;
  const alternative = results.findIndex(row => candidateURL(row.candidate) !== currentURL);
  if (alternative > 0) results.unshift(...results.splice(alternative, 1));
  return results;
}

/** Keep the first instant-links result directly after the first literal web
 * search when it currently appears later. A link already ahead is untouched. */
export function applyInstantLinksPosition(ranked) {
  const results = ranked.slice();
  const search = results.findIndex(row =>
    ["searchWhatYouTyped", "chromiumSearchWhatYouTyped"].includes(row.candidate.archetype),
  );
  const links = results.findIndex(row => row.candidate.archetype === "instantLinks");
  if (search >= 0 && links > search + 1) {
    results.splice(search + 1, 0, ...results.splice(links, 1));
  }
  return results;
}

// Swift String dictionaries compare canonically equivalent spellings. URL
// preparation remains native/provider-owned; these functions must not guess
// URL identity from completion text, a display title, or a JavaScript URL.
function stringKey(value) {
  return typeof value === "string" ? value.normalize("NFC") : undefined;
}

/** The three reference passes immediately after score sorting.
 * `isVisible` is optional tab visibility; `features.lastNavigated` is age in
 * seconds. `tabID` identifies a tab, not its URL. `deduplicationURL` must be the
 * reference's prepared URL key. Missing IDs/keys are never merged by guessing.
 * Row objects, scores, and activation payloads are retained without mutation.
 * Later context and placement passes are applied by rankCommandCandidates. */
export function applyInitialCommandRules(ranked) {
  const ordered = ranked.slice();
  const first = ordered[0]?.candidate;
  const age = first?.features && presentNumber(first.features, "lastNavigated")
    ? first.features.lastNavigated : COMMAND_FEATURE_DEFAULTS.lastNavigated;
  if (first?.archetype === "tab" && first.isVisible !== true &&
      age > 604800 && CHROMIUM_ARCHETYPES.has(ordered[1]?.candidate.archetype)) {
    [ordered[0], ordered[1]] = [ordered[1], ordered[0]];
  }

  // A history result can lend its position to the first matching tab that
  // has not already appeared. Keep separate tabs with the same URL: IDs,
  // rather than URLs, decide which tab results have already been emitted.
  const tabsByURL = new Map();
  for (const row of ordered) {
    const candidate = row.candidate;
    const key = stringKey(candidate.deduplicationURL);
    if (candidate.archetype === "tab" && key !== undefined &&
        stringKey(candidate.tabID) !== undefined) {
      if (!tabsByURL.has(key)) tabsByURL.set(key, { rows: [], next: 0 });
      tabsByURL.get(key).rows.push(row);
    }
  }
  const usedTabIDs = new Set();
  const replaced = [];
  for (const row of ordered) {
    const candidate = row.candidate;
    const key = stringKey(candidate.deduplicationURL);
    if (candidate.archetype === "chromiumHistory" && key !== undefined) {
      const group = tabsByURL.get(key);
      while (group && group.next < group.rows.length &&
          usedTabIDs.has(stringKey(group.rows[group.next].candidate.tabID))) {
        group.next++;
      }
      const tab = group?.rows[group.next];
      if (tab) {
        usedTabIDs.add(stringKey(tab.candidate.tabID));
        replaced.push(tab);
        continue;
      }
    }
    if (candidate.archetype === "tab") {
      const id = stringKey(candidate.tabID);
      if (id !== undefined) {
        if (usedTabIDs.has(id)) continue;
        usedTabIDs.add(id);
      }
    }
    replaced.push(row);
  }

  // This second pass removes only history duplicates following a tab. Search
  // suggestions, navigation suggestions and bookmarks are distinct results.
  const seenTabURLs = new Set();
  return replaced.filter(row => {
    const { archetype, deduplicationURL } = row.candidate;
    const key = stringKey(deduplicationURL);
    if (key === undefined) return true;
    if (archetype === "chromiumHistory" && seenTabURLs.has(key)) return false;
    if (archetype === "tab") seenTabURLs.add(key);
    return true;
  });
}

/** Promote results that fall below an explicit maximum index, without
 * demoting results that already rank higher. No result is promoted twice. */
export function applyPreferredMaximumRanks(ranked, limits = {}) {
  const results = ranked.slice();
  const moved = new Set();
  let index = results.length - 1;
  while (index > 0) {
    const result = results[index];
    const kind = result.candidate.archetype;
    const limit = Object.hasOwn(limits, kind) ? limits[kind] : undefined;
    if (
      Number.isInteger(limit) &&
      limit >= 0 &&
      limit < index &&
      !moved.has(result)
    ) {
      moved.add(result);
      results.splice(index, 1);
      results.splice(limit, 0, result);
    } else {
      index--;
    }
  }
  return results;
}
