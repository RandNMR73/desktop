import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMAND_RANKING_DEFAULTS,
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
  close(scores[0].score, 1);
  close(scores[1].score, -1);
});

test("feature groups are averaged before applying category weights", () => {
  const rows = scoreCommandCandidates([
    { archetype: "tab", features: { urlMatchScore: 0, titleMatchScore: 9 } },
    { archetype: "tab", features: { urlMatchScore: 1, titleMatchScore: 1 } },
  ], { explain: true });
  // URL has weight 1, title has weight 0.5. The match group weighs 2;
  // the constant archetype still contributes weight 35 with score zero.
  close(rows[0].components.find((x) => x.name === "match").score, -1 / 3);
  close(rows[0].score, -2 / 111);
  close(rows[1].score, 2 / 111);
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
    close(high.components[1].score, direction);
    close(low.components[1].score, -direction);
  }
});

test("missing values are omitted from statistics and category denominators", () => {
  const rows = scoreCommandCandidates([
    { archetype: "tab", features: { frequencyEver: 0 } },
    { archetype: "tab", features: { frequencyEver: 10 } },
    { archetype: "tab" },
  ], { explain: true });
  close(rows[0].score, -2 / 9);
  close(rows[1].score, 2 / 9);
  close(rows[2].score, 0);
  assert.deepEqual(rows[2].components.map((x) => x.name), ["archetype"]);
});

test("query-local normalization changes when another candidate arrives", () => {
  const inputs = [
    { archetype: "tab", features: { frequencyEver: 0 } },
    { archetype: "tab", features: { frequencyEver: 2 } },
  ];
  const initial = scoreCommandCandidates(inputs);
  close(initial[1].score, 2 / 9);
  const expanded = scoreCommandCandidates([
    ...inputs,
    { archetype: "tab", features: { frequencyEver: 100 } },
  ]);
  const populationDeviation = Math.sqrt((34 ** 2 + 32 ** 2 + 66 ** 2) / 3);
  close(expanded[1].score, (2 / 9) * (-32 / populationDeviation));
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
  // Every category of the first candidate scores +1: 35 + 10 + 15 + 15 = 75.
  close(scores[0].score, (75 + 100 * 15) / (75 + 100));
  close(scores[1].score, -1);
  assert.equal(scores[0].components.filter((x) => x.name === "exactBaseDomain").length, 1);
  inputs[0].boosts = ["customTitlePrefix"];
  close(scoreCommandCandidates(inputs)[0].score, (75 + 15 * 3) / (75 + 15));
});

test("constant signals retain category weight while contributing zero", () => {
  const rows = scoreCommandCandidates([
    { archetype: "tab", features: { frequencyEver: 7 }, boosts: ["customTitlePrefix"] },
    { archetype: "tab", boosts: ["customTitlePrefix"] },
  ]);
  close(rows[0].score, 45 / 60);
  close(rows[1].score, 45 / 50);
});

test("disabled categories do not dilute the score", () => {
  const config = structuredClone(COMMAND_RANKING_DEFAULTS);
  config.importance.weight = 0;
  const rows = scoreCommandCandidates([
    { archetype: "tab", features: { frequencyEver: 0 }, boosts: ["customTitlePrefix"] },
    { archetype: "tab", features: { frequencyEver: 9 } },
  ], { config, explain: true });
  close(rows[0].score, 45 / 50);
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
  close(recent.components[1].score, 1);
  close(old.components[1].score, -1);
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
