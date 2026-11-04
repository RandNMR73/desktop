/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  collapseSiteSearchWhitespace, siteSearchTermKey, collectSiteSearchTerms,
  siteSearchHistoryRelevance, siteSearchWordCounter, scoreSiteSearchTerms,
} from "../../src/zen/urlbar/ZenSiteSearchTerms.sys.mjs";

test("history relevance agrees with 1,632 isolated original-instruction cases", () => {
  const reference = JSON.parse(readFileSync(new URL(
    "../../tools/site-search-history/history-relevance-reference.json", import.meta.url)));
  assert.equal(reference.cases.length, 1632);
  for (const [age, keyword, hasKeyword, inputIsURL, aggressive, expected] of reference.cases) {
    const options = { keyword: !!keyword, hasKeyword: !!hasKeyword,
      inputIsURL: !!inputIsURL, aggressive: !!aggressive };
    assert.equal(siteSearchHistoryRelevance(age, options), expected, JSON.stringify({ age, ...options }));
  }
});

test("term whitespace includes NEL and excludes BOM and zero-width spaces", () => {
  const spaces = [9, 10, 11, 12, 13, 32, 133, 160, 5760,
    ...Array.from({ length: 11 }, (_, i) => 8192 + i), 8232, 8233, 8239, 8287, 12288];
  for (const code of spaces) {
    const ch = String.fromCharCode(code);
    assert.equal(collapseSiteSearchWhitespace(`${ch}A${ch}${ch}B${ch}`), "A B", code.toString(16));
  }
  for (const ch of ["\ufeff", "\u200b", "\u180e"]) {
    assert.equal(collapseSiteSearchWhitespace(`${ch}A${ch}`), `${ch}A${ch}`);
  }
});

test("keys use locale lowercasing without accent folding or canonical normalization", () => {
  assert.equal(siteSearchTermKey("  FOO\tBAR ", "en"), "foo bar");
  assert.equal(siteSearchTermKey("I İ", "tr"), "ı i");
  assert.equal(siteSearchTermKey("I İ", "en"), "i i\u0307");
  assert.notEqual(siteSearchTermKey("é", "en"), siteSearchTermKey("e\u0301", "en"));
  assert.notEqual(siteSearchTermKey("Straße", "en"), siteSearchTermKey("STRASSE", "en"));
});

const row = (query, date, visitCount = 1) => ({ query, date, visitCount });
test("typed terms match normalized prefixes, preserve spelling, and precede limiting", () => {
  const rows = [row("an unrelated word", 8), row("Query Two", 4), row("query one", 9), row("X query", 10)];
  assert.deepEqual(collectSiteSearchTerms(rows, "  QUERY\t", { limit: 1, locale: "en" })
    .map(r => r.query), ["query one"]);
  assert.deepEqual(collectSiteSearchTerms(rows, ""), []);
  assert.deepEqual(collectSiteSearchTerms(rows, "query", { limit: 0 }), []);
});

test("a URL variant within five minutes retains the older representative and count", () => {
  const rows = [row("QUERY", 300000, 8), row("query", 0, 2), row("Query", 300001, 3)];
  const original = structuredClone(rows);
  const result = collectSiteSearchTerms(rows, "q", { locale: "en" });
  assert.deepEqual(result, [{ query: "Query", key: "query", date: 300001, visitCount: 5 }]);
  assert.deepEqual(rows, original);
});

test("duplicate intervals compare against the retained URL rather than a sliding window", () => {
  const result = collectSiteSearchTerms([row("q", 0, 2), row("Q", 200000, 4), row("q", 400000, 8)], "q");
  assert.equal(result[0].visitCount, 10);
  assert.equal(result[0].date, 400000);
});

test("old typed history remains eligible independently of the empty-scope 14-day list", () => {
  const now = 100 * 86400000;
  assert.equal(collectSiteSearchTerms([row("older query", now - 40 * 86400000)], "older").length, 1);
});

test("zero-count search records remain eligible while malformed records are rejected", () => {
  const result = collectSiteSearchTerms([row("query zero", 1, 0), row("query invalid", 1, -1),
    row("query invalid", Infinity), row(null, 1), row("query invalid", 1, NaN)], "query");
  assert.deepEqual(result.map(r => r.query), ["query zero"]);
});

test("word detection handles punctuation and CJK rather than splitting only spaces", () => {
  const multiple = siteSearchWordCounter("en");
  for (const text of ["one", "don't", "123", "..."]) assert.equal(multiple(text), false, text);
  for (const text of ["one two", "one-two", "one/two", "中文搜索"]) assert.equal(multiple(text), true, text);
});

test("single-visit multiword searches do not receive the recent inline score", () => {
  const now = 10 * 86400000;
  const results = scoreSiteSearchTerms([row("one two", now, 1), row("once", now, 1)], "on", { now });
  assert.deepEqual(results.map(r => [r.query, r.relevance]), [["once", 1599], ["one two", 1050]]);
});

test("multiword input retains a leading repeated recent phrase and unique decreasing scores", () => {
  const now = 10 * 86400000;
  const results = scoreSiteSearchTerms([row("one two", now - 1000, 2), row("one three", now, 1)],
    "one t", { now });
  assert.deepEqual(results.map(r => [r.query, r.relevance]), [["one two", 1599], ["one three", 1050]]);
});

test("without a repeated recent phrase multiword input can score a one-visit phrase aggressively", () => {
  const now = 10 * 86400000;
  const results = scoreSiteSearchTerms([row("one two", now, 1), row("one three", now, 1)], "one t", { now });
  assert.deepEqual(results.map(r => r.relevance), [1599, 1598]);
});

test("the exact previously searched term stays first even when it is older", () => {
  const now = 10 * 86400000;
  const results = scoreSiteSearchTerms([row("query more", now, 2), row("query", 0, 2)], "query", { now });
  assert.equal(results[0].query, "query");
  assert.equal(results[1].relevance, results[0].relevance - 1);
});

test("URL classification demotes the entire history list without reordering it", () => {
  const now = 10 * 86400000;
  const input = [row("fixture.test", now, 2), row("fixture.test/topic", now - 1000, 2)];
  let classifications = 0;
  const result = scoreSiteSearchTerms(input, "fix", { now, isNavigation: () => { classifications++; return true; } });
  assert.deepEqual(result.map(r => r.relevance), [1049, 1048]);
  assert.equal(classifications, 1);
  for (const options of [{ preventInline: true }, { inputIsURL: true }]) {
    scoreSiteSearchTerms(input, "fix", { now, ...options, isNavigation: () => assert.fail("no recursive classification") });
  }
});

test("literal equality is case-sensitive in the history score pass", () => {
  const now = 10 * 86400000;
  const result = scoreSiteSearchTerms([row("QUERY more", now, 2), row("query", 0, 2)], "QUERY", { now });
  assert.equal(result[0].query, "QUERY more");
});
