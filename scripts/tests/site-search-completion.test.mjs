/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { siteSearchCompletion } from "../../src/zen/urlbar/ZenSiteSearchTerms.sys.mjs";

const reference = JSON.parse(readFileSync(new URL(
  "../../tools/site-search-history/completion-prefix-reference.json", import.meta.url)));

test("completion agrees with native Swift character prefixes and UTF-16 selection", () => {
  assert.ok(reference.cases.length > 600);
  for (const row of reference.cases) {
    const { query, suggestion, hasPrefix } = row;
    const matched = { value: suggestion,
      selectionStart: Math.min(row.selectionStart, suggestion.length),
      selectionEnd: row.selectionEnd };
    assert.deepEqual(siteSearchCompletion(query, suggestion), hasPrefix ? matched : null,
      JSON.stringify(row));
    assert.deepEqual(siteSearchCompletion(query, suggestion, 1), matched, JSON.stringify(row));
  }
});

test("initial mismatched case stays typed; an arrow-selected row fills its whole term", () => {
  assert.equal(siteSearchCompletion("LATTICE", "lattice models"), null);
  assert.deepEqual(siteSearchCompletion("LATTICE", "lattice models", 1), {
    value: "lattice models", selectionStart: 14, selectionEnd: 14,
  });
  assert.deepEqual(siteSearchCompletion("lattice", "lattice models", 1), {
    value: "lattice models", selectionStart: 7, selectionEnd: 14,
  });
});

test("empty scopes retain their prompt even while moving among recent searches", () => {
  for (const index of [0, 1, 4]) assert.equal(siteSearchCompletion("", "recent search", index), null);
  assert.equal(siteSearchCompletion("query", undefined), null);
});
