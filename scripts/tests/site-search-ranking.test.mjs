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
  assert.equal(result[0].archetype, "chromiumSearchWhatYouTyped");
  assert.equal(result[0].title, "lattice");
});

test("case variants merge by locale while distinct whitespace terms remain distinct", () => {
  const result = siteSearchCandidates("i", [
    { query: "İ", relevance: 1599 }, { query: "I", relevance: 1598 },
    { query: "i  x", relevance: 1597 }, { query: "i x", relevance: 1596 },
  ], { ...options, locale: "tr" });
  assert.deepEqual(result.map(c => c.title), ["İ", "I", "i  x", "i x"]);
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
