// Async chrome-context body; run only in a disposable five-Space profile.
if (!Services.prefs.getBoolPref("zen.developer-mode.fixture-tests", false))
  throw Error("Use a disposable fixture profile");
const manager = w.gZenWorkspaces;
const spaces = manager.getWorkspaces();
if (spaces.length < 3) throw Error("At least three Spaces are required");
const originalSpace = manager.activeWorkspace, originalTab = w.gBrowser.selectedTab;
const remembered = { ...manager.lastSelectedWorkspaceTabs };
const created = [], requests = [], results = [];
const ownChange = Object.getOwnPropertyDescriptor(manager, "changeWorkspace");
const change = manager.changeWorkspace;
manager.changeWorkspace = function (...args) {
  const pending = change.apply(this, args);
  requests.push(pending);
  return pending;
};
const drain = async () => {
  let count;
  do {
    count = requests.length;
    await Promise.all(requests.slice());
  } while (count !== requests.length);
};
const wait = async (test, description) => {
  const end = Date.now() + 10000;
  while (!test()) {
    if (Date.now() > end) throw Error(description);
    await new Promise(resolve => w.setTimeout(resolve, 1));
  }
};
const page = title => "data:text/html," + encodeURIComponent(
  `<!doctype html><title>${title}</title><body style="background:#245;color:white;font:24px system-ui"><h1>${title}</h1></body>`
);
try {
  const tabs = spaces.map((space, index) => {
    const tab = w.gBrowser.addTrustedTab(page(`Rapid target ${index + 1}`));
    created.push(tab);
    manager.moveTabToWorkspace(tab, space.uuid);
    return tab;
  });
  const favorite = w.gBrowser.addTrustedTab(page("Rapid shared favorite"));
  created.push(favorite);
  await w.gZenPinnedTabManager.addToEssentials(favorite);
  if (!favorite.hasAttribute("zen-essential")) throw Error("Favorite creation failed");
  w.gBrowser.selectedTab = favorite;
  await wait(() => favorite.linkedBrowser.contentTitle === "Rapid shared favorite", "Favorite load failed");

  for (let index = 0; index < spaces.length; ++index) {
    const next = (index + 1) % spaces.length;
    await manager.changeWorkspaceWithID(spaces[(index + 2) % spaces.length].uuid);
    w.gBrowser.selectedTab = favorite;
    w.gBrowser.selectedTab = tabs[index];
    await wait(() => manager.activeWorkspace === spaces[index].uuid &&
      w.gBrowser.selectedTab === tabs[index], "First selection did not begin");
    const duringTransition = manager.isChangingWorkspace;
    w.gBrowser.selectedTab = favorite;
    w.gBrowser.selectedTab = tabs[next];
    await drain();
    const passed = duringTransition && manager.activeWorkspace === spaces[next].uuid &&
      w.gBrowser.selectedTab === tabs[next] && !tabs[next].hidden;
    results.push({ case: "selection-during-transition", from: index + 1, to: next + 1,
      duringTransition, finalSpace: spaces.findIndex(s => s.uuid === manager.activeWorkspace) + 1,
      targetSelected: w.gBrowser.selectedTab === tabs[next], passed });
  }

  const second = w.gBrowser.addTrustedTab(page("Rapid second target"));
  created.push(second);
  manager.moveTabToWorkspace(second, spaces[0].uuid);
  await manager.changeWorkspaceWithID(spaces[1].uuid);
  w.gBrowser.selectedTab = favorite;
  w.gBrowser.selectedTab = tabs[0];
  w.gBrowser.selectedTab = second;
  await drain();
  results.push({ case: "two-targets-in-same-space", passed:
    manager.activeWorkspace === spaces[0].uuid && w.gBrowser.selectedTab === second });

  w.gBrowser.selectedTab = favorite;
  const start = w.performance.now();
  const burst = spaces.map(space => manager.changeWorkspaceWithID(space.uuid));
  await Promise.all(burst);
  await drain();
  results.push({ case: "five-space-burst", elapsedMs: w.performance.now() - start,
    passed: manager.activeWorkspace === spaces.at(-1).uuid &&
      w.gBrowser.selectedTab === favorite && !manager.isChangingWorkspace });

  if (w.spaceSwitchEvidenceFile) await IOUtils.writeJSON(w.spaceSwitchEvidenceFile, results);
  if (!w.spaceSwitchRecordBaseline && results.some(row => !row.passed))
    throw Error("Rapid selection regression failed: " + JSON.stringify(results));
  return { allPassed: results.every(row => row.passed), results };
} finally {
  await drain();
  if (ownChange) Object.defineProperty(manager, "changeWorkspace", ownChange);
  else delete manager.changeWorkspace;
  for (const tab of created) if (tab.isConnected) w.gBrowser.removeTab(tab, { animate: false });
  await manager.changeWorkspaceWithID(originalSpace);
  if (originalTab.isConnected) w.gBrowser.selectedTab = originalTab;
  manager.lastSelectedWorkspaceTabs = remembered;
}
