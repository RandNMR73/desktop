const done = arguments[arguments.length - 1];
(async () => {
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const { ZenDownloadPreview } = ChromeUtils.importESModule("moz-src:///zen/library/ZenDownloadPreview.sys.mjs");
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const { DownloadIntegration } = ChromeUtils.importESModule("resource://gre/modules/DownloadIntegration.sys.mjs");
  const sources = ["documents", "desktop", "screenshot", "capture", "download"];
  const prefix = "zen.library.preview.sources.";
  const saved = Object.fromEntries(sources.map(key => [key, Services.prefs.getBoolPref(prefix + key, true)]));
  const set = (key, value) => Services.prefs.setBoolPref(prefix + key, value);
  const button = d.getElementById("zen-library-button"), list = d.getElementById("zen-library-download-list");
  const foot = d.getElementById("zen-sidebar-foot-buttons");
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const until = async predicate => {
    for (let i = 0; i < 100 && !predicate(); i++) await pause(30);
    return !!predicate();
  };
  const rows = () => [...list.children].filter(row => !row.hidden);
  const titles = () => rows().map(row => row.querySelector(".zen-library-download-list-title").textContent);
  const enter = () => {
    const r = button.getBoundingClientRect();
    button.dispatchEvent(new w.MouseEvent("mouseenter", { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
  };
  const leave = () => button.dispatchEvent(new w.MouseEvent("mouseleave", { clientX: 500, clientY: 400 }));
  let checks = 0; const failures = [], menus = [], queries = [], owned = [];
  const check = (value, label) => { checks++; if (!value) failures.push(label); };
  const original = ZenDownloadPreview.prototype.sourceFiles;
  const preview = new ZenDownloadPreview(w);
  const path = await DownloadIntegration.getPreferredDownloadsDirectory();
  const files = await preview.sourceFiles(path, { download: true });
  preview.destroy();
  const downloads = await Downloads.getList(Downloads.PUBLIC);
  let releaseOld, pending = false, active = 0, maxActive = 0, staleSeen = false;
  const observe = new w.MutationObserver(() => {
    if (titles().some(title => title === "stale-source-result.png")) staleSeen = true;
  });
  observe.observe(list, { subtree: true, childList: true, characterData: true, attributes: true });
  // Only this disposable browser profile is instrumented. Native source
  // eligibility and directory merging are separately exercised by the compiled
  // fixture suite; these controlled queries exercise UI races without reading
  // the user's real Documents/Desktop folders.
  ZenDownloadPreview.prototype.sourceFiles = async function (_path, selected) {
    queries.push({ ...selected }); active++; maxActive = Math.max(maxActive, active);
    try {
      if (pending) {
        pending = false;
        return await new Promise(resolve => { releaseOld = resolve; });
      }
      return selected.download ? files : [];
    } finally { active--; }
  };
  try {
    check(files.length === 4, "real native Downloads query returns four owned fixtures");
    for (const space of w.gZenWorkspaces.getWorkspaces()) {
      await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid);
      enter();
      check(await until(() => foot.hasAttribute("zen-library-stack-open")), space.name + ": preview opens");
      const r = button.getBoundingClientRect();
      button.dispatchEvent(new w.MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2,
        screenX: w.mozInnerScreenX + r.x + r.width / 2,
        screenY: w.mozInnerScreenY + r.y + r.height / 2 }));
      check(await until(() => d.getElementById("zen-library-preview-source-menu")?.state === "open"), space.name + ": source menu opens");
      const popup = d.getElementById("zen-library-preview-source-menu");
      if (!popup) continue;
      const items = [...popup.children];
      const labels = items.map(item => item.getAttribute("label"));
      check(labels.join("|") === "Show media from:|Documents|Desktop|Screenshots|Arc Captures|Downloads", space.name + ": exact menu wording and order");
      check(items[0].disabled, space.name + ": heading is disabled");
      for (let i = 1; i < items.length; i++) {
        const key = sources[i - 1];
        check(items[i].getAttribute("type") === "checkbox", space.name + ": checkbox " + key);
        check(items[i].getAttribute("checked") === String(Services.prefs.getBoolPref(prefix + key, true)), space.name + ": checked state " + key);
      }
      const oldDesktop = Services.prefs.getBoolPref(prefix + "desktop", true);
      items[2].doCommand();
      check(Services.prefs.getBoolPref(prefix + "desktop", true) === !oldDesktop, space.name + ": selecting Desktop changes its source");
      check(Services.prefs.getBoolPref(prefix + "screenshot", true) === saved.screenshot, space.name + ": Desktop leaves Screenshots independent");
      popup.hidePopup();
      check(await until(() => !popup.isConnected), space.name + ": closed popup is removed");
      set("desktop", oldDesktop);
      menus.push({ space: space.name, labels });
      leave();
    }
    for (const source of sources) set(source, false);
    await pause(100);
    check(await until(() => rows().length === 0), "all disabled sources empty the existing preview");
    const arrival = await Downloads.createDownload({ source: { url: "https://example.invalid/owned-source-arrival" },
      target: files[0].target.path, startTime: new Date() });
    await arrival.refresh(); arrival.succeeded = false; arrival.stopped = false;
    arrival._setBytes(30, 100, true);
    owned.push(arrival); await downloads.add(arrival); enter();
    check(await until(() => rows().some(row => row.download === arrival)), "new live download appears while folder source is disabled");
    check(foot.hasAttribute("zen-library-badge"), "new active download has a footer badge");
    set("documents", true);
    check(await until(() => rows().length === 0), "reconfiguring sources removes an existing disabled download");
    check(!foot.hasAttribute("zen-library-badge"), "filtered active item releases its footer badge");
    check(await until(() => queries.some(query => query.documents && !query.download)), "widget forwards source choices to its query");
    set("documents", false); set("download", true); enter();
    check(await until(() => rows().length === 4), "reenabling Downloads refills four folder entries");
    check(rows().every(row => row.download._zenDiskFile), "removed browser record does not replace the disk source after reenable");
    pending = true;
    set("desktop", true);
    check(await until(() => !!releaseOld), "first asynchronous source query starts");
    set("desktop", false);
    const stale = { ...files[0], target: { ...files[0].target,
      path: PathUtils.join(PathUtils.parent(files[0].target.path), "stale-source-result.png") } };
    releaseOld?.([stale]);
    check(await until(() => rows().length === 4), "latest source query replaces a pending older query");
    await pause(100);
    check(!staleSeen, "stale source result never reaches a visible row");
    check(maxActive === 1, "preference changes retain one in-flight folder scan");
    check(queries.at(-1).desktop === false, "rescan uses latest preference snapshot");
  } finally {
    releaseOld?.([]); observe.disconnect();
    ZenDownloadPreview.prototype.sourceFiles = original;
    for (const item of owned) await downloads.remove(item);
    for (const source of sources) set(source, saved[source]);
    await w.gZenWorkspaces.changeWorkspaceWithID(w.gZenWorkspaces.getWorkspaces()[0].uuid);
    leave(); enter(); await pause(500);
  }
  return { checks, failures, menus, sourceQueries: queries.length, maxConcurrentSourceQueries: maxActive,
    productionProfileUsed: false, controlledFolderQueries: true, capturePersistenceTested: false };
})().then(done, error => done({ error: String(error), stack: error.stack }));
