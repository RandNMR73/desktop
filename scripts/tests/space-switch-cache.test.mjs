import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/zen/spaces/ZenSpaceManager.mjs", import.meta.url), "utf8");
const methods = source.slice(source.indexOf("  async #performWorkspaceChange("), source.indexOf("  #pendingPaddingUpdates ="));

// Exercise production switching/reindexing against a cached tab list. Membership
// reads and visibility reads have separate caches, as in MozTabbrowserTabs.
function fixture({ empty = true, membershipChange = false, withPeek = false } = {}) {
  const tab = (name, space, extras = {}) => {
    const attrs = new Map([["zen-workspace-id", space]]);
    if (name === "empty") attrs.set("zen-empty-tab", "true");
    return { name, isConnected: true, hidden: false, linkedBrowser: {}, ...extras,
      hasAttribute: key => attrs.has(key), getAttribute: key => attrs.get(key),
      setAttribute: (key, value) => attrs.set(key, value) };
  };
  const group = { id: "folder", group: null };
  const favorite = tab("favorite", "shared");
  const spaces = [0, 1].map(i => ({ uuid: `space-${i}`, style: { transform: "translateX(0%)" },
    pinned: { children: i ? [tab("pin-a", "space-1", { group }), tab("pin-b", "space-1", { group })] : [] },
    normal: { children: [tab(`normal-${i}`, `space-${i}`)], get firstChild() { return this.children[0]; },
      insertBefore(node, before) {
        for (const s of spaces) s.normal.children = s.normal.children.filter(t => t !== node);
        this.children.splice(Math.max(0, this.children.indexOf(before)), 0, node);
      } } }));
  const peek = withPeek ? tab("peek", "space-1") : null;
  if (peek) spaces[1].normal.children[0].peek = peek;
  const emptyTab = empty ? tab("empty", "space-0") : null;
  if (emptyTab) spaces[0].normal.children.unshift(emptyTab);
  let manager, cached, visible, builds = 0, organizeCalls = 0;
  const reads = [], observed = [];
  const strip = { pinnedTabsContainer: spaces[0].pinned,
    _invalidateCachedTabs() { cached = null; this._invalidateCachedVisibleTabs(); },
    _invalidateCachedVisibleTabs() { visible = null; } };
  const browser = { tabContainer: strip, pinnedTabsContainer: spaces[0].pinned,
    selectedTab: spaces[0].normal.children.at(-1), TabStateFlusher: { flush() {} }, warmupTab() {},
    get tabs() {
      if (!cached) {
        builds++;
        cached = [favorite, ...strip.pinnedTabsContainer.children, ...manager.activeWorkspaceStrip.children]
          .flatMap(t => t.peek ? [t, t.peek] : [t]);
        reads.push(cached.map(t => t.name));
      }
      return cached;
    },
    get visibleTabs() { return visible ||= this.tabs.filter(t => !t.hidden); } };
  const Manager = vm.runInNewContext(`(class {
    #spaceVisual = null;
    ${methods}
    perform(space, options) { return this.#performWorkspaceChange(space, options); }
    async #updateWorkspaceState() {
      this.makeSureEmptyTabIsFirst();
      this.record(); // overflow/selection reads the list populated by reindexing
    }
  })`, { gBrowser: browser, gZenUIManager: { testingEnabled: false },
    gZenFolders: { cancelPopupTimer() {} }, spaceTransitionOffset: () => 0 });
  manager = new Manager();
  Object.assign(manager, { activeWorkspace: spaces[0].uuid, _emptyTab: emptyTab, tabContainer: strip,
    getWorkspaces: () => spaces, getActiveWorkspace: () => spaces.find(s => s.uuid === manager.activeWorkspace),
    workspaceElement: id => spaces.find(s => s.uuid === id), _shouldShowTab: () => true,
    _organizeWorkspaceStripLocations() {
      organizeCalls++;
      void browser.visibleTabs; // populate before a visibility change
      favorite.hidden = true;
      if (membershipChange) {
        this.activeWorkspaceStrip.children.push(tab("opened-during-placement", this.activeWorkspace));
        strip._invalidateCachedTabs(); // normal structural events retain their invalidation
      }
    },
    async _handleTabSelection() {
      observed.push({ tabs: browser.tabs.map(t => t.name), visible: browser.visibleTabs.map(t => t.name) });
      return browser.selectedTab;
    },
    record() { observed.push({ tabs: browser.tabs.map(t => t.name), visible: browser.visibleTabs.map(t => t.name) }); } });
  Object.defineProperties(manager, {
    activeWorkspaceStrip: { get: () => manager.getActiveWorkspace().normal },
    pinnedTabsContainer: { get: () => manager.getActiveWorkspace().pinned },
  });
  void browser.tabs; // stale source-Space membership exists at switch entry
  builds = 0; reads.length = 0;
  return { manager, browser, spaces, favorite, peek, observed, reads,
    get builds() { return builds; }, get organizeCalls() { return organizeCalls; } };
}

test("Space switch reuses reindexed destination membership while refreshing visibility", async () => {
  const f = fixture({ withPeek: true });
  await f.manager.perform(f.spaces[1]);
  assert.equal(f.builds, 1, "overflow/selection must not repeat the structural traversal");
  assert.deepEqual(f.observed.map(s => s.tabs), [f.reads[0], f.reads[0]]);
  assert.deepEqual(f.observed[0].tabs, ["favorite", "pin-a", "pin-b", "empty", "normal-1", "peek"]);
  assert.equal(f.observed[0].visible.includes("favorite"), false, "visibility cache was refreshed after placement");
  assert.deepEqual(f.browser.tabs.map(t => t._index), [0, 1, 2, 3, 4, 5]);
  assert.equal(f.browser.tabs[1].group._pPos, 1);
});

for (const options of [{ onInit: true }, { alwaysChange: true }, { whileScrolling: true }]) {
  test(`switch cache remains fresh for ${Object.keys(options)[0]}`, async () => {
    const f = fixture();
    await f.manager.perform(f.spaces[1], options);
    assert.equal(f.builds, 1);
    assert.equal(f.observed[0].tabs.includes("normal-0"), false);
    assert.equal(f.observed[0].tabs.includes("normal-1"), true);
    assert.equal(f.organizeCalls, options.whileScrolling ? 0 : 1);
  });
}

test("forced same-Space refresh still invalidates when the empty tab is already first", async () => {
  const f = fixture();
  f.spaces[0].normal.children.push({ name: "new-membership", hidden: false });
  await f.manager.perform(f.spaces[0], { alwaysChange: true });
  assert.equal(f.builds, 1);
  assert.equal(f.observed[0].tabs.includes("new-membership"), true);
});

test("missing empty tab and ordinary same-Space no-op preserve their paths", async () => {
  const f = fixture({ empty: false });
  await f.manager.perform(f.spaces[1]);
  assert.equal(f.builds, 2, "existing missing-empty-tab reindex runs again in updateTabsContainers");
  const before = f.builds;
  await f.manager.perform(f.spaces[1]);
  assert.equal(f.builds, before);
});

test("membership events during placement keep their full invalidation", async () => {
  const f = fixture({ membershipChange: true });
  await f.manager.perform(f.spaces[1]);
  assert.equal(f.builds, 2);
  assert.equal(f.observed[0].tabs.at(-1), "opened-during-placement");
});
