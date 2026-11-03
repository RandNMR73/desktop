import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMAND_RANKING_DEFAULTS,
  COMMAND_FEATURE_DEFAULTS,
  applyPreferredMaximumRanks,
  rankCommandCandidates,
  scoreCommandCandidates,
} from "../../src/zen/urlbar/ZenCommandRanking.sys.mjs";

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
