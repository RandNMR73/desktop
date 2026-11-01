import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/zen/tabs/ZenTabAutoArchive.mjs", import.meta.url), "utf8")
  .replace(/^import .*;$/m, "");

function fixture(attributes = [], ageMinutes = 120) {
  const now = Date.now();
  const tab = { selected: true, lastSeenActive: now - ageMinutes * 60000,
    hasAttribute: name => attributes.includes(name) };
  const placeholder = { hasAttribute: name => name === "zen-empty-tab" };
  const browser = { tabs: [placeholder, tab], removeTabs() { throw new Error("Must preserve pages until window closing"); } };
  const win = { closed: false, close() { this.closed = true; this.pagesAtClose = [...browser.tabs]; } };
  const context = vm.createContext({ window: win, gBrowser: browser,
    nsZenDOMOperatedFeature: class {},
    XPCOMUtils: { defineLazyPreferenceGetter(target, name) {
      target[name] = name === "enabled" ? true : 60;
    } },
    ChromeUtils: { defineESModuleGetters(target) {
      target.ZenLittleWindow = { isLittleWindow: () => true };
    } },
  });
  vm.runInContext(source, context);
  return { tab, placeholder, browser, win, archive: () => win.gZenTabAutoArchive.archiveIdleTabs(now) };
}

test("automatic Little closure ignores the placeholder and retains page state until window closing", () => {
  const f = fixture();
  const archived = f.archive();
  assert.equal(archived.length, 1);
  assert.equal(archived[0], f.tab);
  assert.equal(f.tab._zenAutoArchived, true);
  assert.equal(f.placeholder._zenAutoArchived, undefined);
  assert.equal(f.win.closed, true);
  assert.equal(f.win.pagesAtClose.includes(f.tab), true);
});

test("Little automatic closure still protects active, playing, sharing, and pinned pages", () => {
  for (const attrs of [["soundplaying"], ["sharing"], ["pictureinpicture"], ["zen-essential"]]) {
    const f = fixture(attrs);
    assert.equal(f.archive().length, 0);
    assert.equal(f.win.closed, false);
  }
  const recent = fixture([], 10);
  assert.equal(recent.archive().length, 0);
  const pinned = fixture(); pinned.tab.pinned = true;
  assert.equal(pinned.archive().length, 0);
  const blank = fixture(); blank.browser.tabs = [blank.placeholder];
  assert.equal(blank.archive().length, 0);
  assert.equal(blank.win.closed, false);
  const muted = fixture(["soundplaying", "muted"]);
  assert.equal(muted.archive().length, 1);
});
