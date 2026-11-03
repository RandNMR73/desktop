const done = arguments[arguments.length - 1];
(async () => {
  if (!Services.dirsvc.get("ProfD", Ci.nsIFile).path.includes("zen-search-color-retention-")) {
    throw Error("Disposable profile required");
  }
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  await w.gZenWorkspaces.promiseInitialized;
  const { SessionStore } = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/SessionStore.sys.mjs");
  const { PlacesUtils: P } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const spaces = w.gZenWorkspaces.getWorkspaces();
  const active = w.gZenWorkspaces.activeWorkspace;
  const other = spaces.find(s => s.uuid !== active).uuid;
  const canvas = w.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = canvas.height = 16;
  const context = canvas.getContext("2d");
  context.fillStyle = "#e02020";
  context.fillRect(0, 0, 16, 16);
  const icon = canvas.toDataURL();
  const tabs = [];
  const add = (url, label, space = active) => {
    const tab = w.gBrowser.addTrustedTab("about:blank", { skipAnimation: true, skipLoad: true });
    tab.setAttribute("zen-workspace-id", space);
    SessionStore.setTabState(tab, { entries: [{ url, title: label }], index: 1, image: icon,
      zenWorkspace: space, zenStaticLabel: label });
    tab.setAttribute("zen-static-label", label);
    tabs.push(tab);
    return tab;
  };
  const local = add("https://fixture.test/home", "Saved local name");
  const hidden = add("https://fixture.test/other", "Other Space name", other);
  const left = add("https://fixture.test/left", "Left pane");
  const right = add("https://fixture.test/right", "Right pane");
  w.gZenViewSplitter.splitTabs([left, right], "grid", -1, { activate: false });
  await P.history.insert({ url: "https://fixture.test/other", title: "Visited other Space page",
    visits: [{ date: new Date(Date.now() - 10000), transition: P.history.TRANSITIONS.LINK }] });
  const orphan = add("https://fixture.test/never", "Unvisited other Space", other);
  w.__typedTabs = { tabs, local, hidden, left, right, orphan, icon, active, other };
  const bar = w.gURLBar;
  bar.searchMode = null;
  bar.value = "fixture";
  bar.focus();
  await bar.startQuery({ searchString: "fixture" });
  await new Promise(resolve => w.setTimeout(resolve, 1000));
  const rows = [...w.document.querySelectorAll(".urlbarView-row")].filter(row => row.result);
  return { tabs: tabs.map(t => ({ title: t.label, saved: t.getAttribute("zen-static-label"),
      url: t.linkedBrowser.currentURI.spec, pending: t.hasAttribute("pending"),
      icon: !!t.image, group: t.group?.id, split: t.group?.hasAttribute("split-view-group") })),
    rows: rows.map(row => ({ type: row.result.type, provider: row.result.providerName,
      payload: { ...row.result.payload, icon: row.result.payload.icon?.slice(0, 70) },
      title: row.querySelector(".urlbarView-title")?.textContent,
      action: row.querySelector(".urlbarView-action")?.textContent })) };
})().then(done, error => done({ error: String(error), stack: error.stack }));
