const done = arguments[arguments.length - 1];
(async () => {
  // Owned disposable profile only; no production directories are scanned.
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const { libraryCaptures } = ChromeUtils.importESModule("moz-src:///zen/library/ZenLibraryCaptures.sys.mjs");
  const { libraryHiddenFiles } = ChromeUtils.importESModule("moz-src:///zen/library/ZenLibraryHiddenFiles.sys.mjs");
  const { FileUtils } = ChromeUtils.importESModule("resource://gre/modules/FileUtils.sys.mjs");
  const store = libraryCaptures(); await store.ready; await store.clear();
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const until = async predicate => {
    for (let i = 0; i < 160 && !predicate(); i++) await pause(25);
    return !!predicate();
  };
  let checks = 0; const failures = [];
  const check = (value, label) => { checks++; if (!value) failures.push(label); };
  check(Services.prefs.getDefaultBranch("").getStringPref("zen.library.media.folders") ===
    "downloads,desktop,documents,screenshots", "packaged defaults match Arc's four media folders");
  const root = PathUtils.join(PathUtils.profileDir, "owned-media-sources-" + Services.uuid.generateUUID());
  const nested = PathUtils.join(root, "nested"); await IOUtils.makeDirectory(nested, { createAncestors: true });
  const canvas = new w.OffscreenCanvas(80, 60), context = canvas.getContext("2d");
  context.fillStyle = "#71c9ae"; context.fillRect(0, 0, 80, 60);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  const now = Date.now();
  for (let i = 0; i < 60; i++) {
    const path = PathUtils.join(root, `image-${String(i).padStart(2, "0")}.png`);
    await IOUtils.write(path, bytes); new FileUtils.File(path).lastModifiedTime = now - 100000 + i * 1000;
  }
  await IOUtils.write(PathUtils.join(nested, "newer-nested.png"), bytes);
  await IOUtils.write(PathUtils.join(root, ".hidden.png"), bytes);
  await IOUtils.writeUTF8(PathUtils.join(root, "newer.pdf"), "%PDF-1.4\nOwned non-media fixture");
  for (let i = 0; i < 3; i++) await store.save({
    id: Services.uuid.generateUUID().toString().slice(1, -1), url: "https://example.invalid/capture",
    text: "Capture " + i, createdDate: now + i * 1000, captureType: "partialPage",
    captureLayoutInfo: { webContentSize: { width: 80, height: 60 }, webContentOffset: { x: 0, y: 0 },
      frameRelativeToViewport: { x: 0, y: 0, width: 80, height: 60 } },
  }, bytes);
  Services.prefs.setBoolPref("zen.library.media.enabled", false);
  Services.prefs.setStringPref("zen.library.media.folders", root + "," + root);
  Services.prefs.setBoolPref("zen.library.media.enabled", true);
  const Library = w.customElements.get("zen-library");
  if (Library.getInstance().openProgress < 0.5) Library.toggle("media");
  else Library.getInstance().activeTab = "media";
  check(await until(() => d.querySelector("zen-library-media-section")?.items.length === 50), "Media fills its fifty-item bound");
  const section = d.querySelector("zen-library-media-section");
  if (!section) throw new Error("Media did not mount");
  check(section.items.filter(item => item._zenLibraryCapture).length === 3, "capture items share the global bound");
  check(section.items[0]?.name === "Capture 2" && section.items[3]?.name === "image-59.png", "capture and file dates share one descending chronology");
  check(section.items.at(-1)?.name === "image-13.png", "newer PDF, hidden file and nested image do not displace eligible media");
  check(new Set(section.items.map(item => item.path)).size === 50, "repeated roots do not duplicate media cards");
  const hiddenPath = section.items.find(item => item.name === "image-59.png").path;
  await libraryHiddenFiles().hide(hiddenPath);
  check(await until(() => section.items.length === 50 && section.items.at(-1)?.name === "image-12.png"), "hiding a file brings the next eligible item into the full grid");
  check(await IOUtils.exists(PathUtils.join(root, "image-59.png")), "hiding preserves the file");
  Services.prefs.setStringPref("zen.library.media.folders", nested);
  check(await until(() => section.items.length === 4), "changing folders refreshes an open Media view");
  check(section.items.some(item => item.name === "newer-nested.png"), "a nested directory is scanned when explicitly selected as a root");
  Services.prefs.setBoolPref("zen.library.media.enabled", false);
  await store.clear(); await IOUtils.remove(root, { recursive: true });
  return { checks, failures, productionProfileUsed: false, nativeMedia: true };
})().then(done, error => done({ error: String(error), stack: error.stack }));
