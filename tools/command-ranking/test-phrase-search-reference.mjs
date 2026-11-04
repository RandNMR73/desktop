// Original phrase-search ordering with synthetic ASCII/native predicates.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyPhraseSearchRules } from "../../src/zen/urlbar/ZenCommandRanking.sys.mjs";

if (process.argv.length !== 3) throw new Error("Usage: node test-phrase-search-reference.mjs reference.json");
const cases = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const [index, item] of cases.entries()) {
  const query = item.options.query;
  assert.match(query, /^[\x00-\x7f]*$/);
  const rows = Object.freeze(item.input.map((candidate, j) => Object.freeze({
    candidate: Object.freeze({ ...candidate, suggestionKey: candidate.suggestionKey ?? String(j),
      phraseSearchActionPrefix: candidate.archetype === "typeTravel" &&
        (candidate.hotWords ?? []).some(word => query.toLowerCase().startsWith(word.toLowerCase())),
    }), score: candidate.score ?? 0,
  })));
  const suggestionsEqual = (a, b) =>
    a.candidate.suggestionKey === b.candidate.suggestionKey &&
    (a.candidate.sourceTag ?? 0) === (b.candidate.sourceTag ?? 0) && a.score === b.score;
  const result = applyPhraseSearchRules(rows, {
    isPhraseSearch: query.includes(" ") && item.options.urlInterpretation === "search", suggestionsEqual,
  });
  assert.deepEqual(result.map(row => rows.indexOf(row)), item.order, `case ${index}`);
}
console.log(JSON.stringify({ cases: cases.length,
  scope: "Original phrase-search ordering with supplied URL classification, ASCII String operations, archetype equality, empty debug metadata and collection primitives; no live provider claim" }));
