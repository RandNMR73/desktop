// Original learned-selection control flow with synthetic identifiers and rows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyLearnedSelection } from "../../src/zen/urlbar/ZenCommandRanking.sys.mjs";

if (process.argv.length !== 3) throw new Error("Usage: node test-learned-selection-reference.mjs reference.json");
const cases = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const [index, item] of cases.entries()) {
  const rows = Object.freeze(item.input.map(candidate => Object.freeze({
    candidate: Object.freeze(candidate), score: candidate.score ?? 0,
  })));
  // The harness supplies archetype equality and empty debug metadata; source
  // tags and scores still pass through the original comparison instructions.
  const suggestionsEqual = (a, b) =>
    a.candidate.suggestionKey === b.candidate.suggestionKey &&
    (a.candidate.sourceTag ?? 0) === (b.candidate.sourceTag ?? 0) && a.score === b.score;
  const result = applyLearnedSelection(rows, { ...item.options, suggestionsEqual });
  assert.deepEqual(result.map(row => rows.indexOf(row)), item.order, `case ${index}`);
}
console.log(JSON.stringify({ cases: cases.length,
  scope: "Original learned-selection branches with supplied identity getter, archetype equality, empty debug metadata and runtime primitives; no history/provider integration claim" }));
