import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/zen/sessionstore/ZenSessionManager.sys.mjs", import.meta.url), "utf8");
const start = source.indexOf("  onFileRead(initialState) {");
const end = source.indexOf("\n  /**", start);
assert.ok(start > 0 && end > start);

function reader(sync) {
  return vm.runInNewContext(`new class {
    _shouldRunMigration = false;
    #runStateMigration(state) { return state; }
    get #shouldRestoreOnlyPinned() { return false; }
    log() {}
    ${source.slice(start, end)}
  }`, {
    lazy: { gWindowSyncEnabled: sync },
    Services: { prefs: { getBoolPref: () => true } },
  });
}

test("fresh synchronized sessions satisfy Firefox's saved-group contract", () => {
  const state = reader(true).onFileRead(null);
  assert.equal(state.windows.length, 1);
  assert.equal(state.windows[0].tabs.length, 0);
  assert.equal(state.savedGroups.length, 0);
});

for (const sync of [false, true]) {
  test(`older session state retains its tabs and gains an empty group list (sync=${sync})`, () => {
    const tabs = [{ entries: [{ url: "https://example.com/" }] }];
    const state = { windows: [{ tabs }] };
    const restored = reader(sync).onFileRead(state);
    assert.equal(restored, state);
    assert.equal(restored.windows[0].tabs, tabs);
    assert.equal(restored.savedGroups.length, 0);
  });
}

test("a missing unsynchronized session still returns no session", () => {
  assert.equal(reader(false).onFileRead(null), null);
});
