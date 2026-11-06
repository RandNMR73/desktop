import assert from "node:assert/strict";
import test from "node:test";
import { CommandResultAccumulator, transferCommandMatches } from
  "../../src/zen/urlbar/ZenCommandResultBatches.sys.mjs";
import { siteSearchCandidates, rankSiteSearchCandidates } from
  "../../src/zen/urlbar/ZenSiteSearchRanking.sys.mjs";

const match = (providerName, id, relevance, extra = {}) => Object.freeze({
  providerName, url: `https://fixture.test/${id}`, relevance,
  type: "history-url", allowedToBeDefaultMatch: false, ...extra,
});
const literal = match("Search", "literal", 1500, {
  type: "search-other-engine", allowedToBeDefaultMatch: true,
});
const key = row => row.id;

test("later batches preserve first identities, positions and scores", () => {
  const first = Object.freeze({ id: "first", score: 10 });
  const last = Object.freeze({ id: "later", score: 90 });
  const results = new CommandResultAccumulator(key);
  assert.deepEqual(results.append([first, { id: "literal", score: 2 }]).map(key),
    ["first", "literal"]);
  assert.deepEqual(results.append([last, { id: "first", score: 100 }]), [last]);
  assert.deepEqual(results.results.map(key), ["first", "literal", "later"]);
  assert.equal(results.results[0], first, "later scores cannot replace the first result");
  results.append([]);
  assert.equal(results.results.length, 3, "absence in a later batch does not remove a result");
  results.results.pop();
  assert.equal(results.results.length, 3, "callers cannot mutate the internal result list");
});

test("duplicate identities within a batch and query boundaries are independent", () => {
  const a = new CommandResultAccumulator(key), b = new CommandResultAccumulator(key);
  const first = { id: "same", title: "First" }, later = { id: "same", title: "Later" };
  assert.deepEqual(a.append([first, later]), [first]);
  assert.deepEqual(b.append([later]), [later]);
  assert.equal(a.results[0], first);
  assert.equal(b.results[0], later);
});

test("a provider carries only its count deficit, starting with its lowest matches", () => {
  const old = [match("HistoryURL", "high", 1413), match("HistoryURL", "middle", 1412),
    match("HistoryURL", "low", 1411)];
  const fresh = match("HistoryURL", "new", 1300, { allowedToBeDefaultMatch: true });
  const result = transferCommandMatches([literal, fresh], old);
  assert.deepEqual(result.slice(2).map(row => row.url), [old[2].url, old[1].url]);
  assert.deepEqual(result.slice(2).map(row => row.relevance), [1299, 1299]);
  assert.ok(result.slice(2).every(row => row.fromPrevious && !row.allowedToBeDefaultMatch));
  assert.equal(old[2].relevance, 1411);
  assert.equal(result[0], literal);
});

test("counts are per provider and destinations are deduplicated within that provider", () => {
  const old = [match("HistoryURL", "high", 1413), match("HistoryURL", "same", 1412),
    match("HistoryURL", "low", 1411), match("HistoryQuick", "same", 1200)];
  const fresh = match("HistoryURL", "same", 1300);
  const result = transferCommandMatches([literal, fresh], old);
  assert.deepEqual(result.slice(2).map(row => [row.providerName, row.url]), [
    ["HistoryURL", old[2].url], ["HistoryURL", old[0].url], ["HistoryQuick", old[3].url],
  ]);
  assert.deepEqual(transferCommandMatches([literal, fresh], old, {
    doneProviders: new Set(["HistoryURL", "HistoryQuick"]),
  }), [literal, fresh]);
});

test("canonical destinations prevent carried duplicates and equal counts carry nothing", () => {
  const old = [match("HistoryURL", "same?tracking=1", 1413), match("HistoryURL", "old", 1412)];
  const fresh = match("HistoryURL", "same?tracking=2", 1300);
  const destinationKey = row => row.url.split("?")[0];
  assert.deepEqual(transferCommandMatches([literal, fresh], old, { destinationKey })
    .slice(2).map(row => row.url), [old[1].url]);
  assert.deepEqual(transferCommandMatches([literal, fresh], old.slice(0, 1)), [literal, fresh]);
});

test("old scores never increase and providers without a default use the global default cap", () => {
  const old = [match("HistoryURL", "strong", 1600), match("HistoryURL", "weak", 300)];
  const result = transferCommandMatches([literal], old);
  assert.deepEqual(result.slice(1).map(row => row.relevance), [300, 1499]);
});

test("synchronous/action types and done providers never survive into the next batch", () => {
  const old = ["url-what-you-typed", "search-what-you-typed", "pedal", "tile-navsuggest",
    "tile-suggestion"].map(type => match("HistoryURL", type, 1000, { type }));
  old.push(match("HistoryQuick", "done", 1100));
  assert.deepEqual(transferCommandMatches([literal], old,
    { doneProviders: new Set(["HistoryQuick"]) }), [literal]);
  assert.deepEqual(transferCommandMatches([], old,
    { doneProviders: new Set(["HistoryQuick"]) }), []);
});

test("an empty current batch copies eligible old records without changing default status", () => {
  const old = match("HistoryURL", "inline", 1413, { allowedToBeDefaultMatch: true });
  const result = transferCommandMatches([], [old]);
  assert.deepEqual(result, [{ ...old, fromPrevious: true }]);
  assert.notEqual(result[0], old);
});

test("prevent-inline can only retain default eligibility through the caller's input check", () => {
  const old = [match("HistoryURL", "default", 1413, { allowedToBeDefaultMatch: true }),
    match("HistoryURL", "not-default", 1412)];
  const result = transferCommandMatches([literal], old, {
    preventInline: true, canRemainDefault: () => true,
  });
  assert.deepEqual(result.slice(1).map(row => row.allowedToBeDefaultMatch), [false, true]);
  assert.ok(transferCommandMatches([literal], old).slice(1)
    .every(row => !row.allowedToBeDefaultMatch));
});

test("alias carry-over explains the first-search ordering without site-specific rules", () => {
  // Anonymized structure of the native initial/final emissions: three carried
  // URL matches compete with search history for the shared eight-result budget.
  // The same final candidates produce a different UI order after a fresh reset.
  const rows = [1303, 1200, 1011].map((relevance, index) =>
    ({ query: `lattice history ${index + 1}`, relevance }));
  const navigation = [1313, 1290, 1085, 1005].map((score, index) =>
    match("HistoryQuick", `navigation-${index}`, score));
  const old = [1412, 1411, 1410].map((score, index) =>
    match("HistoryURL", `previous-${index}`, score));
  const initialNavigation = transferCommandMatches([literal, ...navigation], old)
    .filter(row => row.providerName !== "Search");
  const options = { locale: "en-US", submissionURL: text =>
    `https://fixture.test/search?q=${encodeURIComponent(text)}` };
  const batch = navigationRows => {
    const candidates = siteSearchCandidates("lattice", rows, { ...options, navigation: navigationRows });
    return rankSiteSearchCandidates(candidates, candidates.map(() => ({ features: {}, boosts: [] })), {});
  };
  const initial = batch(initialNavigation), final = batch(navigation);
  assert.deepEqual(initial.map(row => row.title), [rows[0].query, rows[1].query, "lattice"]);
  assert.deepEqual(final.map(row => row.title), [...rows.map(row => row.query), "lattice"]);
  const identity = row => row.title.toLowerCase().normalize("NFC");
  const transitioned = new CommandResultAccumulator(identity);
  transitioned.append(initial);
  transitioned.append(final);
  assert.deepEqual(transitioned.results.map(row => row.title),
    [rows[0].query, rows[1].query, "lattice", rows[2].query]);
  const reset = new CommandResultAccumulator(identity);
  reset.append(final);
  assert.deepEqual(reset.results.map(row => row.title), [...rows.map(row => row.query), "lattice"]);
});

test("search identity follows canonical lowercase, not destination or locale collation", () => {
  const accumulator = new CommandResultAccumulator(row => row.title.toLowerCase().normalize("NFC"));
  accumulator.append([{ title: "É", url: "https://one.test" }]);
  assert.deepEqual(accumulator.append([{ title: "e\u0301", url: "https://two.test" }]), []);
  assert.equal(accumulator.append([{ title: "İ" }, { title: "i" }]).length, 2);
  assert.deepEqual(accumulator.results.map(row => row.title), ["É", "İ", "i"]);
});
