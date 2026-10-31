const done = arguments[arguments.length - 1];
const phase = arguments[0];
(async () => {
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const { Integration } = ChromeUtils.importESModule("resource://gre/modules/Integration.sys.mjs");
  const { DownloadIntegration: baseIntegration } = ChromeUtils.importESModule("resource://gre/modules/DownloadIntegration.sys.mjs");
  const DownloadIntegration = Integration.downloads.getCombined(baseIntegration);
  const { DownloadHistory } = ChromeUtils.importESModule("resource://gre/modules/DownloadHistory.sys.mjs");
  const { DownloadsCommon } = ChromeUtils.importESModule("moz-src:///browser/components/downloads/DownloadsCommon.sys.mjs");
  const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const publicList = await Downloads.getList(Downloads.PUBLIC);
  const history = await DownloadHistory.getList({ type: Downloads.PUBLIC });
  const root = PathUtils.profileDir;
  if (!root.includes("zen-region-colors-native-")) throw new Error("Disposable profile required");
  let checks = 0;
  const failures = [];
  const check = (value, label) => { checks++; if (!value) failures.push(label); };
  const delay = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const until = async predicate => {
    for (let i = 0; i < 100; i++) {
      if (await predicate()) return true;
      await delay(30);
    }
    return false;
  };
  const saved = async () => await IOUtils.exists(PathUtils.join(root, "downloads.json"))
    ? (await IOUtils.readJSON(PathUtils.join(root, "downloads.json"))).list : [];
  const records = await publicList.getAll();
  const restored = records.filter(item => /owned-restored-\d\.txt$/.test(item.target.path));
  const named = i => restored.find(item => item.target.path.endsWith(`owned-restored-${i}.txt`));
  if (phase === "initial" || phase === "restart") {
    check(restored.length === (phase === "initial" ? 4 : 3), "restored record count");
    for (let i = phase === "initial" ? 0 : 1; i < 4; i++) {
      const item = named(i);
      check(item?.succeeded && item.stopped && !item.error, `restored ${i} remains completed`);
      check(item?.endTime === 1780275724000 + i * 86400000, `restored ${i} retains completion time`);
      check(item?.startTime?.toISOString() === `2026-06-0${i + 1}T01:02:03.000Z`, `restored ${i} retains start time`);
      if (i < 2) check(item?.source.originalUrl === new URL(item.source.url).origin + "/original-source", `restored ${i} retains redirect origin`);
      check(item?.target.exists, `restored ${i} file exists`);
      check(item?.newDownloadNotified, `restored ${i} is not a new notification`);
      check(item?.source.url === (i < 2 ? named(1).source.url : `blob:https://example.invalid/owned-${i}`), `restored ${i} retains source`);
    }
    const visible = await history.getAll();
    check(restored.every(item => visible.includes(item)), "Library history contains each restored record");
    const { previewDownloadRecords } = ChromeUtils.importESModule("moz-src:///zen/library/ZenLibraryPreviewSources.sys.mjs");
    check(![...previewDownloadRecords(false).records].some(item => restored.includes(item)), "restored downloads do not become preview arrivals");
    check(!w.document.getElementById("zen-sidebar-foot-buttons").hasAttribute("zen-library-badge"), "no restored footer download badge");
  }
  if (phase === "initial") {
    check(named(0).source.url === named(1).source.url && named(0) !== named(1), "repeated source URL keeps both records");
    await DownloadIntegration.forceSave();
    check((await saved()).length === 4, "completed records survive a normal save");
    const before = named(2).getSerializationHash();
    named(2).deleted = true;
    check(named(2).getSerializationHash() !== before, "deleted status changes persistence hash");
    named(2).deleted = false;
    Services.prefs.setBoolPref("zen.library.downloads.persist-completed", false);
    check(!DownloadIntegration.shouldPersistDownload(named(0)), "preference can disable completed persistence");
    Services.prefs.clearUserPref("zen.library.downloads.persist-completed");
    const base = new URL(named(0).source.url).origin;
    const live = await Downloads.createDownload({ source: base + "/owned-live", target: PathUtils.join(root, "owned-live.txt") });
    await publicList.add(live);
    await live.start();
    check(live.succeeded && live.endTime > 1780275724000, "new public download completes normally");
    const privateList = await Downloads.getList(Downloads.PRIVATE);
    const privateDownload = await Downloads.createDownload({ source: { url: base + "/owned-private", isPrivate: true }, target: PathUtils.join(root, "owned-private.txt") });
    await privateList.add(privateDownload);
    await privateDownload.start();
    check(privateDownload.succeeded && !DownloadIntegration.shouldPersistDownload(privateDownload), "completed private download is not eligible for persistence");
    await DownloadsCommon.deleteDownload(named(0));
    check(await until(async () => {
      const rows = await saved();
      return rows.length === 4 && rows.some(item => JSON.stringify(item).includes("owned-live")) &&
        !rows.some(item => JSON.stringify(item).includes("owned-restored-0"));
    }), "automatic save reflects completion and removal");
    await DownloadIntegration.forceSave();
    const stored = await saved();
    check(stored.length === 4, "save includes three restored records and new public download");
    check(!stored.some(item => JSON.stringify(item).includes("owned-private")), "private source and target absent from disk");
    check(!stored.some(item => JSON.stringify(item).includes("owned-restored-0")), "removed record absent from disk");
    check(stored.some(item => item.source?.url === `blob:https://example.invalid/owned-2` || item.source === `blob:https://example.invalid/owned-2`), "blob source survives save");
    await IOUtils.writeJSON(PathUtils.join(root, "owned-persistence-expected.json"), { liveEnd: live.endTime, liveStart: live.startTime.toISOString() });
  } else if (phase === "restart") {
    const expected = await IOUtils.readJSON(PathUtils.join(root, "owned-persistence-expected.json"));
    const live = records.find(item => item.target.path.endsWith("/owned-live.txt"));
    check(live?.succeeded && live.stopped, "new public download survives browser restart");
    check(live?.endTime === expected.liveEnd && live.startTime.toISOString() === expected.liveStart, "new download dates survive browser restart");
    check(!records.some(item => item.target.path.endsWith("/owned-restored-0.txt")), "removed record stays removed after restart");
    check(!(await (await Downloads.getList(Downloads.PRIVATE)).getAll()).length, "private download does not survive restart");
    await new Promise(resolve => Services.clearData.deleteData(Ci.nsIClearDataService.CLEAR_DOWNLOADS, resolve));
    check(await until(async () => !(await publicList.getAll()).length), "Clear Downloads empties public list");
    await PlacesUtils.history.removeVisitsByFilter({ transition: PlacesUtils.history.TRANSITIONS.DOWNLOAD });
    await DownloadIntegration.forceSave();
    check(!(await saved()).length, "Clear Downloads empties the persisted store");
    for (let i = 0; i < 4; i++) check(await IOUtils.exists(PathUtils.join(root, `owned-restored-${i}.txt`)), `clear/remove preserves downloaded file ${i}`);
  } else if (phase === "cleared") {
    check(!records.length, "cleared downloads remain empty after a second restart");
    check(!(await saved()).length, "cleared store remains empty after a second restart");
    check(!(await history.getAll()).length, "cleared Library history stays empty");
  } else {
    throw new Error("Unknown test phase");
  }
  return { phase, checks, failures, production_profile_used: false };
})().then(done, error => done({ error: String(error), stack: error.stack }));
