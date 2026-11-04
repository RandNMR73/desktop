// Compare with locally generated synthetic reference cases. No proprietary
// executable bytes or personal browsing data belong in the reference JSON.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyInitialCommandRules } from "../../src/zen/urlbar/ZenCommandRanking.sys.mjs";

if (!process.argv[2]) throw new Error("Usage: node test-post-sort-reference.mjs reference.json");
const cases = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const [index, item] of cases.entries()) {
  const rows = item.input.map((candidate, i) => Object.freeze({
    candidate: Object.freeze(candidate), score: 100 - i,
  }));
  Object.freeze(rows);
  const result = applyInitialCommandRules(rows);
  assert.deepEqual(result.map(row => rows.indexOf(row)), item.order, `case ${index}`);
}
console.log(JSON.stringify({ passed: cases.length,
  scope: "Initial three post-sort rules with prepared URL keys and explicit tab identities; no provider or visible ordering claim" }));
