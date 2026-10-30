import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Exercise the actual patched methods, with deterministic frame delivery and
// synchronous blur reentry. The integration test also runs these in Gecko.
const patch = readFileSync(new URL(
  "../../src/browser/components/urlbar/content/UrlbarInputBase-mjs.patch", import.meta.url,
), "utf8");
const target = patch.split("\n").filter(line => /^[ +]/.test(line) && !line.startsWith("+++"))
  .map(line => line.slice(1)).join("\n");
const start = target.indexOf("  #zenPopoverEpoch = 0;");
const end = target.indexOf("\n  /**", start);
assert.ok(start >= 0 && end > start);
const methods = target.slice(start, end);

function fixture({ reenter = false, nativeHidden = false } = {}) {
  const stats = { opens: 0, closes: 0, focuses: 0, reverts: 0, queries: 0 };
  const frames = [], attrs = new Set(["popover", "breakout-extend", "zen-floating-urlbar"]);
  const root = { setAttribute() {}, removeAttribute() {} };
  const context = vm.createContext({});
  vm.runInContext(`globalThis.Bar = class {
    #canOpenPopover = true;
    #isAddressbar = true;
    #fixAddressbarSearchbarOrder() {}
    #updateTextboxPosition() {}
    open() { this.#openPopover(); }
    close() { this.#closePopover(); }
    ${methods}
  }`, context);
  const bar = new context.Bar();
  Object.assign(bar, {
    isConnected: true, focused: true, nativeOpen: !nativeHidden,
    value: "discard me", selection: [0, 10], _untrimmedValue: "https://fixture.invalid/",
    zenUrlbarBehavior: "float", view: { isOpen: false, visibleRowCount: 0 },
    document: { getElementById: () => ({ hasAttribute: () => false }) },
    matches: () => bar.nativeOpen,
    hasAttribute: key => attrs.has(key),
    setAttribute: key => attrs.add(key),
    removeAttribute: key => attrs.delete(key),
    toggleAttribute(key, value) { if (value) attrs.add(key); else attrs.delete(key); },
    showPopover() { bar.nativeOpen = true; },
    hidePopover() { bar.nativeOpen = false; },
    startQuery() { stats.queries++; },
    handleRevert() { stats.reverts++; bar.value = "fixture.invalid"; bar.selection = [15, 15]; },
  });
  const browser = { focus() {
    stats.focuses++; bar.focused = false;
    if (reenter) bar.close();
  } };
  bar.window = {
    document: { documentElement: root },
    gBrowser: { selectedBrowser: browser },
    gZenVerticalTabsManager: { _hasSetSingleToolbar: true },
    gZenUIManager: {
      onUrlbarOpen() { stats.opens++; },
      onUrlbarClose() { stats.closes++; },
      onFloatingURLBarOpen() {},
    },
    requestAnimationFrame: callback => frames.push(callback),
    setTimeout() {},
  };
  return { bar, stats, frames, attrs, flush() { while (frames.length) frames.shift()(); } };
}

test("ordinary close restores the page label once, including synchronous blur reentry", () => {
  const f = fixture({ reenter: true }); f.bar.close();
  assert.equal(f.frames.length, 1); assert.equal(f.stats.closes, 1); assert.equal(f.stats.focuses, 1);
  assert.equal(f.bar.nativeOpen, false); assert.ok(!f.attrs.has("breakout-extend"));
  f.flush(); assert.equal(f.stats.reverts, 1); assert.equal(f.bar.value, "fixture.invalid");
  f.bar.close(); f.flush(); assert.equal(f.stats.closes, 1); assert.equal(f.stats.queries, 0);
});

test("a hidden native popover is cleaned up without starting another query", () => {
  const f = fixture({ nativeHidden: true, reenter: true }); f.bar.close(); f.flush();
  assert.equal(f.stats.queries, 0); assert.equal(f.stats.closes, 1);
  assert.equal(f.bar.focused, false); assert.ok(!f.attrs.has("breakout-extend"));
});

test("delayed close cleanup cannot erase text or selection in a reopened editor", () => {
  const f = fixture(); f.bar.close();
  f.bar.view.isOpen = true; f.bar.focused = true; f.bar.open();
  f.bar.value = "fixture"; f.bar.selection = [3, 5]; f.flush();
  assert.equal(f.bar.value, "fixture"); assert.deepEqual(f.bar.selection, [3, 5]);
  assert.equal(f.stats.reverts, 0); assert.equal(f.stats.opens, 1);
});

test("a newly focused edit is safe even before its query opens a view", () => {
  const f = fixture(); f.bar.close(); f.bar.focused = true; f.bar.value = "f"; f.flush();
  assert.equal(f.bar.value, "f"); assert.equal(f.stats.reverts, 0);
});

test("only the newest close may restore the page after an intervening reopen", () => {
  const f = fixture(); f.bar.close(); f.bar.open(); f.bar.focused = true; f.bar.close();
  assert.equal(f.frames.length, 2); f.flush(); assert.equal(f.stats.reverts, 1);
});

test("a close callback does not change another tab or a detached input", () => {
  for (const change of [f => { f.bar.window.gBrowser.selectedBrowser = {}; },
    f => { f.bar.isConnected = false; }]) {
    const f = fixture(); f.bar.close(); change(f); f.flush(); assert.equal(f.stats.reverts, 0);
  }
});

test("visible results stay open and the existing new-tab close owner is respected", () => {
  const f = fixture(); f.bar.view = { isOpen: true, visibleRowCount: 2 }; f.bar.close();
  assert.equal(f.stats.closes, 0); assert.equal(f.bar.nativeOpen, true);
  f.bar.view.isOpen = false; let owned = 0; f.bar._zenHandleUrlbarClose = () => owned++;
  f.bar.close(); f.flush(); assert.equal(owned, 1); assert.equal(f.stats.reverts, 0);
});
