import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/zen/spaces/ZenSpaceManager.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "");
function tab(space, { favorite = false, container = "0", closing = false } = {}) {
  const attrs = { "zen-workspace-id": space, usercontextid: container };
  if (favorite) attrs["zen-essential"] = "true";
  return {
    closing, pinned: favorite, _selected: true,
    getAttribute: name => attrs[name] ?? null,
    hasAttribute: name => name in attrs,
  };
}
function fixture(selected = tab("old", { favorite: true })) {
  const window = {}, browser = { selectedTab: selected, visibleTabs: [] };
  const context = vm.createContext({
    window, gBrowser: browser,
    Services: { prefs: { getBoolPref: () => false } },
    ChromeUtils: { defineESModuleGetters() {}, defineLazyGetter() {} },
    gZenGlanceManager: { getTabOrGlanceParent: t => t.parentTab ?? t },
    gZenUIManager: { testingEnabled: false },
  });
  vm.runInContext(source, context);
  const manager = window.gZenWorkspaces;
  Object.defineProperty(manager, "activeWorkspace", { value: "old", writable: true });
  manager._emptyTab = tab("empty");
  manager.getWorkspaces = () => [{ uuid: "old", containerTabId: 1 }, { uuid: "new", containerTabId: 2 }];
  manager.containerSpecificEssentials = false;
  return { manager, browser, selected };
}

test("a shared favorite survives all Space switches without replacing remembered destination tabs", async () => {
  const { manager, selected } = fixture();
  for (let i = 0; i < 5; ++i) {
    const destination = { uuid: `space-${i}` }, remembered = tab(destination.uuid);
    manager.lastSelectedWorkspaceTabs[destination.uuid] = remembered;
    assert.equal(await manager._handleTabSelection(destination, false, "old"), selected);
    assert.equal(manager.lastSelectedWorkspaceTabs[destination.uuid], remembered);
    assert.equal(manager.lastSelectedWorkspaceTabs.old, selected);
    assert.equal(selected._selected, true);
  }
});
test("a shared favorite stays selected when the destination has no remembered tab", async () => {
  const { manager, selected } = fixture();
  assert.equal(await manager._handleTabSelection({ uuid: "new" }, false, "old"), selected);
});
test("an explicit tab request takes precedence over the current favorite", async () => {
  const { manager, selected } = fixture(), requested = tab("new");
  assert.equal(await manager._handleTabSelection({ uuid: "new" }, false, "old", requested), requested);
  assert.equal(selected._selected, false);
});
test("a tab selection across Spaces carries its explicit target", () => {
  const { manager } = fixture(), requested = tab("new"), calls = [];
  manager.changeWorkspaceWithID = (...args) => calls.push(args);
  assert.equal(manager.onBeforeTabSelect(requested), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "new");
  assert.equal(calls[0][1].selectTab, requested);
});
test("an explicit Glance request carries the parent tab", () => {
  const { manager } = fixture(), parent = tab("new"), glance = tab("new"), calls = [];
  glance.parentTab = parent;
  manager.changeWorkspaceWithID = (...args) => calls.push(args);
  manager.onBeforeTabSelect(glance);
  assert.equal(calls[0][1].selectTab, parent);
});
test("startup restores the remembered tab instead of imposing the current favorite", async () => {
  const { manager } = fixture(), remembered = tab("new");
  manager.lastSelectedWorkspaceTabs.new = remembered;
  assert.equal(await manager._handleTabSelection({ uuid: "new" }, true, "old"), remembered);
});
test("ordinary tabs still restore the destination selection", async () => {
  const { manager } = fixture(tab("old")), remembered = tab("new");
  manager.lastSelectedWorkspaceTabs.new = remembered;
  assert.equal(await manager._handleTabSelection({ uuid: "new" }, false, "old"), remembered);
});
test("a container-specific favorite stays only in a compatible destination", async () => {
  const { manager, selected } = fixture(tab("old", { favorite: true, container: "1" }));
  manager.containerSpecificEssentials = true;
  assert.equal(await manager._handleTabSelection({ uuid: "compatible", containerTabId: 1 }, false, "old"), selected);
  assert.equal(await manager._handleTabSelection({ uuid: "new", containerTabId: 2 }, false, "old"), manager._emptyTab);
});
test("global favorites remain shared when container separation is disabled", async () => {
  const { manager, selected } = fixture(tab("old", { favorite: true, container: "1" }));
  assert.equal(await manager._handleTabSelection({ uuid: "new", containerTabId: 2 }, false, "old"), selected);
});
test("a closing favorite cannot be retained", async () => {
  const { manager } = fixture(tab("old", { favorite: true, closing: true }));
  assert.equal(await manager._handleTabSelection({ uuid: "new" }, false, "old"), manager._emptyTab);
});
test("invalid explicit targets cannot displace a visible favorite", async () => {
  const { manager, selected } = fixture();
  for (const requested of [tab("unrelated"), tab("new", { closing: true })]) {
    assert.equal(await manager._handleTabSelection({ uuid: "new" }, false, "old", requested), selected);
  }
});
