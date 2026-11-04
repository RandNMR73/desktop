import assert from "node:assert/strict";
import test from "node:test";
import { siteSearchCandidates, rankSiteSearchCandidates } from "../../src/zen/urlbar/ZenSiteSearchRanking.sys.mjs";

const options = { locale: "en-US", submissionURL: query =>
  `https://fixture.test/search?q=${encodeURIComponent(query)}` };

test("a weak or tied exact history record cannot remove the literal query", () => {
  for (const relevance of [900, 1500]) {
    const result = siteSearchCandidates("Lattice", [{ query: "lattice", relevance }], options);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, "Lattice");
    assert.equal(result[0].row.literal, true);
  }
  const result = siteSearchCandidates("Lattice", [{ query: "lattice", relevance: 1599 }], options);
  assert.equal(result.length, 1);
  assert.equal(result[0].archetype, "chromiumSearchOtherEngine");
  assert.equal(result[0].title, "Lattice");
  assert.deepEqual(result[0].features, {}, "replacement has no Chromium rank or relevance");
});

test("case variants merge by locale while distinct whitespace terms remain distinct", () => {
  const result = siteSearchCandidates("i", [
    { query: "İ", relevance: 1599 }, { query: "I", relevance: 1598 },
    { query: "i  x", relevance: 1597 }, { query: "i x", relevance: 1596 },
  ], { ...options, locale: "tr" });
  assert.deepEqual(result.map(c => c.title), ["İ", "i  x", "i"]);
});

test("local history is limited before command normalization, independently of popup size", () => {
  const rows = [1599, 1501, 1499, 1498, 700].map((relevance, i) =>
    Object.freeze({ query: `lattice ${i}`, relevance }));
  for (const limit of [4, 10, 20]) {
    const result = siteSearchCandidates("lattice", rows, { ...options, limit });
    assert.deepEqual(result.map(c => c.title), ["lattice 0", "lattice 1", "lattice", "lattice 2"]);
    assert.deepEqual(result.map(c => c.features.chromiumRank), [1, 2, 3, 4]);
  }
  assert.equal(siteSearchCandidates("lattice", rows, { ...options, limit: 2 }).length, 2);
  assert.deepEqual(siteSearchCandidates("lattice", rows, { ...options, limit: 0 }), []);
});

test("duplicate terms consume one slot; an exact history winner still consumes a history slot", () => {
  const result = siteSearchCandidates("lattice", [
    { query: "lattice", relevance: 1599 },
    { query: "LATTICE", relevance: 1598 },
    { query: "lattice a", relevance: 1597 },
    { query: "lattice b", relevance: 1596 },
    { query: "lattice c", relevance: 1595 },
  ], options);
  assert.deepEqual(result.map(c => c.title), ["lattice a", "lattice b", "lattice"]);
  assert.deepEqual(result.map(c => c.features), [
    { chromiumRank: 1, chromiumRelevanceScore: 1597 },
    { chromiumRank: 2, chromiumRelevanceScore: 1596 },
    {},
  ]);
});

test("a literal crowded out by navigation is restored without navigation signals", () => {
  const navigation = Array.from({ length: 8 }, (_, i) => ({
    url: `https://fixture.test/document/${i}`, relevance: 1600 + i,
  }));
  const result = siteSearchCandidates("Lattice", [], { ...options, navigation });
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "Lattice");
  assert.equal(result[0].url, options.submissionURL("Lattice"));
  assert.equal(result[0].archetype, "chromiumSearchOtherEngine");
  assert.deepEqual(result[0].features, {});
});

test("scope equality uses Swift lowercase, separately from locale history deduplication", () => {
  const result = siteSearchCandidates("i", [{ query: "İ", relevance: 1599 }],
    { ...options, locale: "tr" });
  assert.deepEqual(result.map(c => c.title), ["İ", "i"]);
  assert.equal(result[0].archetype, "chromiumSearchHistory");
  assert.deepEqual(result[1].features, {});
  const canonical = siteSearchCandidates("é", [{ query: "e\u0301", relevance: 1599 }], options);
  assert.deepEqual(canonical.map(c => c.title), ["é"]);
  assert.equal(canonical[0].row.literal, true);
});

test("engine submissions replace history tracking URLs and rank is assigned after deduplication", () => {
  const rows = Object.freeze([
    Object.freeze({ query: "lattice model", relevance: 1599, url: "https://tracker.invalid", date: 1, visitCount: 7 }),
    Object.freeze({ query: "lattice model", relevance: 1501 }),
    Object.freeze({ query: "lattice old", relevance: 0 }),
  ]);
  const result = siteSearchCandidates("lattice", rows, options);
  assert.deepEqual(result.map(c => c.title), ["lattice model", "lattice"]);
  assert.equal(result[0].url, "https://fixture.test/search?q=lattice%20model");
  assert.deepEqual(result.map(c => c.features), [
    { chromiumRank: 1, chromiumRelevanceScore: 1599 },
    { chromiumRank: 2, chromiumRelevanceScore: 1500 },
  ]);
});

test("Arc's history archetype can beat a higher-relevance literal search", () => {
  const candidates = siteSearchCandidates("lattice", [{ query: "lattice models", relevance: 700 }], options);
  assert.equal(candidates[0].row.literal, true);
  const signals = candidates.map(() => ({ features: {}, boosts: [] }));
  const result = rankSiteSearchCandidates(candidates, signals, {});
  assert.equal(result[0].title, "lattice models");
  assert.equal(result[1].title, "lattice");
  assert.equal(candidates[0].row.literal, true, "input order must remain unchanged");
});

test("phrase rules do not promote another-engine literal ahead of history", () => {
  const candidates = siteSearchCandidates("lattice m", [{ query: "lattice models", relevance: 700 }], options);
  const signals = candidates.map(() => ({ features: {}, boosts: [] }));
  const result = rankSiteSearchCandidates(candidates, signals, {
    isPhraseSearch: true, preferredMaxRanks: { chromiumSearchWhatYouTyped: 0 },
  });
  assert.equal(result[0].title, "lattice models");
  assert.deepEqual(rankSiteSearchCandidates(candidates, null, {}), candidates);
});
