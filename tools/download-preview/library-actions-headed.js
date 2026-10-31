const done = arguments[arguments.length - 1];
(async () => {
  if (!PathUtils.profileDir.includes("zen-region-colors-native-")) throw new Error("Owned disposable profile required");
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const { DownloadHistory } = ChromeUtils.importESModule("resource://gre/modules/DownloadHistory.sys.mjs");
  const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const { libraryHiddenFiles } = ChromeUtils.importESModule("moz-src:///zen/library/ZenLibraryHiddenFiles.sys.mjs");
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const until = async predicate => {
    for (let i = 0; i < 150; i++) { if (await predicate()) return true; await pause(20); }
    return false;
  };
  let checks = 0; const failures = [];
  const check = (value, label) => { checks++; if (!value) failures.push(label); };
  const list = await Downloads.getList(Downloads.PUBLIC);
  const store = libraryHiddenFiles(); await store.ready;
  const folder = PathUtils.join(PathUtils.profileDir, "owned-library-actions");
  await IOUtils.makeDirectory(folder);
  const lib = d.querySelector("zen-library");
  if (!lib.hasAttribute("open")) lib.constructor.toggle("downloads");
  let section;
  if (!await until(() => (section = d.querySelector("zen-library-downloads-section")))) throw new Error("Downloads did not open");
  const rowFor = name => [...section.querySelectorAll(".zen-library-row")]
    .find(row => row.querySelector(".zen-library-row-title").textContent === name.toLowerCase());
  const create = async (label, redirected) => {
    const name = label + ".txt", path = PathUtils.join(folder, name);
    await IOUtils.writeUTF8(path, "owned fixture");
    const original = "https://example.invalid/owned-library-actions/" + label;
    const final = redirected ? "https://cdn.example.invalid/owned-library-actions/" + label : original;
    const download = await Downloads.createDownload({ source: { url: final, ...(redirected ? { originalUrl: original } : {}) }, target: path, startTime: new Date() });
    download.succeeded = true; download.stopped = true; download.endTime = Date.now();
    await download.target.refresh(); download._setBytes(download.target.size, download.target.size, true);
    await PlacesUtils.history.insert({ url: original, visits: [{ transition: PlacesUtils.history.TRANSITIONS.LINK }, { transition: PlacesUtils.history.TRANSITIONS.DOWNLOAD }] });
    if (redirected) await PlacesUtils.history.insert({ url: final, visits: [{ transition: PlacesUtils.history.TRANSITIONS.LINK }] });
    await list.add(download);
    await DownloadHistory.addDownloadToHistory(download); await DownloadHistory.updateMetaData(download);
    check(await until(() => rowFor(name)), label + ": Library row renders");
    return { name, path, original, final, download };
  };
  const act = async (fixture, action) => {
    rowFor(fixture.name).querySelector('[data-l10n-id="library-downloads-more-button"]').click();
    const popup = d.querySelector(".zen-library-downloads-menu");
    check(await until(() => popup?.state === "open"), fixture.name + ": Library menu opens");
    const item = popup.querySelector(`[data-action="${action}"]`);
    check(!item.disabled && !item.hidden, fixture.name + ": requested action is available");
    item.doCommand(); popup.hidePopup();
  };
  const visits = async url => (await PlacesUtils.history.fetch(url, { includeVisits: true }))?.visits ?? [];
  const hasVisit = async (url, type) => (await visits(url)).some(visit => visit.transition === PlacesUtils.history.TRANSITIONS[type]);
  for (const redirected of [false, true]) {
    const label = redirected ? "hide-redirected" : "hide-direct", f = await create(label, redirected);
    await act(f, "hide");
    check(await until(async () => !(await list.getAll()).includes(f.download)), label + ": live record removed");
    check(await IOUtils.exists(f.path), label + ": completed file retained");
    check(await hasVisit(f.original, "LINK"), label + ": original page visit retained");
    check(!await hasVisit(f.original, "DOWNLOAD"), label + ": original download visit removed");
    if (redirected) check(await hasVisit(f.final, "LINK"), label + ": final page visit retained");
    check(store.hasDownload(f.path) && !store.has(f.path), label + ": only download fallback is suppressed");
    const historyList = await DownloadHistory.getList({ type: Downloads.PUBLIC });
    check(!(await historyList.getAll()).some(item => (item.source.originalUrl || item.source.url) === f.original), label + ": hidden download is absent from persisted download history");
  }
  const pref = "browser.download.clearHistoryOnDelete";
  const hadPref = Services.prefs.prefHasUserValue(pref), oldPref = Services.prefs.getIntPref(pref, 0);
  try {
    for (const [mode, redirected] of [[0, false], [1, true], [2, true], [2, false]]) {
      const label = `delete-${mode}-${redirected ? "redirected" : "direct"}`;
      const f = await create(label, redirected);
      Services.prefs.setIntPref(pref, mode);
      await act(f, "delete");
      check(await until(async () => !await IOUtils.exists(f.path)), label + ": owned file removed");
      check(await hasVisit(f.original, "LINK"), label + ": original page visit retained");
      if (redirected) check(await hasVisit(f.final, "LINK"), label + ": final page visit retained");
      check(await hasVisit(f.original, "DOWNLOAD") === (mode < 2), label + ": download-history preference respected");
      check((await list.getAll()).includes(f.download) === (mode === 0), label + ": session-list preference respected");
      if (mode === 0) check(await until(() => rowFor(f.name)?.hasAttribute("missing")), label + ": retained row displays its missing-file state");
    }
  } finally {
    if (hadPref) Services.prefs.setIntPref(pref, oldPref); else Services.prefs.clearUserPref(pref);
  }
  return { checks, failures, productionProfileUsed: false, sharingInvoked: false,
    scope: "Real Library menu commands, redirected download history, ordinary visits, hidden-file persistence and deletion preferences in an owned profile" };
})().then(done, error => done({ error: String(error), stack: error.stack }));
