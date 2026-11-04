import assert from "node:assert/strict";
import test from "node:test";
import { prepareSiteSearchNavigation, rankSiteSearchNavigation, siteSearchNavigationWords,
  siteSearchVisitRecency } from "../../src/zen/urlbar/ZenSiteSearchNavigation.sys.mjs";
import { siteSearchCandidates } from "../../src/zen/urlbar/ZenSiteSearchRanking.sys.mjs";

const now = Date.UTC(2026, 0, 1), day = 86400000;
const row = (id, extra = {}) => ({ id, url: `https://scope.example/results?q=lattice+model&v=${id}`,
  title: "lattice model", visitCount: 1, typedCount: 0, lastVisit: now,
  visits: [{ date: now, typed: false }], ...extra });
const prepare = (rows, input = "scope.example lattice", options = {}) =>
  prepareSiteSearchNavigation(rows, input, { locale: "en-US", ...options });
const rank = rows => rankSiteSearchNavigation(prepare(rows), { now });

test("omnibox word boundaries split domains, email, underscores and digit runs", () => {
  const words = siteSearchNavigationWords("en-US");
  assert.deepEqual(words("www.scope.example user@host.test a12_b").map(w => [w.text, w.index]),
    [["www", 0], ["scope", 4], ["example", 10], ["user", 18], ["host", 23],
      ["test", 28], ["a", 33], ["12", 34], ["b", 37]]);
  assert.deepEqual(words("a\uff0eb").map(w => w.text), ["a", "b"]);
  assert.deepEqual(words("1.2").map(w => w.text), ["1", ".", "2"]);
});

test("visit-age buckets use integer days, integer interpolation and float precision", () => {
  const values = [[-1, 1], [0, 1], [4.9, 1], [5, .97], [14, .7], [15, .68],
    [31, .5], [32, .49], [90, .3], [91, .19], [365, .1], [999, .1]];
  for (const [days, expected] of values)
    assert.equal(siteSearchVisitRecency(days), Math.fround(expected), String(days));
});

test("query-and-title matches reproduce the reference navigation arithmetic", () => {
  const source = row(1);
  assert.equal(rank([source])[0].relevance, 826);
  assert.equal(rank([{ ...source, visits: [{ date: now, typed: true }] }])[0].relevance, 968);
  assert.equal(rank([{ ...source, bookmarked: true }])[0].relevance, 1330);
  assert.equal(source.relevance, undefined, "ranking must not mutate source history");
});

test("only the newest ten visits contribute", () => {
  const visits = Array.from({ length: 10 }, (_, i) => ({ date: now - i, typed: false }));
  assert.equal(rank([row(1, { visits })])[0].relevance,
    rank([row(1, { visits: [...visits, { date: now - day, typed: true }] })])[0].relevance);
});

test("specificity counts indexed hosts before rejecting non-contiguous terms", () => {
  const other = row(2, { url: "https://elsewhere.test/", title: "scope example lattice" });
  const results = prepare([row(1), row(3), other]);
  assert.equal(results.length, 2);
  assert.ok(results.every(r => r.specificity === 2.5));
  assert.equal(prepare([row(1), row(3)])[0].specificity, 3);
});

test("cursor variants are scored independently then deduplicated by URL record", () => {
  const rows = [row(1), row(2)];
  const prepared = prepare(rows, "scope.example lattice", { cursorPosition: 2 });
  assert.ok(prepared.length >= 2);
  const results = rankSiteSearchNavigation(prepared, { now });
  assert.equal(results.length, 2);
  assert.equal(new Set(results.map(r => r.id)).size, 2);
});

test("navigation ties consume descending relevance and seven provider slots", () => {
  const results = rank(Array.from({ length: 10 }, (_, i) => row(i)));
  assert.deepEqual(results.map(r => r.relevance), [826, 825, 824, 823, 822, 821, 820]);
  assert.deepEqual(rankSiteSearchNavigation(prepare([row(1)]), { now, limit: 0 }), []);
});

test("title matching counts twenty words and rejects late-only words", () => {
  const base = row(1, { url: "https://scope.example/" });
  const early = prepare([{ ...base, title: "first ".repeat(19) + "lattice" }]);
  const late = prepare([{ ...base, title: "first ".repeat(20) + "lattice" }]);
  assert.equal(early[0].topicality, Math.fround(.9));
  assert.equal(late[0].topicality, .5);
});

test("escaped component delimiters stay in their original URL component", () => {
  const prepared = prepare([row(1, { url: "https://scope.example/?q=%2Flattice", title: "" })],
    "scope.example /lattice");
  assert.equal(prepared[0].topicality, .75);
});

test("Unicode display hosts preserve component offsets and host matches", () => {
  const prepared = prepare([row(1, { url: "https://xn--bcher-kva.test/?q=lattice" })],
    "bücher.test lattice", { displayHost: host => host.replace("xn--bcher-kva", "bücher") });
  assert.equal(prepared[0].topicality, Math.fround((1 + Math.fround(1 + 2.25 * Math.log10(1.3))) / 2));
});

const submissionURL = query => `https://scope.example/results?q=${encodeURIComponent(query)}`;
test("combined navigation upgrades matching search relevance without navigation features", () => {
  const candidates = siteSearchCandidates("lattice", [{ query: "lattice model", relevance: 600 }], {
    submissionURL, navigation: [{ url: submissionURL("lattice model"), relevance: 1304, typedCount: 10 }],
  });
  assert.equal(candidates[1].features.chromiumRelevanceScore, 1304);
  assert.deepEqual(Object.keys(candidates[1].features), ["chromiumRank", "chromiumRelevanceScore"]);
  assert.equal(candidates.length, 2);
});

test("navigation consumes the shared budget before the search scope filters it", () => {
  const rows = ["model", "graph", "tools"].map((suffix, i) => ({ query: `lattice ${suffix}`, relevance: 700 - i }));
  const navigation = Array.from({ length: 6 }, (_, i) => ({ url: `https://scope.example/page/${i}`, relevance: 1300 - i }));
  navigation.push({ url: submissionURL("lattice model"), relevance: 1350 });
  const result = siteSearchCandidates("lattice", rows, { submissionURL, navigation });
  assert.deepEqual(result.map(c => c.title), ["lattice", "lattice model"]);
  assert.deepEqual(result.map(c => c.features.chromiumRank), [1, 2]);
  assert.equal(rows[0].relevance, 700);
});

test("duplicate navigation variants occupy one shared slot", () => {
  const result = siteSearchCandidates("lattice", [{ query: "lattice model", relevance: 600 }], {
    submissionURL,
    navigation: Array.from({ length: 8 }, (_, i) => ({ url: `https://scope.example/page#${i}`, relevance: 1300 })),
    navigationKey: url => url.split("#")[0],
  });
  assert.deepEqual(result.map(c => c.title), ["lattice", "lattice model"]);
});
