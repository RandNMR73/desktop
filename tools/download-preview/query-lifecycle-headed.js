const done = arguments[arguments.length - 1];
(async () => {
  if (!PathUtils.profileDir.includes("zen-region-colors-native-")) {
    throw new Error("This check requires an owned disposable profile");
  }
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const { ZenDownloadPreview } = ChromeUtils.importESModule("moz-src:///zen/library/ZenDownloadPreview.sys.mjs");
  const { HIDDEN_FILES_CHANGED } = ChromeUtils.importESModule("moz-src:///zen/library/ZenLibraryHiddenFiles.sys.mjs");
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const until = async predicate => {
    for (let i = 0; i < 200 && !predicate(); i++) await pause(25);
    return !!predicate();
  };
  let checks = 0; const failures = [];
  const check = (value, label) => { checks++; if (!value) failures.push(label); };
  const rows = () => [...d.getElementById("zen-library-download-list").children].filter(row => !row.hidden);
  const paths = () => rows().map(row => row.download.target.path);
  const refresh = () => Services.obs.notifyObservers(null, HIDDEN_FILES_CHANGED);
  let root = PathUtils.join(PathUtils.profileDir, "owned-preview-lifecycle");
  await IOUtils.makeDirectory(root);
  const folder = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  folder.initWithPath(root); folder.normalize(); root = folder.path;
  const before = [];
  for (let i = 0; i < 4; i++) {
    const path = PathUtils.join(root, `Preview fixture ${i + 1}.json`);
    await IOUtils.writeUTF8(path, JSON.stringify({ fixture: i }));
    await IOUtils.setModificationTime(path, Date.now() - (4 - i) * 86400000);
    before.push(path);
  }
  Services.prefs.setStringPref("browser.download.dir", root);
  Services.prefs.setIntPref("browser.download.folderList", 2);
  for (const source of ["download", "documents", "desktop", "screenshot", "capture"]) {
    Services.prefs.setBoolPref(`zen.library.preview.sources.${source}`, source === "download");
  }
  refresh();
  check(await until(() => JSON.stringify(paths()) === JSON.stringify(before)), "four actual owned files load in oldest-to-newest row order");
  const button = d.getElementById("zen-library-button"), footer = d.getElementById("zen-sidebar-foot-buttons");
  const rect = button.getBoundingClientRect();
  button.dispatchEvent(new w.MouseEvent("mouseenter", { clientX: rect.x + rect.width / 2,
    clientY: rect.y + rect.height / 2 }));
  check(await until(() => footer.hasAttribute("zen-library-stack-open")), "existing rows open after the hover dwell");
  const original = ZenDownloadPreview.prototype.sourceFiles;
  let attempts = 0;
  try {
    ZenDownloadPreview.prototype.sourceFiles = async () => { attempts++; throw new Error("Owned folder failure"); };
    refresh();
    check(await until(() => attempts > 0), "a failed refresh reaches the preview scanner");
    await pause(120);
    check(JSON.stringify(paths()) === JSON.stringify(before), "failed refresh preserves all four last-successful items");
    check(footer.hasAttribute("zen-library-stack-open"), "failed refresh keeps the open preview visible");
  } finally { ZenDownloadPreview.prototype.sourceFiles = original; }
  const replacement = PathUtils.join(root, "Recovered newest.json");
  await IOUtils.writeUTF8(replacement, "{}");
  refresh();
  check(await until(() => paths().at(-1) === replacement && !paths().includes(before[0])), "a later real scan replaces the oldest item with the new file");

  const released = [], started = Date.now();
  const stuck = new ZenDownloadPreview(w, { sources: true, start: () => 4,
    result: () => 0, release: id => released.push(id) });
  let rejected = false;
  try { await stuck.sourceFiles(root, { download: true }); } catch { rejected = true; }
  const timeoutDuration = Date.now() - started;
  stuck.destroy();
  check(rejected && released.length === 1 && timeoutDuration >= 10000 && timeoutDuration < 12000,
    "real polling timeout rejects and releases exactly once");
  check(rows().length === 4, "independent request failure leaves the widget's four items intact");
  await pause(400);
  const geometry = rows().map(row => {
    const bounds = row.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  });
  check(geometry.every(row => Math.abs(row.height - 52) < 0.01), "recovered rows retain the 52-point row within the 56-point pitch");
  check(geometry.slice(1).every((row, i) => Math.abs(row.y - geometry[i].y - 56) < 0.01), "recovered rows retain the reference pitch");
  return { checks, failures, timeoutDuration, geometry, productionProfileUsed: false,
    nativeHoverVerified: false, method: "Owned profile, real file scans, injected failure, synthetic hover" };
})().then(done, error => done({ error: String(error), stack: error.stack }));
