import assert from "node:assert/strict";
import test from "node:test";
import { commandPrefixHistory, commandPrefixInput } from "../../src/zen/urlbar/ZenCommandPrefixHistory.sys.mjs";

const DAY = 86400000, now = Date.UTC(2026, 10, 5);
const canonicalize = text => {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `http://${text}`);
    return { url: url.href, hasCredentials: !!(url.username || url.password) };
  } catch { return null; }
};
const row = (path, typedCount, visitCount = typedCount, age = 0, extra = {}) => Object.freeze({
  url: `https://www.fixture.test/${path}`, typedCount, visitCount,
  lastVisit: now - age * DAY, ...extra,
});
const options = { text: "fixture.test", canonicalize, now, allowWhatYouTyped: true };
const fields = rows => rows.map(({ url, relevance, type }) => [url, relevance, type]);

test("canonical prefix input preserves incomplete hosts and the user's slash boundary", () => {
  for (const [input, expected] of [
    ["fixture", "fixture"], ["fixture.test", "fixture.test"],
    ["fixture.test/", "fixture.test/"], ["fixture.test\\", "fixture.test/"],
    ["fixture.test/some path", "fixture.test/some%20path"],
    ["HTTP://FIXTURE.test/Path", "http://fixture.test/Path"],
    ["https://fixture.test/", "https://fixture.test/"],
    ["http://", "http://"], ["17173", "17173"],
  ]) assert.equal(commandPrefixInput(input, canonicalize), expected, input);
  assert.equal(commandPrefixInput("17173", canonicalize, { inputIsURL: true }), "0.0.67.21");
});

test("a typed exact URL is synchronous; the final pass adds the provider's history budget", () => {
  const rows = [row("", 8, 8, 4), row("a", 30, 62, 20), row("b", 13, 26, 46), row("c", 11, 23, 31)];
  const result = commandPrefixHistory(rows, options);
  assert.deepEqual(fields(result.initial), [[rows[0].url, 1413, "url-what-you-typed"]]);
  assert.deepEqual(fields(result.final), [
    [rows[0].url, 1413, "url-what-you-typed"],
    [rows[1].url, 1412, "history-url"], [rows[2].url, 1411, "history-url"],
    [rows[3].url, 1410, "history-url"],
  ]);
});

test("a previously unseen host does not invent carried history", () => {
  const result = commandPrefixHistory([], options);
  assert.deepEqual(result.initial, result.final);
  assert.deepEqual(fields(result.final), [["http://fixture.test/", 1203, "url-what-you-typed"]]);
  assert.deepEqual(commandPrefixHistory([], { ...options, allowWhatYouTyped: false }),
    { initial: [], final: [] });
});

test("the typed pass cannot see an untyped exact URL or replace an existing inline choice", () => {
  const rows = [row("", 0, 100), row("a", 10, 30)];
  const result = commandPrefixHistory(rows, options);
  assert.equal(result.initial[0].url, rows[1].url);
  assert.equal(result.final[0].url, rows[1].url);
  assert.equal(result.final[0].relevance, 1413);
  assert.ok(result.final.every(match => match.type === "history-url"));
});

test("untyped exact URLs retain the original verbatim score when they become visible", () => {
  const rows = [row("", 0, 100)];
  const result = commandPrefixHistory(rows, options);
  assert.equal(result.initial[0].url, "http://fixture.test/");
  assert.deepEqual(fields(result.final), [[rows[0].url, 1203, "url-what-you-typed"]]);
});

test("hidden and weak old matches are excluded; default-engine search URLs are excluded", () => {
  const rows = [row("hidden", 100, 100, 0, { hidden: true }), row("old", 0, 1, 91),
    row("recent", 0, 1, 90), row("popular", 0, 2, 100), row("excluded", 50, 50)];
  const result = commandPrefixHistory(rows, { ...options,
    exclude: url => url === rows[4].url });
  assert.ok(!result.final.some(match => [rows[0].url, rows[1].url, rows[4].url].includes(match.url)));
  assert.ok(result.final.some(match => match.url === rows[2].url));
  assert.ok(result.final.some(match => match.url === rows[3].url));
});

test("significance admits the 90-day boundary and rejects an older single untyped visit", () => {
  const boundary = row("boundary", 0, 1, 90);
  const older = { ...boundary, lastVisit: boundary.lastVisit - 1 };
  const hasURL = entry => commandPrefixHistory([entry], options).final
    .some(match => match.url === entry.url);
  assert.equal(hasURL(boundary), true);
  assert.equal(hasURL(older), false);
  assert.equal(hasURL({ ...older, typedCount: 1 }), true);
  assert.equal(hasURL({ ...older, visitCount: 2 }), true);
  assert.equal(hasURL({ ...boundary, hidden: true }), false);
});

test("the database prefix cap precedes significance filtering and never backfills rejected rows", () => {
  const excluded = Array.from({ length: 6 }, (_, index) => row(`excluded-${index}`, 30 - index));
  const keep = row("would-backfill", 1);
  const result = commandPrefixHistory([...excluded, keep], {
    ...options, exclude: url => url.includes("excluded-"),
  });
  assert.equal(result.final.length, 1);
  assert.equal(result.final[0].type, "url-what-you-typed");
});

test("innermost prefix matches outrank matches against a scheme before comparing counts", () => {
  const inner = { ...row("", 1), url: "http://http.test/" };
  const outer = { ...row("", 20), url: "http://elsewhere.test/" };
  const result = commandPrefixHistory([outer, inner], { ...options, text: "http", allowWhatYouTyped: false });
  assert.equal(result.initial[0].url, inner.url);
  assert.equal(result.final[0].url, inner.url);
  assert.equal(result.final.filter(match => match.url === inner.url).length, 1);
});

test("one typed visit favors a host over a deeper page even with fewer ordinary visits", () => {
  const host = { ...row("", 1, 1), url: "https://www.fixture-alpha.test/" };
  const page = { ...row("deep", 1, 100), url: "https://www.fixture-beta.test/deep" };
  const result = commandPrefixHistory([page, host], { ...options, text: "fixture", allowWhatYouTyped: false });
  assert.equal(result.initial[0].url, host.url);
});

test("a sufficiently visited shorter prefix can replace a deeply typed inline match", () => {
  const parent = row("path/", 2, 10), child = row("path/child", 20, 30);
  const result = commandPrefixHistory([child, parent], { ...options, text: "fixture.test/path", allowWhatYouTyped: false });
  assert.equal(result.initial[0].url, parent.url);
  assert.equal(result.final[0].url, parent.url);
  const weak = commandPrefixHistory([child, { ...parent, visitCount: 9 }],
    { ...options, text: "fixture.test/path", allowWhatYouTyped: false });
  assert.equal(weak.initial[0].url, child.url);
});

test("typed-count decay demotes later matches while preserving the top completion", () => {
  const rows = [row("", 1, 10, 100), row("a", 2, 4, 60), row("b", 1, 4, 60)];
  const result = commandPrefixHistory(rows, options);
  assert.deepEqual(result.final.map(match => match.relevance), [1413, 1250, 1203]);
});

test("redirect culling retains the highest-ranked occurrence even if the chain points backward", () => {
  const rows = [row("", 8), row("a", 30), row("b", 20), row("c", 10), row("d", 5)];
  const redirects = new Map([[rows[2].url, [rows[1].url]]]);
  const result = commandPrefixHistory(rows, { ...options, redirects });
  assert.deepEqual(result.final.map(match => match.url), [rows[0].url, rows[1].url, rows[3].url, rows[4].url]);
});

test("a keyword scope can request a larger budget without changing scoring", () => {
  const rows = [row("", 8), ...Array.from({ length: 10 }, (_, i) => row(`path-${i}`, 30 - i))];
  assert.equal(commandPrefixHistory(rows, options).final.length, 4);
  assert.equal(commandPrefixHistory(rows, { ...options, limit: 7 }).final.length, 8);
  assert.deepEqual(commandPrefixHistory(rows, { ...options, limit: 0 }), { initial: [], final: [] });
});

test("prevent-inline disallows a longer completion and retains a verbatim default", () => {
  const rows = [row("long", 8)];
  const result = commandPrefixHistory(rows, { ...options, preventInline: true });
  assert.equal(result.initial[0].allowedToBeDefaultMatch, false);
  assert.equal(result.initial[1].type, "url-what-you-typed");
  assert.equal(result.initial[1].allowedToBeDefaultMatch, true);
});

test("credentials do not turn a stripped-host lookup into a visited exact URL", () => {
  const host = row("", 10);
  const result = commandPrefixHistory([host], {
    ...options, text: "user@www.fixture.test", allowWhatYouTyped: false,
  });
  assert.deepEqual(result, { initial: [], final: [] });
});
