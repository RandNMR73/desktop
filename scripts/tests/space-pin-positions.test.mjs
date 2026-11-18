import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/zen/spaces/ZenSpaceManager.mjs", import.meta.url), "utf8");
const methods = source.slice(source.indexOf("  async #performWorkspaceChange("),
  source.indexOf("  #pendingPaddingUpdates ="));

function tab(name, space, { empty = false, group = null } = {}) {
  const attrs = new Map([["zen-workspace-id", space]]);
  if (empty) attrs.set("zen-empty-tab", "true");
  return { name, group, isConnected: true, linkedBrowser: {},
    hasAttribute: key => attrs.has(key), getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value) };
}

function fixture(pinCounts, { essential = false, grouped = false } = {}) {
  const spaces = pinCounts.map((pins, index) => {
    const uuid = `space-${index}`;
    const group = grouped ? { id: `folder-${index}`, group: null } : null;
    const pinned = { children: Array.from({ length: pins }, (_, n) => tab(`pin-${index}-${n}`, uuid, { group })) };
    const normal = { children: [tab(`normal-${index}-0`, uuid), tab(`normal-${index}-1`, uuid)],
      get firstChild() { return this.children[0]; }, insertBefore(node, before) {
        for (const space of spaces) space.normal.children = space.normal.children.filter(t => t !== node);
        this.children.splice(this.children.indexOf(before), 0, node);
      } };
    return { uuid, pinned, normal, active: index === 0, style: { transform: "translateX(0%)" } };
  });
  let manager, reads = 0, flushes = 0;
  const empty = tab("empty", spaces[0].uuid, { empty: true });
  spaces[0].normal.children.unshift(empty);
  const essentials = essential ? [tab("favorite", "shared")] : [];
  for (const space of spaces) {
    space.pinned.children.forEach((t, i) => {
      t._index = essentials.length + i;
      t._pPos = essentials.length + i + (t.group ? 1 : 0);
      if (t.group) t.group._pPos = essentials.length;
    });
  }
  const strip = { pinnedTabsContainer: spaces[0].pinned, _invalidateCachedTabs() {},
    _invalidateCachedVisibleTabs() {} };
  const browser = { tabContainer: strip, pinnedTabsContainer: spaces[0].pinned,
    selectedTab: spaces[0].normal.children[1], TabStateFlusher: { flush() { flushes++; } }, warmupTab() {},
    get tabs() { reads++; return [...essentials, ...strip.pinnedTabsContainer.children, ...manager.activeWorkspaceStrip.children]; } };
  const Manager = vm.runInNewContext(`(class {
    #spaceVisual = null;
    ${methods}
    perform(space, options) { return this.#performWorkspaceChange(space, options); }
    async #updateWorkspaceState() { this.makeSureEmptyTabIsFirst(); }
  })`, { gBrowser: browser, gZenUIManager: { testingEnabled: false },
    gZenFolders: { cancelPopupTimer() {} }, spaceTransitionOffset: () => 0 });
  manager = new Manager();
  Object.assign(manager, { activeWorkspace: spaces[0].uuid, _emptyTab: empty, tabContainer: strip,
    getWorkspaces: () => spaces, getActiveWorkspace: () => spaces.find(s => s.uuid === manager.activeWorkspace),
    workspaceElement: id => spaces.find(s => s.uuid === id), _organizeWorkspaceStripLocations() {},
    async _handleTabSelection() { return browser.selectedTab; }, _shouldShowTab: () => true });
  Object.defineProperties(manager, {
    activeWorkspaceStrip: { get: () => manager.getActiveWorkspace().normal },
    pinnedTabsContainer: { get: () => manager.getActiveWorkspace().pinned },
  });
  return { manager, browser, spaces, essentials, empty, get reads() { return reads; }, get flushes() { return flushes; } };
}

for (const counts of [[0, 1, 2, 0], [3, 0, 1], [1, 1]]) {
  test(`Space switches preserve indices with pinned counts ${counts}`, async () => {
    const f = fixture(counts);
    for (const index of [...counts.keys()].slice(1).concat(0)) {
      const before = f.reads;
      await f.manager.perform(f.spaces[index]);
      assert.equal(f.reads - before, 1, "one existing position scan; second empty-tab call remains a no-op");
      const actual = [...f.browser.tabs];
      assert.deepEqual(actual.map(t => t._index), actual.map((_, i) => i));
      assert.deepEqual(actual.filter(t => t !== f.empty).map(t => t._pPos), actual.filter(t => t !== f.empty).map((_, i) => i));
      assert.equal(f.browser.pinnedTabsContainer, f.spaces[index].pinned);
      assert.equal(f.browser.tabContainer.pinnedTabsContainer, f.spaces[index].pinned);
      assert.equal(f.spaces[index].normal.firstChild, f.empty);
      assert.equal(f.empty.getAttribute("zen-workspace-id"), f.spaces[index].uuid);
    }
  });
}

test("shared Favorites and folder positions precede the destination's normal tabs", async () => {
  const f = fixture([1, 2], { essential: true, grouped: true });
  await f.manager.perform(f.spaces[1]);
  const tabs = [...f.browser.tabs];
  assert.deepEqual(tabs.map(t => t._index), [0, 1, 2, 3, 4, 5]);
  assert.equal(f.spaces[1].pinned.children[0].group._pPos, 1);
  assert.deepEqual(tabs.filter(t => t !== f.empty).map(t => t._pPos), [0, 2, 3, 4, 5]);
});

test("settled same-Space selections keep the no-op and explicit-selection paths", async () => {
  const f = fixture([1, 2]);
  await f.manager.perform(f.spaces[1]);
  const reads = f.reads, flushes = f.flushes, requested = f.spaces[1].normal.children[1];
  await f.manager.perform(f.spaces[1]);
  await f.manager.perform(f.spaces[1], { selectTab: requested });
  assert.equal(f.reads, reads);
  assert.equal(f.flushes, flushes);
  assert.equal(f.browser.selectedTab, requested);
});
