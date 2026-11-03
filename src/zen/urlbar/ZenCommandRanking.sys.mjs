/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Command-result scoring, independent of providers and selection state.
 *
 * Signals are normalized over the candidates in this query. Available signals
 * are averaged within their category, then categories and applicable boosts
 * are averaged together. Missing signals are absent, not implicit zeroes.
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
    const values = {};
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

/** Descending scores, with provider order preserved for equal scores. */
export function rankCommandCandidates(candidates, options) {
  return scoreCommandCandidates(candidates, options).sort(
    (a, b) => b.score - a.score,
  );
}
