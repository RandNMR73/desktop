import { performance } from "node:perf_hooks";
import { rankCommandCandidates } from "../../src/zen/urlbar/ZenCommandRanking.sys.mjs";

// Synthetic, non-private inputs. This measures scoring only, not provider I/O,
// UI latency, or whole-browser speed. Times are intentionally not a test gate.
const results = [];
for (const count of [32, 128, 512, 1000]) {
  const candidates = Array.from({ length: count }, (_, i) => ({
    id: i,
    archetype: i % 3 ? "tab" : "chromiumHistory",
    features: {
      urlMatchScore: (i * 7) % 13,
      urlMatchPosition: i % 8,
      urlMatchPercentage: ((i * 11) % 100) / 100,
      titleMatchScore: (i * 17) % 13,
      titleMatchPosition: i % 5,
      titleMatchPercentage: ((i * 13) % 100) / 100,
      frequencyEver: (i * 23) % 113,
      typedCountEver: (i * 31) % 67,
      lastNavigated: i * 971,
      saveLevel: i % 4,
    },
    boosts: i % 5 ? [] : ["customTitlePrefix"],
  }));
  for (let i = 0; i < 50; i++) {
    rankCommandCandidates(candidates);
  }
  const samples = [];
  for (let i = 0; i < 200; i++) {
    const start = performance.now();
    rankCommandCandidates(candidates);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  results.push({
    candidates: count,
    medianMs: samples[100],
    p95Ms: samples[190],
  });
}
console.log(JSON.stringify({
  scope: "scoring only; Node runtime; synthetic inputs",
  runtime: process.version,
  results,
}, null, 2));
