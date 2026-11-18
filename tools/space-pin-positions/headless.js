const [variant] = arguments;
const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
const checks = [], phases = [];
const check = (name, ok, details) => checks.push({ name, ok: !!ok, ...(ok ? {} : { details }) });
await w.SessionStore.promiseAllWindowsRestored;
await w.gZenWorkspaces.promiseInitialized;
const manager = w.gZenWorkspaces, ids = [manager.activeWorkspace], tabs = [], rows = [], labels = new Map();
const add = label => {
  const tab = w.gBrowser.addTrustedTab("about:blank", { skipAnimation: true });
  labels.set(tab, label); tabs.push(tab); return tab;
};
for (let space = 0; space < 4; space++) {
  if (space) ids.push((await manager.createAndSaveWorkspace(`Owned position Space ${space}`)).uuid);
  const group = Array.from({ length: 4 }, (_, index) => add(`space${space}-tab${index}`));
  rows.push(group);
  for (let n = 0; n < [0, 1, 2, 0][space]; n++) w.gBrowser.pinTab(group[n]);
}
await pause(400);
const label = tab => labels.get(tab) || (tab?.hasAttribute("zen-empty-tab") ? "empty" : "other");
const snapshot = () => ({
  active: ids.indexOf(manager.activeWorkspace), selected: label(w.gBrowser.selectedTab),
  order: w.gBrowser.tabs.map((tab, index) => ({ label: label(tab), index: tab.index, expectedIndex: index,
    pPos: tab._pPos, empty: tab.hasAttribute("zen-empty-tab"), pinned: tab.pinned,
    group: tab.group?.label || null })),
  spaces: ids.map(id => {
    const space = manager.workspaceElement(id);
    return { active: space.active, transform: w.getComputedStyle(space).transform,
      pinned: [...space.pinnedTabsContainer.querySelectorAll("tab")].map(label),
      normal: [...space.tabsContainer.querySelectorAll("tab")].map(label),
      separatorHidden: space.pinnedTabsContainer.hasAttribute("hide-separator") };
  }),
});
function positionsCorrect(state) {
  let position = 0;
  const seen = new Set();
  for (const tab of w.gBrowser.tabs) {
    const visitGroup = group => {
      if (!group) return true;
      if (!visitGroup(group.group)) return false;
      if (!seen.has(group)) { seen.add(group); if (group._pPos !== position++) return false; }
      return true;
    };
    if (!visitGroup(tab.group)) return false;
    if (!tab.hasAttribute("zen-empty-tab") && tab._pPos !== position++) return false;
  }
  return state.order.every(tab => tab.index === tab.expectedIndex);
}
async function switchTo(space, options = {}, name = `switch-${space}`) {
  await manager.changeWorkspaceWithID(ids[space], options);
  await pause(150);
  const state = snapshot(), correct = positionsCorrect(state);
  phases.push({ name, state, positionsCorrect: correct });
  check(`${name}: destination and container references`, manager.activeWorkspace === ids[space] &&
    w.gBrowser.pinnedTabsContainer === manager.workspaceElement(ids[space]).pinnedTabsContainer &&
    w.gBrowser.tabContainer.pinnedTabsContainer === w.gBrowser.pinnedTabsContainer);
  check(`${name}: exactly one active Space`, state.spaces.filter(s => s.active).length === 1 && state.spaces[space].active);
  if (variant === "candidate") check(`${name}: indices and folder positions match actual order`, correct, state.order);
  return state;
}
for (const space of [0, 1, 2, 3, 2, 0]) {
  const state = await switchTo(space, { selectTab: rows[space][3] });
  check(`switch-${space}: explicit tab selected`, state.selected === label(rows[space][3]));
}
const beforeNoOp = snapshot();
await manager.changeWorkspaceWithID(ids[0]);
check("same-Space repeat preserves all state", JSON.stringify(snapshot()) === JSON.stringify(beforeNoOp));

const favorite = add("shared-favorite");
await w.gZenPinnedTabManager.addToEssentials(favorite);
const folder = w.gZenFolders.createFolder(rows[2].slice(0, 2), {
  renameFolder: false, label: "Owned position folder", collapsed: false, workspaceId: ids[2],
});
await pause(300);
check("folder and shared Favorite are real connected elements", folder.isConnected && favorite.hasAttribute("zen-essential"));
w.gBrowser.selectedTab = favorite;
for (const space of [1, 2, 3, 0]) {
  await switchTo(space, {}, `shared-favorite-switch-${space}`);
  check(`shared-favorite-switch-${space}: Favorite stays selected`, w.gBrowser.selectedTab === favorite);
}

await switchTo(3, { selectTab: rows[3][3] }, "before-move");
const orderBefore = snapshot().spaces[3].normal;
w.gBrowser.moveTabBefore(rows[3][0], rows[3][3]);
await pause(200);
const orderAfter = snapshot().spaces[3].normal;
check("real tab move puts requested tab immediately before target", orderAfter.indexOf(label(rows[3][0])) + 1 === orderAfter.indexOf(label(rows[3][3])), { orderBefore, orderAfter });
const transient = add("transient-close");
w.gBrowser.removeTab(transient, { animate: false, skipPermitUnload: true });
await pause(300);
check("real close removes only the transient tab", !transient.isConnected && tabs.filter(t => t !== transient).every(t => t.isConnected));
await switchTo(2, { selectTab: rows[2][3] }, "grouped-destination-after-close");

const failures = phases.filter(phase => !phase.positionsCorrect).length;
check("baseline reproduces mismatch / candidate has none", variant === "baseline" ? failures > 0 : failures === 0, { failures });
return { ok: checks.every(c => c.ok), checks, phases, indexMismatchPhases: failures, finalState: snapshot(),
  limitations: ["Headless DOM/order/computed-style checks; no native visual or latency claim.",
    "Baseline index failures are expected reproductions; all other behavioral checks must pass."] };
