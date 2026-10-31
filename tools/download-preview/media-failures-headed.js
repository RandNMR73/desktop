const done = arguments[arguments.length - 1];
(async () => {
  if (!PathUtils.profileDir.includes("zen-region-colors-native-")) {
    throw new Error("This fault-injection check requires the owned disposable profile");
  }
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const { ZenDownloadPreview } = ChromeUtils.importESModule("moz-src:///zen/library/ZenDownloadPreview.sys.mjs");
  const { libraryCaptures } = ChromeUtils.importESModule("moz-src:///zen/library/ZenLibraryCaptures.sys.mjs");
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const until = async predicate => {
    for (let i = 0; i < 160 && !predicate(); i++) await pause(25);
    return !!predicate();
  };
  let checks = 0; const failures = [];
  const check = (value, label) => { checks++; if (!value) failures.push(label); };
  // Use the real polling clock, with a deliberately non-completing native API.
  const released = [], start = Date.now();
  const stuck = new ZenDownloadPreview(w, {
    media: true, start: () => 1, result: () => 0, release: id => released.push(id),
  });
  let rejected = false;
  try { await stuck.mediaFiles(["owned"]); } catch { rejected = true; }
  stuck.destroy();
  const timeoutDuration = Date.now() - start;
  check(rejected && released.length === 1 && timeoutDuration >= 10000 && timeoutDuration < 12000,
    "a non-completing native request rejects and releases once in ten seconds");

  const root = PathUtils.join(PathUtils.profileDir, "owned-media-failures-" + Services.uuid.generateUUID());
  await IOUtils.makeDirectory(root);
  const canvas = new w.OffscreenCanvas(80, 60), ctx = canvas.getContext("2d");
  ctx.fillStyle = "#71c9ae"; ctx.fillRect(0, 0, 80, 60);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  await IOUtils.write(PathUtils.join(root, "kept.png"), bytes);
  const store = libraryCaptures(); await store.ready; await store.clear();
  Services.prefs.setStringPref("zen.library.media.folders", root);
  Services.prefs.setBoolPref("zen.library.media.enabled", true);
  const Library = w.customElements.get("zen-library");
  if (Library.getInstance().openProgress < 0.5) Library.toggle("media");
  else Library.getInstance().activeTab = "media";
  check(await until(() => d.querySelector("zen-library-media-section")?.items.length === 1),
    "an actual owned folder loads through the packaged native bridge");
  let section = d.querySelector("zen-library-media-section");
  const original = ZenDownloadPreview.prototype.mediaFiles;
  try {
    let fail;
    ZenDownloadPreview.prototype.mediaFiles = () => new Promise((_resolve, reject) => { fail = reject; });
    Services.prefs.setStringPref("zen.library.media.folders", root + ",");
    check(await until(() => !!fail), "refresh starts a new query");
    check(!section.loading && !!section.querySelector(".zen-library-media-grid"), "refresh preserves the visible grid");
    await store.save({ id: Services.uuid.generateUUID().toString().slice(1, -1),
      url: "https://example.invalid/capture", text: "Saved during scan", createdDate: Date.now(),
      captureType: "partialPage", captureLayoutInfo: { webContentSize: { width: 80, height: 60 },
        webContentOffset: { x: 0, y: 0 }, frameRelativeToViewport: { x: 0, y: 0, width: 80, height: 60 } },
    }, bytes);
    fail(new Error("Owned query failure"));
    check(await until(() => section.scanFailed && !section.loading), "failed refresh settles");
    check(section.items.length === 2 && section.items.some(item => item.name === "kept.png") &&
      section.items.some(item => item.name === "Saved during scan"), "failure retains files and intervening captures");
    await section.updateComplete;
    check(!!section.querySelector('[data-l10n-id="library-media-load-failed"]') &&
      section.querySelectorAll(".zen-library-media-item").length === 2,
      "failure message and retained thumbnails render together");
    ZenDownloadPreview.prototype.mediaFiles = original;
    await IOUtils.write(PathUtils.join(root, "recovered.png"), bytes);
    section.querySelector('[data-l10n-id="library-media-retry"]').click();
    check(await until(() => !section.scanFailed && section.items.length === 3), "Try Again recovers from the real owned folder");
    await section.updateComplete;
    check(!section.querySelector('[data-l10n-id="library-media-load-failed"]'), "successful retry removes the failure message");

    await store.clear();
    Services.prefs.setBoolPref("zen.library.media.enabled", false);
    check(await until(() => section.items.length === 0 && !section.loading), "turning Media off resets the folder view");
    ZenDownloadPreview.prototype.mediaFiles = async () => { throw new Error("Owned initial query failure"); };
    Services.prefs.setBoolPref("zen.library.media.enabled", true);
    check(await until(() => d.querySelector("zen-library-media-section")?.scanFailed), "an initial failure settles without an empty-success message");
    section = d.querySelector("zen-library-media-section"); await section.updateComplete;
    await d.l10n.translateFragment(section);
    check(!section.loading && !section.querySelector('[data-l10n-id="library-media-empty"]') &&
      !!section.querySelector('[data-l10n-id="library-media-retry"]'), "initial failure provides a visible retry");
    return { checks, failures, timeoutDuration, productionProfileUsed: false,
      failureText: section.querySelector('[role="status"]')?.textContent.trim() ?? null,
      ownedFolder: root, leftForNativeInspection: true };
  } finally {
    ZenDownloadPreview.prototype.mediaFiles = original;
  }
})().then(done, error => done({ error: String(error), stack: error.stack }));
