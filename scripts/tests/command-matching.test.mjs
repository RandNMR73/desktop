import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../src/zen/urlbar/ZenCommandMatching.sys.mjs", import.meta.url), "utf8")
  .replace("export function", "function");

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
  vm.runInContext(source + "\nglobalThis.match = matchCommandCandidates;", context);
  return { match: context.match, requests, released: () => released, opened: () => opened };
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
