const phase = arguments[0] || "write", done = arguments[arguments.length - 1];
(async () => {
  // Run only in the owned disposable profile. Restart that profile between
  // write/read phases to verify the real Gecko file adapter and module reload.
  const { libraryCaptures, CAPTURES_CHANGED } = ChromeUtils.importESModule(
    "moz-src:///zen/library/ZenLibraryCaptures.sys.mjs");
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const store = libraryCaptures(); await store.ready;
  const id = "3b660923-8cf4-4689-813c-630183686324";
  let checks = 0; const failures = [];
  const check = (condition, label) => { checks++; if (!condition) failures.push(label); };
  const manifest = PathUtils.join(PathUtils.profileDir, "zen-library-captures", "captures.json");
  if (phase === "write") {
    check(store.items.length === 0, "owned capture store starts empty");
    const canvas = new w.OffscreenCanvas(40, 20), context = canvas.getContext("2d");
    context.fillStyle = "#18c5a0"; context.fillRect(0, 0, 40, 20);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
    const data = { id, url: "https://example.invalid/owned-capture-source", createdDate: 1793448000000,
      text: "Owned capture fixture", captureType: "partialPage", captureLayoutInfo: {
        webContentSize: { width: 800, height: 1600 }, webContentOffset: { x: 0, y: 400 },
        frameRelativeToViewport: { x: 10, y: 15, width: 40, height: 20 },
      } };
    let notices = 0;
    const observer = { observe() { notices++; } };
    Services.obs.addObserver(observer, CAPTURES_CHANGED);
    try {
      const first = await store.save(data, bytes), oldPath = store.imagePath(first);
      check(await IOUtils.exists(oldPath), "native image writer creates an owned PNG");
      const savedBytes = await IOUtils.read(oldPath);
      check(savedBytes.length === bytes.length && savedBytes.every((b, i) => b === bytes[i]), "stored PNG matches encoded pixels");
      const next = await store.save({ ...data, text: "Updated owned capture" }, bytes);
      check(store.items.length === 1 && next.id === first.id, "updating the selection retains one capture identity");
      check(next.image !== first.image && !await IOUtils.exists(oldPath), "replacement reclaims the previous image revision");
      const disk = await IOUtils.readJSON(manifest);
      check(disk.captures.length === 1 && disk.captures[0].text === "Updated owned capture", "native manifest writer commits updated metadata");
      check(disk.garbage.length === 0, "completed cleanup clears the image journal");
      check(notices === 2, "each completed save notifies preview readers");
    } finally { Services.obs.removeObserver(observer, CAPTURES_CHANGED); }
  } else if (phase === "read") {
    const item = store.get(id);
    check(store.items.length === 1 && !!item, "fresh process restores the saved capture");
    check(item.url === "https://example.invalid/owned-capture-source", "restored capture keeps its original source page");
    check(item.createdDate === 1793448000000, "restored capture keeps its creation date");
    check(item.text === "Updated owned capture", "restored capture uses the final selection metadata");
    check(item.captureLayoutInfo.webContentOffset.y === 400, "restored capture keeps its document offset");
    const path = store.imagePath(item), bytes = await IOUtils.read(path);
    const bitmap = await w.createImageBitmap(new w.Blob([bytes], { type: "image/png" }));
    check(bitmap.width === 40 && bitmap.height === 20, "saved PNG decodes at its original dimensions");
    bitmap.close();
    check(await store.remove(id), "native adapter removes the saved capture");
    check(!await IOUtils.exists(path), "removal reclaims the owned PNG");
    const disk = await IOUtils.readJSON(manifest);
    check(!disk.captures.length && !disk.garbage.length, "removed capture and cleanup remain committed");
    check(!store.items.length, "removed capture no longer reaches readers");
  } else throw new Error("Unknown owned capture validation phase");
  return { phase, checks, failures, productionProfileUsed: false, captureUIIntegrated: false };
})().then(done, error => done({ error: String(error), stack: error.stack }));
