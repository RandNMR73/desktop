// Synthetic inputs and original-control-flow results, generated locally.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyCurrentItemRules, applyInstantLinksPosition } from "../../src/zen/urlbar/ZenCommandRanking.sys.mjs";

const files = process.argv.slice(2);
if (files.length !== 2) throw new Error("Usage: node test-context-ordering-reference.mjs current-item.json instant-links.json");
const counts = [];
for (const [i, fn] of [applyCurrentItemRules, applyInstantLinksPosition].entries()) {
  const cases = JSON.parse(readFileSync(files[i], "utf8"));
  for (const [index, item] of cases.entries()) {
    const rows = item.input.map((candidate, j) => Object.freeze({
      candidate: Object.freeze(candidate), score: 100 - j,
    }));
    Object.freeze(rows);
    const result = fn(rows, item.options);
    assert.deepEqual(result.map(row => rows.indexOf(row)), item.order, `${fn.name} case ${index}`);
  }
  counts.push(cases.length);
}
console.log(JSON.stringify({ currentItemCases: counts[0], instantLinksCases: counts[1],
  scope: "Original ordering branches with synthetic URL metadata and runtime primitives supplied; no provider or visible ordering claim" }));
