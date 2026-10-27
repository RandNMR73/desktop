import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/zen/split-view/ZenViewSplitter.mjs", import.meta.url), "utf8");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const nodes = section("class nsSplitLeafNode", "class nsZenViewSplitter");
const methods = [
  section("  removeTabFromGroup(", "  #getDragImageForSplit("),
  section("  removeNode(toRemove)", "  toggleWrapperDisplay(value)"),
  section("  calculateLayoutTree(tabs, gridType)", "  applyGridToTabs(tabs)"),
  section("  getSplitNodeFromTab(tab", "  styleContainer(container)"),
].join("\n");

function fixture({ count = 3, layout = "vsep", active = false, cached = false } = {}) {
  const tabs = Array.from({ length: count }, (_, id) => ({ id, group: null }));
  const outside = {};
  const browser = { selectedTab: outside };
  const handler = vm.runInNewContext(`${nodes}\nnew (class {
    #dispatchItemEvent() {}
    ${methods}
  })()`, { gBrowser: browser });
  const group = { tabs: [...tabs], layoutTree: handler.calculateLayoutTree(tabs, layout) };
  handler._data = [group];
  handler.currentView = active ? 0 : -1;
  handler._tabToSplitNode = new WeakMap();
  handler._splitNodeToSplitters = new Map();
  handler.getSplitters = () => [];
  handler.resetTabState = () => {};
  handler.applied = [];
  handler.applyGridLayout = node => handler.applied.push(node);
  const collect = node => node.children ? node.children.flatMap(collect) : [node];
  if (cached) for (const node of collect(group.layoutTree)) handler._tabToSplitNode.set(node.tab, node);
  return { handler, browser, group, tabs, outside, leaves: () => collect(group.layoutTree) };
}

test("closing a never-rendered background split updates its tree without painting or selecting it", () => {
  const f = fixture();
  f.handler.removeTabFromGroup(f.tabs[2], undefined, { forUnsplit: true, changeTab: false });
  assert.deepEqual(f.group.tabs, f.tabs.slice(0, 2));
  assert.deepEqual(Array.from(f.leaves(), node => node.tab), f.tabs.slice(0, 2));
  assert.ok(f.leaves().every(node => Math.abs(node.sizeInParent - 50) < 1e-10));
  assert.equal(f.browser.selectedTab, f.outside);
  assert.equal(f.handler.applied.length, 0);
});

test("a background nested split collapses the removed leaf's parent and preserves the other branch", () => {
  const f = fixture({ count: 4, layout: "grid" });
  f.handler.removeTabFromGroup(f.tabs[1], undefined, { changeTab: false });
  assert.deepEqual(Array.from(f.leaves(), node => node.tab), [f.tabs[0], f.tabs[2], f.tabs[3]]);
  assert.equal(f.group.layoutTree.children[0].tab, f.tabs[0]);
  assert.equal(f.group.layoutTree.children[0].sizeInParent, 50);
  assert.equal(f.group.layoutTree.children[1].direction, "column");
  assert.equal(f.handler.applied.length, 0);
  assert.equal(f.browser.selectedTab, f.outside);
});

test("an active split still repaints and selects its adjacent pane", () => {
  const f = fixture({ active: true, cached: true });
  f.browser.selectedTab = f.tabs[2];
  f.handler.removeTabFromGroup(f.tabs[2]);
  assert.equal(f.browser.selectedTab, f.tabs[1]);
  assert.equal(f.handler.applied.length, 1);
  assert.equal(f.handler.applied[0], f.group.layoutTree);
  assert.equal(f.handler._tabToSplitNode.has(f.tabs[2]), false);
});

test("background changes leave a different visible split and its selection untouched", () => {
  const f = fixture({ cached: true });
  const visible = { tabs: [f.outside], layoutTree: { tab: f.outside } };
  f.handler._data.push(visible);
  f.handler.currentView = 1;
  f.handler.removeTabFromGroup(f.tabs[0], 0, { changeTab: false });
  assert.equal(f.handler._data[1], visible);
  assert.equal(f.handler.currentView, 1);
  assert.equal(f.browser.selectedTab, f.outside);
  assert.equal(f.handler.applied.length, 0);
});

test("a stale cached node cannot mutate the previously rendered layout", () => {
  const f = fixture({ active: true, cached: true });
  const previous = f.group.layoutTree;
  f.group.layoutTree = f.handler.calculateLayoutTree(f.tabs, "hsep");
  f.handler.removeTabFromGroup(f.tabs[1]);
  assert.equal(previous.children.length, 3);
  assert.deepEqual(Array.from(f.leaves(), node => node.tab), [f.tabs[0], f.tabs[2]]);
  assert.equal(f.group.layoutTree.direction, "column");
  assert.equal(f.handler.applied[0], f.group.layoutTree);
});
