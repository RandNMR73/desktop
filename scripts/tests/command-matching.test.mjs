import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../src/zen/urlbar/ZenCommandMatching.sys.mjs", import.meta.url), "utf8")
  .replaceAll("export function", "function");

function fixture({ version = 1, os = "Darwin", response = "[]", unavailable = false, nullResult = false } = {}) {
  let released = 0, opened = 0;
  const requests = [];
  const ctypes = { default_abi: 0, int32_t: 0, char: { ptr: 0 }, uint32_t: 0, void_t: 0,
    uint8_t: { ptr: 0, array: () => bytes => bytes },
    open() {
      opened++;
      if (unavailable) throw new Error("missing library");
      return { declare(name) {
        if (name === "zen_command_matching_version") return () => version;
        if (name === "zen_command_matching_free") return () => released++;
        return bytes => {
          requests.push(JSON.parse(new TextDecoder().decode(bytes)));
          return { isNull: () => nullResult, readString: () => response };
        };
      } };
    } };
  const context = vm.createContext({ Services: { appinfo: { OS: os }, dirsvc: { get: () => ({ parent: { path: "/fixture" } }) } },
    ChromeUtils: { importESModule: () => ({ ctypes }) }, Ci: { nsIFile: 0 },
    PathUtils: { join: (...items) => items.join("/") }, TextEncoder, TextDecoder });
  vm.runInContext(source + "\nglobalThis.match = matchCommandCandidates; globalThis.signals = matchCommandCandidateSignals; globalThis.rules = commandQueryRules;", context);
  return { match: context.match, signals: context.signals, rules: context.rules, requests, released: () => released, opened: () => opened };
}

test("native matching sends searchable text and keeps provider identity outside the ABI", () => {
  const f = fixture({ response: '[{"titleMatchScore":28},{}]' });
  const identity = Object.freeze({ privateId: 7 });
  const rows = Object.freeze([Object.freeze({ title: "YouTube", result: identity }), Object.freeze({})]);
  const result = f.match("you", rows);
  assert.equal(result[0].titleMatchScore, 28);
  assert.deepEqual(f.requests, [{ query: "you", candidates: [{ title: "YouTube" }, {}] }]);
  assert.equal(rows[0].result, identity);
  assert.equal(f.released(), 1);
});

test("signal requests carry only ranking inputs, never provider identity or activation", () => {
  const f = fixture({ version: 2, response: '[{"features":{},"boosts":["topApp"],"completion":"fixture.test"}]' });
  const candidate = Object.freeze({ archetype: "tab", url: "https://fixture.test/", title: "Fixture",
    customTitle: "Saved fixture", savedContext: "global", features: { lastNavigated: 60, fuzzySearchConfidence: 0.9, frequencyEver: 10 },
    hotWords: ["fixture"], result: { privateId: 9 }, browser: {}, activate() {} });
  const result = f.signals("fix", [candidate]);
  assert.equal(result[0].completion, "fixture.test");
  assert.deepEqual(f.requests, [{ query: "fix", candidates: [{ archetype: "tab", url: "https://fixture.test/", title: "Fixture",
    customTitle: "Saved fixture", hotWords: ["fixture"], savedContext: "global", lastNavigated: 60, fuzzySearchConfidence: 0.9 }] }]);
  assert.equal(f.released(), 1);
});

test("ABI 1 remains usable for text, but cannot return general signals", () => {
  const f = fixture({ response: '[{}]' });
  assert.equal(f.signals("x", [{ archetype: "tab" }]), null);
  assert.equal(f.requests.length, 0);
  assert.equal(f.match("x", [{}]).length, 1);
  assert.equal(f.opened(), 1);
});

test("ABI 3 query rules forward only query interpretation and privacy context", () => {
  const f = fixture({ version: 3, response: '{"preferredMaxRanks":{"searchWhatYouTyped":1},"characterCount":3,"specialSearchSyntax":false}' });
  const rules = f.rules("you", { isPrivate: true, urlInterpretation: "url", browser: {}, profile: "private-id" });
  assert.equal(rules.preferredMaxRanks.searchWhatYouTyped, 1);
  assert.deepEqual(f.requests, [{ query: "you", isPrivate: true, urlInterpretation: "url" }]);
  assert.equal(f.released(), 1);
});

test("older helper versions cannot supply query rules but keep their supported APIs", () => {
  for (const version of [1, 2]) {
    const f = fixture({ version, response: '[{}]' });
    assert.equal(f.rules("you"), null);
    assert.equal(f.requests.length, 0);
    assert.equal(f.match("you", [{}]).length, 1);
    assert.equal(f.opened(), 1);
  }
});

test("query-rule failures release allocations and cannot provide malformed limits", () => {
  for (const response of ["null", "[]", "not JSON", "{}",
    '{"preferredMaxRanks":[],"characterCount":1,"specialSearchSyntax":false}',
    '{"preferredMaxRanks":{"tab":-1},"characterCount":1,"specialSearchSyntax":false}',
    '{"preferredMaxRanks":{"tab":1.5},"characterCount":1,"specialSearchSyntax":false}',
    '{"preferredMaxRanks":{},"characterCount":1}',
    '{"preferredMaxRanks":{},"characterCount":-1,"specialSearchSyntax":false}']) {
    const f = fixture({ version: 3, response });
    assert.equal(f.rules("x"), null);
    assert.equal(f.released(), 1);
  }
});

test("the special-search signal receives the measured Chromium rank", () => {
  const f = fixture({ version: 3, response: '[{"features":{},"boosts":["chromiumSpecialSearchFunction"]}]' });
  f.signals("site:cats", [{archetype: "chromiumSearchWhatYouTyped", features: {chromiumRank: 1, frequencyEver: 99}}]);
  assert.deepEqual(f.requests[0].candidates, [{archetype: "chromiumSearchWhatYouTyped", chromiumRank: 1}]);
});

test("signal parsing failures free native output and mismatched batches are rejected", () => {
  for (const response of ["invalid JSON", "[]", "{}", "null"]) {
    const f = fixture({ version: 2, response });
    assert.equal(f.signals("x", [{ archetype: "tab" }]), null);
    assert.equal(f.released(), 1);
  }
});

test("native allocations are released when decoding fails", () => {
  const f = fixture({ response: "invalid JSON" });
  assert.equal(f.match("you", [{}]), null);
  assert.equal(f.released(), 1);
});

test("unavailable and older native matchers are discovered only once", () => {
  for (const options of [{ unavailable: true }, { version: 0 }, { os: "Linux" }]) {
    const f = fixture(options);
    assert.equal(f.match("you", [{}]), null);
    assert.equal(f.match("you", [{}]), null);
    assert.equal(f.opened(), options.os ? 0 : 1);
    assert.equal(f.released(), 0);
  }
});

test("rejected requests and unexpected result counts cannot supply rankings", () => {
  const absent = fixture({ nullResult: true });
  assert.equal(absent.match("you", [{}]), null);
  assert.equal(absent.released(), 0);
  const mismatch = fixture();
  assert.equal(mismatch.match("you", [{}]), null);
  assert.equal(mismatch.released(), 1);
  assert.equal(mismatch.match("a".repeat(4_194_305), []), null);
  assert.equal(mismatch.requests.length, 1);
});
