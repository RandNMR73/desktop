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

test("the 500-record boundary honors typed count, visit count and recency", () => {
  const rows = Array.from({ length: 500 }, (_, i) => row(i));
  rows.push(row(500, { typedCount: 1 }), row(501, { visitCount: 2 }),
    row(502, { lastVisit: now + 1 }));
  const originalOrder = rows.map(r => r.id);
  assert.deepEqual(prepare(rows).map(r => r.row.id),
    [500, 501, 502, ...Array.from({ length: 497 }, (_, i) => i)]);
  assert.deepEqual(rows.map(r => r.id), originalOrder, "preparation must preserve history order");
});

test("equal metadata preserves history order across the pool cutoff and final ranking", () => {
  const rows = Object.freeze(Array.from({ length: 701 }, (_, i) =>
    Object.freeze(row((i * 37) % 701))));
  assert.deepEqual(prepare(rows).map(r => r.row.id), rows.slice(0, 500).map(r => r.id));
  const ranked = rank(rows);
  assert.deepEqual(ranked.map(r => r.id), rows.slice(0, 7).map(r => r.id));
  assert.deepEqual(ranked.map(r => r.relevance), [826, 825, 824, 823, 822, 821, 820]);
});

test("a full split-cursor pool does not truncate the original query's later matches", () => {
  const split = Array.from({ length: 500 }, (_, i) => row(i, {
    url: `https://scope.example/lat/tice/${i}`, title: "lat tice", visitCount: 2,
  }));
  const original = Array.from({ length: 501 }, (_, i) => row(i + 500, {
    url: `https://scope.example/lattice/${i}`, title: "lattice",
  }));
  const result = prepare([...split, ...original], "lattice", { cursorPosition: 3 });
  assert.equal(result.length, 1000);
  assert.deepEqual(result.slice(0, 500).map(r => r.row.id), original.slice(0, 500).map(r => r.id));
  assert.deepEqual(result.slice(500).map(r => r.row.id), split.map(r => r.id));
});

test("a full original pool does not truncate a disjoint Unicode cursor variant", () => {
  const original = Array.from({ length: 500 }, (_, i) => row(i, {
    url: `https://scope.example/page/${i}`, title: "ος", visitCount: 2,
  }));
  const split = Array.from({ length: 501 }, (_, i) => row(i + 500, {
    url: `https://scope.example/page/${i + 500}`, title: "ο σ",
  }));
  const result = prepare([...original, ...split], "ΟΣ", { cursorPosition: 1 });
  assert.equal(result.length, 1000);
  assert.deepEqual(result.slice(0, 500).map(r => r.row.id), original.map(r => r.id));
  assert.deepEqual(result.slice(500).map(r => r.row.id), split.slice(0, 500).map(r => r.id));
});

test("invalid URLs and unmatched indexed words do not consume a candidate slot", () => {
  const rejected = Array.from({ length: 520 }, (_, i) => row(i, {
    typedCount: 10,
    ...[
      { url: "not a URL", title: "lattice" },
      { url: "ftp://scope.example/lattice", title: "lattice" },
      { url: "https://scope.example/unrelated", title: "unrelated" },
      { url: "https://scope.example/longword", title: "x".repeat(201) + "lattice" },
    ][i % 4],
  }));
  const eligible = Array.from({ length: 501 }, (_, i) => row(i + 1000));
  assert.deepEqual(prepare([...rejected, ...eligible], "lattice").map(r => r.row.id),
    eligible.slice(0, 500).map(r => r.id));
});

test("an unscored indexed match occupies the boundary and contributes host specificity", () => {
  const eligible = Array.from({ length: 501 }, (_, i) => row(i));
  const indexedOnly = row(1000, { typedCount: 1, url: "https://elsewhere.test/",
    title: "scope example lattice" });
  const outsidePool = row(1001, { visitCount: 0, url: "https://third.test/",
    title: "scope example lattice" });
  const result = prepare([...eligible, indexedOnly, outsidePool]);
  assert.deepEqual(result.map(r => r.row.id), eligible.slice(0, 499).map(r => r.id));
  assert.ok(result.every(r => r.specificity === 2.5), "only the two admitted hosts count");
});

test("irrelevant history cannot reorder matches with malformed numeric metadata", () => {
  const malformed = [
    { typedCount: NaN }, { typedCount: Infinity }, { typedCount: -Infinity }, { typedCount: "3" },
    { visitCount: NaN }, { visitCount: undefined }, { visitCount: "2" },
    { lastVisit: NaN }, { lastVisit: undefined }, { lastVisit: "1767225600000" },
  ];
  for (const badKeys of malformed) {
    const matches = Array.from({ length: 23 }, (_, i) => row(i, {
      typedCount: i % 3, visitCount: 23 - i, lastVisit: now - (i % 4) * day,
      ...(i % 4 === 1 ? badKeys : {}),
    }));
    const expanded = matches.flatMap((match, i) => [
      ...Array.from({ length: 25 }, (_, j) => row(1000 + i * 25 + j, {
        url: `https://unrelated.test/page/${i}/${j}`, title: "unrelated",
        typedCount: j % 4, visitCount: j, lastVisit: now - j * day,
      })), match,
    ]);
    const expected = prepare(matches, "lattice");
    const actual = prepare(expanded, "lattice");
    assert.deepEqual(actual, expected, `adding irrelevant rows: ${Object.keys(badKeys)}`);
    assert.deepEqual(rankSiteSearchNavigation(actual, { now }),
      rankSiteSearchNavigation(expected, { now }));
  }
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
