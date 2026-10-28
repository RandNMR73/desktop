// Async chrome-context body for the disposable browser harness (window = w).
if (!Services.prefs.getBoolPref("zen.developer-mode.fixture-tests", false))
  throw Error("Use only a disposable fixture profile");
const manager = w.gZenWorkspaces;
const originalSpace = manager.activeWorkspace;
const originalTab = w.gBrowser.selectedTab;
const remembered = { ...manager.lastSelectedWorkspaceTabs };
const spaces = manager.getWorkspaces();
const created = [], rows = [];
const wait = async (condition, label) => {
  const deadline = Date.now() + 10000;
  while (!condition()) {
    if (Date.now() >= deadline) throw Error(`Did not settle: ${label}; active=${manager.activeWorkspace}; selected=${w.gBrowser.selectedTab.label}`);
    await new Promise(resolve => w.setTimeout(resolve, 25));
  }
};
const page = title => "data:text/html," + encodeURIComponent(
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="background:#245;color:white;font:24px system-ui;padding:24px">` +
  `<h1>${title}</h1><button onclick="this.textContent=Number(this.textContent)+1">0</button></body>`
);
const cleanup = async () => {
  for (const tab of created) if (tab.isConnected) w.gBrowser.removeTab(tab, { animate: false });
  await manager.changeWorkspaceWithID(originalSpace);
  if (originalTab.isConnected) w.gBrowser.selectedTab = originalTab;
  manager.lastSelectedWorkspaceTabs = remembered;
  delete w.spaceContinuityFixture;
};
let finished = false;
try {
  const ordinary = [];
  for (const [index, space] of spaces.entries()) {
    const tab = w.gBrowser.addTrustedTab(page(`Space ${index + 1} fixture`));
    created.push(tab);
    manager.moveTabToWorkspace(tab, space.uuid);
    manager.lastSelectedWorkspaceTabs[space.uuid] = tab;
    ordinary.push(tab);
  }
  const favorite = w.gBrowser.addTrustedTab(page("Shared favorite fixture"));
  created.push(favorite);
  await w.gZenPinnedTabManager.addToEssentials(favorite);
  if (!favorite.hasAttribute("zen-essential")) throw Error("Could not create fixture favorite");
  w.gBrowser.selectedTab = favorite;
  await wait(() => favorite.linkedBrowser.contentTitle === "Shared favorite fixture" &&
    !favorite.linkedBrowser.webProgress.isLoadingDocument, "favorite document load");
  const documentId = favorite.linkedBrowser.browsingContext.currentWindowGlobal.innerWindowId;
  for (const [index, space] of spaces.entries()) {
    let selectionEvents = 0;
    const onSelect = () => selectionEvents++;
    w.gBrowser.tabContainer.addEventListener("TabSelect", onSelect);
    const start = w.performance.now();
    try { await manager.changeWorkspaceWithID(space.uuid); }
    finally { w.gBrowser.tabContainer.removeEventListener("TabSelect", onSelect); }
    const elapsedMs = w.performance.now() - start;
    if (w.gBrowser.selectedTab !== favorite || selectionEvents !== 0)
      throw Error(`Favorite was replaced in Space ${index + 1}`);
    if (favorite.linkedBrowser.browsingContext.currentWindowGlobal.innerWindowId !== documentId)
      throw Error("Favorite document reloaded during Space switch");
    rows.push({ space: index + 1, favoriteRetained: true, selectionEvents,
      sameDocument: true, elapsedMs });
  }
  // A cross-Space explicit selection must still supersede the shared favorite.
  for (let index = 0; index < spaces.length; ++index) {
    const target = ordinary[index];
    w.gBrowser.selectedTab = favorite;
    // Observe the real switch promise: selectedTab and activeWorkspace update
    // before the sidebar animation has finished. Await its completion before
    // issuing the next independent selection.
    const ownSwitch = Object.getOwnPropertyDescriptor(manager, "changeWorkspaceWithID");
    const change = manager.changeWorkspaceWithID;
    let pending;
    manager.changeWorkspaceWithID = function (...args) {
      pending = change.apply(this, args);
      return pending;
    };
    try {
      w.gBrowser.selectedTab = target;
      await pending;
    } finally {
      if (ownSwitch) Object.defineProperty(manager, "changeWorkspaceWithID", ownSwitch);
      else delete manager.changeWorkspaceWithID;
    }
    await wait(() => manager.activeWorkspace === spaces[index].uuid &&
      w.gBrowser.selectedTab === target && !target.hidden, `explicit tab ${index + 1}`);
    rows[index].explicitTargetSelected = true;
  }
  await manager.changeWorkspaceWithID(originalSpace);
  w.gBrowser.selectedTab = favorite;
  if (w.spaceContinuityEvidenceDir)
    await IOUtils.writeJSON(w.spaceContinuityEvidenceDir + "/candidate-runtime.json", rows);
  if (w.spaceContinuityKeepFixture) w.spaceContinuityFixture = { favorite, cleanup };
  finished = true;
  return { spaces: rows.length, allPassed: true, rows };
} finally {
  if (!finished || !w.spaceContinuityKeepFixture) await cleanup();
}
