import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/zen/split-view/ZenViewSplitter.mjs", import.meta.url), "utf8");
const method = source.slice(source.indexOf("  closeSelectedPane() {"), source.indexOf("  unsplitCurrentView() {"));
function fixture({ pinned = false, cancel = false, split = true, count = 2, selected = 0 } = {}) {
  const tabs = Array.from({ length: count }, () => ({ pinned, isConnected: true, closing: false, hasAttribute: () => false }));
  const first = tabs[selected];
  const survivor = tabs[selected - 1] ?? tabs[selected + 1];
  const outside = {};
  let closes = 0, removals = 0;
  const browser = {
    selectedTab: first,
    removeTab(tab, options) {
      closes++;
      assert.equal(options.skipPermitUnload, undefined);
      if (!cancel) {
        tab.closing = true;
        tab.isConnected = false;
        this.selectedTab = outside;
      }
    },
  };
  const handler = vm.runInNewContext(`({${method}})`, { gBrowser: browser });
  handler.currentView = split ? 0 : -1;
  handler._data = [{ tabs }];
  handler.removeTabFromGroup = () => { removals++; browser.selectedTab = survivor; };
  return { handler, browser, tabs, first, survivor, get closes() { return closes; }, get removals() { return removals; } };
}

test("a cancelled beforeunload keeps the active pane and its split", () => {
  const f = fixture({ cancel: true });
  f.handler.closeSelectedPane();
  assert.equal(f.closes, 1);
  assert.equal(f.removals, 0);
  assert.equal(f.first.isConnected, true);
  assert.equal(f.browser.selectedTab, f.first);
});

test("a committed close selects the survivor instead of a duplicated tab's owner", () => {
  const f = fixture();
  f.handler.closeSelectedPane();
  assert.equal(f.first.isConnected, false);
  assert.equal(f.browser.selectedTab, f.survivor);
});

test("closing a pinned pane retains its tab; outside a split no tab is closed", () => {
  const pinned = fixture({ pinned: true });
  pinned.handler.closeSelectedPane();
  assert.equal(pinned.closes, 0);
  assert.equal(pinned.removals, 1);
  assert.equal(pinned.first.isConnected, true);
  const outside = fixture({ split: false });
  outside.handler.closeSelectedPane();
  assert.equal(outside.closes, 0);
  assert.equal(outside.removals, 0);
});

test("closing the last pane returns to its preceding neighbor, not the first pane", () => {
  const f = fixture({ count: 3, selected: 2 });
  f.handler.closeSelectedPane();
  assert.equal(f.browser.selectedTab, f.tabs[1]);
  assert.equal(f.tabs[0].isConnected, true);
});

test("closing the middle or first pane picks the adjacent surviving pane", () => {
  const middle = fixture({ count: 3, selected: 1 });
  middle.handler.closeSelectedPane();
  assert.equal(middle.browser.selectedTab, middle.tabs[0]);
  const first = fixture({ count: 3, selected: 0 });
  first.handler.closeSelectedPane();
  assert.equal(first.browser.selectedTab, first.tabs[1]);
});
