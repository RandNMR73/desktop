const done = arguments[arguments.length - 1];
(async () => {
  const main = Services.wm.getMostRecentWindow("navigator:browser");
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const { DownloadIntegration } = ChromeUtils.importESModule("resource://gre/modules/DownloadIntegration.sys.mjs");
  const normalList = await Downloads.getList(Downloads.PUBLIC);
  const privateList = await Downloads.getList(Downloads.PRIVATE);
  const owned = [], windows = [];
  const pause = ms => new Promise(resolve => main.setTimeout(resolve, ms));
  const until = async predicate => {
    for (let i = 0; i < 150 && !predicate(); i++) await pause(30);
    return !!predicate();
  };
  const records = win => [...(win.document.getElementById("zen-library-download-list")?.children || [])]
    .filter(row => !row.hidden).map(row => row.download);
  const open = async options => {
    const win = main.OpenBrowserWindow(options); windows.push(win);
    await until(() => win.gBrowserInit?.delayedStartupFinished);
    return win;
  };
  const path = PathUtils.join(await DownloadIntegration.getPreferredDownloadsDirectory(), "recency-0.json");
  const add = async isPrivate => {
    const download = await Downloads.createDownload({ source: { url: "https://example.invalid/owned-window-source", isPrivate },
      target: path, startTime: new Date() });
    await download.target.refresh(); download.succeeded = false; download.stopped = false;
    download._setBytes(45, 100, true);
    const list = isPrivate ? privateList : normalList;
    owned.push({ list, download }); await list.add(download);
    return download;
  };
  let checks = 0; const failures = [];
  const check = (value, message) => { checks++; if (!value) failures.push(message); };
  const pref = "zen.library.preview.sources.download", saved = Services.prefs.getBoolPref(pref, true);
  const capturePref = "zen.library.preview.sources.capture", savedCapture = Services.prefs.getBoolPref(capturePref, true);
  try {
    main.document.getElementById("zen-library-button").dispatchEvent(
      new main.MouseEvent("mouseleave", { clientX: 500, clientY: 400 }));
    const normal = await add(false);
    check(normal.target.exists, "owned completion fixture exists on disk");
    check(await until(() => records(main).includes(normal)), "initial window receives live download");
    normal.stopped = true; normal.succeeded = true; normal._setBytes(100, 100, true);
    const footer = main.document.getElementById("zen-sidebar-foot-buttons");
    check(await until(() => footer.hasAttribute("zen-library-badge")), "unread completed download retains its footer badge");
    Services.prefs.setBoolPref(capturePref, !savedCapture);
    check(footer.hasAttribute("zen-library-badge"), "unrelated source choice preserves an eligible unread download badge");
    Services.prefs.setBoolPref(capturePref, savedCapture);
    const second = await open();
    check(await until(() => records(second).includes(normal)), "new normal window inherits an existing live arrival");
    Services.prefs.setBoolPref(pref, false);
    check(await until(() => !records(main).includes(normal) && !records(second).includes(normal)), "source reconfiguration removes existing download in both windows");
    const later = await add(false);
    check(await until(() => records(main).includes(later) && records(second).includes(later)), "both windows receive a new download with Downloads disabled");
    second.close();
    check(await until(() => second.closed), "secondary normal window closes");
    check(records(main).includes(later), "closing one normal window preserves the remaining preview");
    const privateWindow = await open({ private: true });
    check(!records(privateWindow).includes(later), "private window excludes normal download arrivals");
    const secret = await add(true);
    check(await until(() => records(privateWindow).includes(secret)), "private window receives its private download");
    check(!records(main).includes(secret), "normal window excludes private download arrivals");
    secret.stopped = true; secret.succeeded = true;
    privateWindow.close();
    check(await until(() => privateWindow.closed), "last private window closes");
    const nextPrivate = await open({ private: true });
    check(!records(nextPrivate).includes(secret), "new private session excludes the previous session's arrival");
    check(records(main).includes(later), "private teardown preserves normal arrivals");
  } finally {
    for (const { list, download } of owned) {
      download.stopped = true;
      await list.remove(download);
    }
    for (const win of windows) if (!win.closed) win.close();
    Services.prefs.setBoolPref(pref, saved);
    Services.prefs.setBoolPref(capturePref, savedCapture);
  }
  return { checks, failures, productionProfileUsed: false, ownedWindows: windows.length };
})().then(done, error => done({ error: String(error), stack: error.stack }));
