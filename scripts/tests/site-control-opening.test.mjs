import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../../src/zen/urlbar/ZenSiteDataPanel.sys.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\n/m, "").replace("export class", "class");

function fixture() {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const calls = [], host = {};
  const context = vm.createContext({ Services: { prefs: { getBoolPref: () => true } },
    ChromeUtils: { defineESModuleGetters() {}, importESModule: () => ({
      prepareNativePopupAppearance: () => ready,
    }) },
  });
  vm.runInContext(source + "\nglobalThis.Panel = nsZenSiteDataPanel;", context);
  const panel = Object.create(context.Panel.prototype);
  panel.unifiedPanel = { isConnected: true };
  panel.unifiedPanelView = "site-controls";
  panel.window = { gBrowser: { selectedBrowser: {} }, innerWidth: 1000, innerHeight: 800,
    getComputedStyle: element => { assert.equal(element, host); return { visibility: "visible" }; },
    gUnifiedExtensions: { togglePanel: (...args) => { calls.push(args); return "opened"; } },
  };
  panel.anchor = { closest: () => host,
    getBoundingClientRect: () => ({ width: 24, height: 26, left: 194, top: 51, right: 218, bottom: 77 }),
  };
  return { panel, calls, release, fallback: {} };
}

test("site controls wait for native appearance preparation before showing", async () => {
  const f = fixture(), event = {};
  const pending = f.panel.toggle(event);
  assert.equal(f.calls.length, 0);
  f.release();
  assert.equal(await pending, "opened");
  assert.deepEqual(f.calls[0], [event, null, f.panel.unifiedPanel, "site-controls", f.panel.anchor]);
});

test("a delayed open cannot revive a closed window, detached panel or previous selected tab", async () => {
  for (const invalidate of [
    f => { f.panel.window.closed = true; },
    f => { f.panel.unifiedPanel.isConnected = false; },
    f => { f.panel.window.gBrowser.selectedBrowser = {}; },
  ]) {
    const f = fixture(), pending = f.panel.toggle(null);
    invalidate(f); f.release(); await pending;
    assert.equal(f.calls.length, 0);
  }
});

test("developer entry uses the visible sidebar host and retains hidden/offscreen fallback", async () => {
  for (const visibility of ["visible", "hidden", "offscreen", "empty"]) {
    const f = fixture();
    if (visibility === "hidden") f.panel.window.getComputedStyle = () => ({ visibility: "hidden" });
    if (visibility === "offscreen") f.panel.anchor.getBoundingClientRect = () => ({ width: 24, height: 26, left: -24, top: 51, right: 0, bottom: 77 });
    if (visibility === "empty") f.panel.anchor.getBoundingClientRect = () => ({ width: 0, height: 0 });
    f.release(); await f.panel.toggle(null, f.fallback);
    assert.equal(f.calls[0][4], visibility === "visible" ? f.panel.anchor : f.fallback);
  }
});
