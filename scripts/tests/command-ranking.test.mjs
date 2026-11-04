import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMAND_RANKING_DEFAULTS,
  COMMAND_FEATURE_DEFAULTS,
  applyInitialCommandRules,
  applyCurrentItemRules,
  applyInstantLinksPosition,
  applyPreferredMaximumRanks,
  rankCommandCandidates,
  scoreCommandCandidates,
} from "../../src/zen/urlbar/ZenCommandRanking.sys.mjs";

function postSortRows(...candidates) {
  return candidates.map((candidate, index) => Object.freeze({
    candidate: Object.freeze(candidate), score: 100 - index,
  }));
}

const currentItemContext = {
  derankCurrentItemURL: true,
  currentItem: { id: "current", url: "https://fixture.test/page", isRootURL: false },
};

test("the current URL yields to the first alternative without discarding other matching rows", () => {
  const rows = postSortRows(
    { archetype: "tab", url: currentItemContext.currentItem.url },
    { archetype: "chromiumHistory", url: currentItemContext.currentItem.url },
    { archetype: "searchWhatYouTyped" },
    { archetype: "tab", url: "https://other.test/page" },
  );
  Object.freeze(rows);
  assert.deepEqual(applyCurrentItemRules(rows, currentItemContext), [rows[2], rows[0], rows[1], rows[3]]);
  assert.deepEqual(applyCurrentItemRules(rows.slice(0, 2), currentItemContext), rows.slice(0, 2));
});

test("current-page demotion requires explicit context and preserves its homepage/most-visited exceptions", () => {
  const rows = postSortRows(
    { archetype: "tab", url: currentItemContext.currentItem.url },
    { archetype: "searchWhatYouTyped" },
  );
  for (const options of [
    {}, { ...currentItemContext, derankCurrentItemURL: false },
    { ...currentItemContext, derankCurrentItemURL: "true" },
    { ...currentItemContext, derankCurrentItemURL: 1 },
    { ...currentItemContext, currentItem: undefined },
    { ...currentItemContext, currentItem: { ...currentItemContext.currentItem, id: undefined } },
    { ...currentItemContext, currentItem: { ...currentItemContext.currentItem, isRootURL: true } },
    { ...currentItemContext, currentItem: { ...currentItemContext.currentItem, isRootURL: undefined } },
    { ...currentItemContext, mostVisitedURLs: [currentItemContext.currentItem.url] },
  ]) assert.deepEqual(applyCurrentItemRules(rows, options), rows);
  assert.deepEqual(applyCurrentItemRules([], currentItemContext), []);
  assert.deepEqual(applyCurrentItemRules(rows.slice(0, 1), currentItemContext), rows.slice(0, 1));
});

test("literal navigation to the current page is never demoted", () => {
  for (const archetype of ["navigateWhatYouTyped", "chromiumNavigateWhatYouTyped"]) {
    const rows = postSortRows(
      { archetype, url: currentItemContext.currentItem.url },
      { archetype: "searchWhatYouTyped" },
    );
    assert.deepEqual(applyCurrentItemRules(rows, currentItemContext), rows);
  }
});

test("current-page equality does not borrow the more permissive history duplicate key", () => {
  const rows = postSortRows(
    { archetype: "tab", url: "http://fixture.test/page/", deduplicationURL: "fixture.test/page" },
    { archetype: "searchWhatYouTyped" },
  );
  assert.deepEqual(applyCurrentItemRules(rows, currentItemContext), rows);
  const caseRows = postSortRows(
    { archetype: "tab", url: "https://fixture.test/Page" },
    { archetype: "searchWhatYouTyped" },
  );
  assert.deepEqual(applyCurrentItemRules(caseRows, currentItemContext), caseRows);
});

test("current-page string equality preserves canonical Unicode equivalence", () => {
  const rows = postSortRows(
    { archetype: "tab", url: "https://fixture.test/cafe\u0301" },
    { archetype: "searchWhatYouTyped" },
  );
  const context = { ...currentItemContext,
    currentItem: { ...currentItemContext.currentItem, url: "https://fixture.test/café" } };
  assert.deepEqual(applyCurrentItemRules(rows, context), [rows[1], rows[0]]);
  assert.deepEqual(applyCurrentItemRules(rows, { ...context, mostVisitedURLs: [rows[0].candidate.url] }), rows);
});

test("an instant-links result is moved directly after the first literal search", () => {
  for (const archetype of ["searchWhatYouTyped", "chromiumSearchWhatYouTyped"]) {
    const rows = postSortRows(
      { archetype: "tab" }, { archetype },
      { archetype: "chromiumHistory" }, { archetype: "instantLinks" },
      { archetype: "instantLinks" },
    );
    Object.freeze(rows);
    assert.deepEqual(applyInstantLinksPosition(rows), [rows[0], rows[1], rows[3], rows[2], rows[4]]);
  }
});

test("instant links keep their position before search or when no literal search exists", () => {
  const rows = postSortRows(
    { archetype: "instantLinks" }, { archetype: "tab" },
    { archetype: "searchWhatYouTyped" },
  );
  assert.deepEqual(applyInstantLinksPosition(rows), rows);
  assert.deepEqual(applyInstantLinksPosition(rows.slice(0, 2)), rows.slice(0, 2));
  for (const archetype of ["searchAutocomplete", "chromiumSearchSuggestion", "chromiumSearchHistory",
      "chromiumSearchOtherEngine", "chromiumSearchCalculatorAnswer", "askGPTWhatYouTyped"]) {
    const others = postSortRows({ archetype }, { archetype: "tab" }, { archetype: "instantLinks" });
    assert.deepEqual(applyInstantLinksPosition(others), others);
  }
});

test("current-page context runs before maximum-rank promotion; instant links run last", () => {
  const candidates = [
    { archetype: "tab", isVisible: true, url: currentItemContext.currentItem.url, boosts: ["exactURL"] },
    { archetype: "chromiumHistory", url: "https://other.test/page" },
    { archetype: "searchWhatYouTyped" },
    { archetype: "instantLinks" },
  ];
  const result = rankCommandCandidates(candidates, {
    ...currentItemContext, preferredMaximumRanks: { searchWhatYouTyped: 0 },
  });
  assert.deepEqual(result.map(row => row.candidate), [candidates[2], candidates[3], candidates[1], candidates[0]]);
});

test("only a stale invisible leading tab swaps with its immediate Chromium neighbor", () => {
  for (const isVisible of [true, false, undefined]) {
    for (const age of [0, 604800, 604800.001]) {
      const rows = postSortRows(
        { archetype: "tab", isVisible, features: { lastNavigated: age } },
        { archetype: "chromiumSearchWhatYouTyped" },
        { archetype: "chromiumHistory" },
      );
      assert.deepEqual(applyInitialCommandRules(rows),
        !isVisible && age > 604800 ? [rows[1], rows[0], rows[2]] : rows);
    }
  }
  const rows = postSortRows(
    { archetype: "tab" }, { archetype: "typeTravel" },
    { archetype: "chromiumHistory" },
  );
  assert.deepEqual(applyInitialCommandRules(rows), rows);
  assert.deepEqual(applyInitialCommandRules([]), []);
  assert.deepEqual(applyInitialCommandRules(rows.slice(0, 1)), rows.slice(0, 1));
});

test("stale-tab handling uses the same upstream missing-age default as scoring", () => {
  for (const features of [undefined, {}, { lastNavigated: NaN },
      Object.create({ lastNavigated: 0 })]) {
    const rows = postSortRows({ archetype: "tab", features }, { archetype: "chromiumHistory" });
    assert.deepEqual(applyInitialCommandRules(rows), [rows[1], rows[0]]);
  }
});

test("a history result transfers its position to a matching tab without transferring its score", () => {
  const rows = postSortRows(
    { archetype: "chromiumHistory", deduplicationURL: "fixture.test" },
    { archetype: "typeTravel" },
    { archetype: "tab", tabID: "tab-a", deduplicationURL: "fixture.test" },
  );
  Object.freeze(rows);
  const result = applyInitialCommandRules(rows);
  assert.deepEqual(result, [rows[2], rows[1]]);
  assert.equal(result[0], rows[2]);
  assert.equal(result[0].score, 98);
});

test("two tabs at one URL survive while excess history duplicates disappear", () => {
  const rows = postSortRows(
    { archetype: "chromiumHistory", deduplicationURL: "same.test" },
    { archetype: "chromiumHistory", deduplicationURL: "same.test" },
    { archetype: "chromiumHistory", deduplicationURL: "same.test" },
    { archetype: "tab", tabID: "a", deduplicationURL: "same.test" },
    { archetype: "tab", tabID: "b", deduplicationURL: "same.test" },
  );
  assert.deepEqual(applyInitialCommandRules(rows), [rows[3], rows[4]]);
  // One history row promotes only the first tab; the second keeps its place.
  assert.deepEqual(applyInitialCommandRules([rows[0], rows[3], rows[4]]), [rows[3], rows[4]]);
});

test("tab identity and URL equality have different deduplication roles", () => {
  const rows = postSortRows(
    { archetype: "tab", isVisible: true, tabID: "a", deduplicationURL: "first.test" },
    { archetype: "tab", tabID: "a", deduplicationURL: "second.test" },
    { archetype: "chromiumHistory", deduplicationURL: "first.test" },
    { archetype: "chromiumHistory", deduplicationURL: "second.test" },
  );
  assert.deepEqual(applyInitialCommandRules(rows), [rows[0], rows[3]]);
});

test("search, navigation, and bookmark results are not merged into matching tabs", () => {
  const rows = postSortRows(
    { archetype: "tab", isVisible: true, tabID: "a", deduplicationURL: "same.test" },
    ...["chromiumSearchHistory", "chromiumNavigateWhatYouTyped", "chromiumNavigateSuggestion",
      "chromiumBookmark", "navigateWhatYouTyped"].map(archetype => ({
        archetype, deduplicationURL: "same.test",
      })),
  );
  assert.deepEqual(applyInitialCommandRules(rows), rows);
});

test("history entries without matching tabs are retained including repeated URLs", () => {
  const rows = postSortRows(
    { archetype: "chromiumHistory", deduplicationURL: "same.test" },
    { archetype: "chromiumHistory", deduplicationURL: "same.test" },
  );
  assert.deepEqual(applyInitialCommandRules(rows), rows);
});

test("missing identity metadata never merges by title, raw URL, or completion", () => {
  const rows = postSortRows(
    { archetype: "chromiumHistory", url: "https://same.test", completion: "same.test" },
    { archetype: "tab", url: "https://same.test", completion: "same.test", title: "Same" },
    { archetype: "tab", url: "https://same.test", completion: "same.test", title: "Same" },
  );
  assert.deepEqual(applyInitialCommandRules(rows), rows);
});

test("prepared URL keys and tab IDs preserve Swift canonical equality but not case folding", () => {
  const rows = postSortRows(
    { archetype: "chromiumHistory", deduplicationURL: "café.test" },
    { archetype: "tab", tabID: "café", deduplicationURL: "cafe\u0301.test" },
    { archetype: "tab", tabID: "cafe\u0301", deduplicationURL: "café.test" },
    { archetype: "chromiumHistory", deduplicationURL: "CAFÉ.test" },
  );
  assert.deepEqual(applyInitialCommandRules(rows), [rows[1], rows[3]]);
});

test("initial post-sort rules precede preferred-maximum-rank promotion", () => {
  const candidates = [
    { archetype: "tab", features: { lastNavigated: 700000 }, boosts: ["exactURL"] },
    { archetype: "chromiumHistory" },
    { archetype: "searchWhatYouTyped" },
  ];
  const scored = scoreCommandCandidates(candidates).sort((a, b) => b.score - a.score);
  assert.deepEqual(scored.map(row => row.candidate), candidates);
  assert.deepEqual(rankCommandCandidates(candidates, {
    preferredMaximumRanks: { searchWhatYouTyped: 0 },
  }).map(row => row.candidate), [candidates[2], candidates[1], candidates[0]]);
});

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
}

function pair(name, first, second) {
  return scoreCommandCandidates([
    { archetype: "tab", features: { [name]: first } },
    { archetype: "tab", features: { [name]: second } },
  ], { explain: true });
}

test("the normalization uses population deviation, not sample deviation", () => {
  const scores = scoreCommandCandidates([
    { archetype: "tab" },
    { archetype: "chromiumHistory" },
  ]);
  close(scores[0].score, 35 / 102);
  close(scores[1].score, -35 / 102);
});

test("feature groups are averaged before applying category weights", () => {
  const rows = scoreCommandCandidates([
    { archetype: "tab", features: { urlMatchScore: 0, titleMatchScore: 9 } },
    { archetype: "tab", features: { urlMatchScore: 1, titleMatchScore: 1 } },
  ], { explain: true });
  // URL weighs 1 and title 0.5, out of match's total feature weight 29.
  // Match weighs 2 out of the six categories' total weight 102.
  close(rows[0].components.find((x) => x.name === "match").score, -0.5 / 29);
  close(rows[0].score, -1 / 2958);
  close(rows[1].score, 1 / 2958);
});

test("all independent signal directions match the reference", () => {
  const directions = {
    urlMatchScore: 1,
    urlMatchPosition: -1,
    urlMatchPercentage: 1,
    titleMatchScore: 1,
    titleMatchPosition: -1,
    titleMatchPercentage: 1,
    hotWordsMatchScore: 1,
    hotWordsMatchPosition: -1,
    hotWordsMatchPercentage: 1,
    fuzzySearchConfidence: 1,
    lastNavigated: -1,
    frequencyEver: 1,
    typedCountEver: 1,
    mostVisitedRank: -1,
    siteEngagementScore: 1,
    globalSiteRank: -1,
    typeTravelCandidateBump: 1,
    chromiumRank: -1,
    chromiumRelevanceScore: 1,
    saveLevel: -1,
  };
  for (const [name, direction] of Object.entries(directions)) {
    const [high, low] = pair(name, 8, 2);
    assert.equal(Math.sign(high.score), direction, name);
    assert.equal(Math.sign(low.score), -direction, name);
  }
});

test("missing signals are filled before calculating population statistics", () => {
  const rows = scoreCommandCandidates([
    { archetype: "tab", features: { frequencyEver: 0 } },
    { archetype: "tab", features: { frequencyEver: 10 } },
    { archetype: "tab" },
  ], { explain: true });
  // [0, 10, missing -> 0] normalizes to [-1/√2, √2, -1/√2].
  // Frequency's effective weight is (3/13) * (10/102) = 5/221.
  close(rows[0].score, -5 / (221 * Math.sqrt(2)));
  close(rows[1].score, 5 * Math.sqrt(2) / 221);
  close(rows[2].score, rows[0].score);
  assert.equal(rows[2].components.length, 6);
});

test("missing ages and ranks use the recovered nonzero values", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(COMMAND_FEATURE_DEFAULTS).filter(([, value]) => value)),
    {
      urlMatchPosition: 30,
      titleMatchPosition: 30,
      hotWordsMatchPosition: 30,
      lastNavigated: 60 * 24 * 60 * 60,
      mostVisitedRank: 20,
      globalSiteRank: 505,
      chromiumRank: 11,
      saveLevel: 8,
    },
  );
  const [zero, missing] = scoreCommandCandidates([
    { archetype: "tab", features: { lastNavigated: 0, saveLevel: 0 } },
    { archetype: "tab" },
  ]);
  close(zero.score, 30 / 102);
  close(missing.score, -30 / 102);
});

test("query-local normalization changes when another candidate arrives", () => {
  const inputs = [
    { archetype: "tab", features: { frequencyEver: 0 } },
    { archetype: "tab", features: { frequencyEver: 2 } },
  ];
  const initial = scoreCommandCandidates(inputs);
  close(initial[1].score, 5 / 221);
  const expanded = scoreCommandCandidates([
    ...inputs,
    { archetype: "tab", features: { frequencyEver: 100 } },
  ]);
  const populationDeviation = Math.sqrt((34 ** 2 + 32 ** 2 + 66 ** 2) / 3);
  close(expanded[1].score, (5 / 221) * (-32 / populationDeviation));
  assert.ok(expanded[1].score < 0);
});

test("a bonus changes the numerator and denominator, once per reason", () => {
  const inputs = [
    {
      archetype: "tab",
      features: { frequencyEver: 100, lastNavigated: 1, saveLevel: 0 },
      boosts: ["exactBaseDomain", "exactBaseDomain"],
    },
    {
      archetype: "chromiumHistory",
      features: { frequencyEver: 10, lastNavigated: 9, saveLevel: 3 },
    },
  ];
  const scores = scoreCommandCandidates(inputs, { explain: true });
  // Archetype, recency and save score +1; importance scores 3/13.
  // The constant match and Chromium categories retain their weights.
  const weightedSignals = 35 + 15 + 15 + 10 * 3 / 13;
  close(scores[0].score, (weightedSignals + 100 * 15) / (102 + 100));
  close(scores[1].score, -weightedSignals / 102);
  assert.equal(scores[0].components.filter((x) => x.name === "exactBaseDomain").length, 1);
  inputs[0].boosts = ["customTitlePrefix"];
  close(scoreCommandCandidates(inputs)[0].score, (weightedSignals + 15 * 3) / (102 + 15));
});

test("default-filled constant signals retain category weights", () => {
  const rows = scoreCommandCandidates([
    { archetype: "tab", features: { frequencyEver: 0 }, boosts: ["customTitlePrefix"] },
    { archetype: "tab", boosts: ["customTitlePrefix"] },
  ]);
  close(rows[0].score, 45 / 117);
  close(rows[1].score, 45 / 117);
});

test("disabled categories do not dilute the score", () => {
  const config = structuredClone(COMMAND_RANKING_DEFAULTS);
  config.importance.weight = 0;
  const rows = scoreCommandCandidates([
    { archetype: "tab", features: { frequencyEver: 0 }, boosts: ["customTitlePrefix"] },
    { archetype: "tab", features: { frequencyEver: 9 } },
  ], { config, explain: true });
  close(rows[0].score, 45 / 107);
  assert.equal(rows[0].components.some((x) => x.name === "importance"), false);
});

test("empty, single, unknown, and malformed candidates stay finite", () => {
  assert.deepEqual(scoreCommandCandidates([]), []);
  const [single] = scoreCommandCandidates([{ archetype: "tab", features: { frequencyEver: 12 } }]);
  close(single.score, 0);
  const rows = scoreCommandCandidates([
    { archetype: "futureKind", features: { frequencyEver: NaN, saveLevel: Infinity } },
    { archetype: "__proto__", features: { frequencyEver: "12", unknown: 0 } },
    { features: Object.create({ frequencyEver: 12 }), boosts: ["futureBonus", "toString"] },
  ]);
  assert.ok(rows.every((row) => row.score === 0));
});

test("large common timestamps preserve small differences", () => {
  const [recent, old] = pair("lastNavigated", 1e12, 1e12 + 2);
  close(recent.components.find((x) => x.name === "recency").score, 1);
  close(old.components.find((x) => x.name === "recency").score, -1);
});

test("ranking is stable, repeatable, and does not mutate provider results", () => {
  const inputs = [
    Object.freeze({ id: "a", archetype: "tab" }),
    Object.freeze({ id: "b", archetype: "tab" }),
    Object.freeze({ id: "c", archetype: "tab", boosts: Object.freeze(["exactURL"]) }),
  ];
  Object.freeze(inputs);
  const first = rankCommandCandidates(inputs);
  const second = rankCommandCandidates(inputs);
  assert.deepEqual(first.map((x) => x.candidate.id), ["c", "a", "b"]);
  assert.deepEqual(first, second);
  assert.equal(first[0].candidate, inputs[2]);
  assert.deepEqual(inputs.map((x) => x.id), ["a", "b", "c"]);
  assert.equal("components" in first[0], false);
  assert.ok(Object.isFrozen(COMMAND_RANKING_DEFAULTS.boosts.exactURL));
});

function ranked(...kinds) {
  return kinds.map((archetype, i) => ({
    candidate: { id: i, archetype }, score: kinds.length - i,
  }));
}

test("preferred maximum rank promotes a fallback without demoting a better one", () => {
  const limits = { searchWhatYouTyped: 1 };
  const rows = ranked("tab", "chromiumHistory", "searchWhatYouTyped");
  const result = applyPreferredMaximumRanks(rows, limits);
  assert.deepEqual(result.map((x) => x.candidate.id), [0, 2, 1]);
  const alreadyFirst = ranked("searchWhatYouTyped", "tab");
  assert.deepEqual(applyPreferredMaximumRanks(alreadyFirst, limits), alreadyFirst);
  assert.deepEqual(rows.map((x) => x.candidate.id), [0, 1, 2]);
});

test("reverse scanning processes shifted results and promotes each only once", () => {
  const rows = ranked("tab", "chromiumHistory", "searchWhatYouTyped", "navigateWhatYouTyped");
  const result = applyPreferredMaximumRanks(rows, {
    searchWhatYouTyped: 1, navigateWhatYouTyped: 0,
  });
  assert.deepEqual(result.map((x) => x.candidate.id), [3, 2, 0, 1]);
  assert.equal(new Set(result).size, rows.length);
  for (const row of rows) {
    assert.equal(result.includes(row), true);
  }
});

test("competing maximum ranks preserve their original relative order", () => {
  const rows = ranked("tab", "chromiumHistory", "searchWhatYouTyped", "chromiumSearchWhatYouTyped");
  const result = applyPreferredMaximumRanks(rows, {
    searchWhatYouTyped: 1, chromiumSearchWhatYouTyped: 1,
  });
  assert.deepEqual(result.map((x) => x.candidate.id), [0, 2, 3, 1]);
});

test("absent, out-of-range and invalid limits do not move results", () => {
  const rows = ranked("tab", "chromiumHistory", "searchWhatYouTyped");
  for (const limit of [undefined, null, -1, 1.5, 3, Infinity, NaN]) {
    assert.deepEqual(applyPreferredMaximumRanks(rows, { searchWhatYouTyped: limit }), rows);
  }
  assert.deepEqual(applyPreferredMaximumRanks([], { tab: 0 }), []);
  assert.deepEqual(applyPreferredMaximumRanks(rows.slice(0, 1), { tab: 0 }), rows.slice(0, 1));
});

test("ranking applies explicit preferred limits after numerical scores", () => {
  const inputs = [
    { archetype: "tab", boosts: ["exactURL"] },
    { archetype: "tab", boosts: ["baseDomain"] },
    { archetype: "searchWhatYouTyped" },
  ];
  const result = rankCommandCandidates(inputs, {
    preferredMaximumRanks: { searchWhatYouTyped: 1 },
  });
  assert.equal(result[1].candidate, inputs[2]);
  assert.ok(result[1].score < result[2].score);
});
