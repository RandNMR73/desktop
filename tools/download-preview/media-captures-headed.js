const done = arguments[arguments.length - 1];
(async () => {
  // Owned disposable profile only. Folder fixtures live inside that profile.
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const { libraryCaptures } = ChromeUtils.importESModule("moz-src:///zen/library/ZenLibraryCaptures.sys.mjs");
  const { nativeMediaPreview } = ChromeUtils.importESModule("moz-src:///zen/library/ZenNativeMediaPreview.sys.mjs");
  const { ZenLibraryFileMenu, mediaFileRecord } = ChromeUtils.importESModule("moz-src:///zen/library/ZenLibraryFileMenu.sys.mjs");
  const store = libraryCaptures(); await store.ready; await store.clear();
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const until = async predicate => {
    for (let i = 0; i < 120 && !predicate(); i++) await pause(25);
    return !!predicate();
  };
  let checks = 0; const failures = [], menus = [], layouts = [];
  const check = (value, label) => { checks++; if (!value) failures.push(label); };
  const canvas = new w.OffscreenCanvas(400, 280), ctx = canvas.getContext("2d");
  const png = async (color, title) => {
    ctx.fillStyle = color; ctx.fillRect(0, 0, 400, 280);
    ctx.fillStyle = "#203240"; ctx.font = "bold 28px sans-serif"; ctx.fillText(title, 24, 58);
    for (let i = 0; i < 5; i++) ctx.fillRect(24, 95 + i * 26, 300 - i * 28, 7);
    return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  };
  const root = PathUtils.join(PathUtils.profileDir, "owned-media-fixtures-" + Services.uuid.generateUUID());
  await IOUtils.makeDirectory(root);
  const file = PathUtils.join(root, "Ordinary folder image.png");
  const bytes = await png("#d5eee2", "Folder image");
  await IOUtils.write(file, bytes);
  const captureLayoutInfo = { webContentSize: { width: 1200, height: 2000 },
    webContentOffset: { x: 0, y: 400 }, frameRelativeToViewport: { x: 16, y: 24, width: 400, height: 280 } };
  const capture = await store.save({ id: Services.uuid.generateUUID().toString().slice(1, -1),
    url: "https://example.invalid/source/caption", text: "Saved capture caption",
    createdDate: Date.now() - 86400000, captureType: "partialPage", captureLayoutInfo },
    await png("#e4e9ff", "Saved capture"));
  const withoutCaption = await store.save({ id: Services.uuid.generateUUID().toString().slice(1, -1),
    url: "https://example.invalid/source/without-caption", text: null,
    createdDate: Date.now() - 2 * 86400000, captureType: "partialPage", captureLayoutInfo },
    await png("#f6e7b0", "Source URL caption"));
  Services.prefs.setBoolPref("zen.library.media.enabled", false);
  Services.prefs.setStringPref("zen.library.media.folders", root);
  Services.prefs.setBoolPref("zen.library.media.enabled", true);
  const Library = w.customElements.get("zen-library");
  if (Library.getInstance().openProgress < 0.5) Library.toggle("media");
  else Library.getInstance().activeTab = "media";
  check(await until(() => d.querySelector("zen-library-media-section")?.items.length === 3),
    "Media combines two saved captures with the owned folder image");
  const section = d.querySelector("zen-library-media-section");
  if (!section) return { checks, failures, error: "Media did not mount" };
  const cards = () => [...section.querySelectorAll(".zen-library-media-item")];
  const search = async value => {
    const input = section.querySelector(".zen-library-search-box input");
    input.value = value; input.dispatchEvent(new w.Event("input", { bubbles: true }));
    await pause(320); await section.updateComplete;
  };
  check(await until(() => cards().length === 3), "all three Media cards render");
  check(cards().map(card => card.title).join("|") ===
    "Ordinary folder image.png|Saved capture caption|https://example.invalid/source/without-caption",
    "Media is newest-first and preserves caption/source titles");
  check(!section.querySelector(".zen-library-filter-button"), "Media has no Filter button");
  for (const space of w.gZenWorkspaces.getWorkspaces()) {
    await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid); await pause(350);
    check(await until(() => cards().every(card => card.querySelector("img")?.naturalWidth === 400)),
      space.name + ": all Media images load");
    const geometry = cards().map(card => {
      const r = card.getBoundingClientRect(), image = card.querySelector("img"), ir = image?.getBoundingClientRect();
      return { title: card.title, x: r.x, y: r.y, width: r.width, height: r.height,
        image: ir && { x: ir.x, y: ir.y, width: ir.width, height: ir.height } };
    });
    check(geometry.every(r => r.width > 0 && r.height > 0), space.name + ": Media cards stay visible");
    layouts.push({ space: space.name, geometry });
  }
  await search("saved capture");
  check(cards().length === 1 && cards()[0].title === capture.text, "search finds a saved caption");
  await search("without-caption");
  check(cards().length === 1 && cards()[0].title === withoutCaption.url, "search finds a captionless source URL");
  await search("ordinary");
  check(cards().length === 1 && cards()[0].title === "Ordinary folder image.png", "search finds a folder image");
  await search("");
  const showMenu = async card => {
    const r = card.getBoundingClientRect();
    card.dispatchEvent(new w.MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2,
      screenX: w.mozInnerScreenX + r.x + 20, screenY: w.mozInnerScreenY + r.y + 20 }));
    check(await until(() => d.querySelector(".zen-library-download-menu")?.state === "open"), "Media context menu opens");
    const menu = d.querySelector(".zen-library-download-menu");
    const labels = [...(menu?.children || [])].map(node => node.localName === "menuseparator" ? "—" : node.label);
    menus.push({ title: card.title, labels }); menu?.hidePopup(); await until(() => !menu?.isConnected);
    return labels.join("|");
  };
  check(await showMenu(cards()[0]) === "Copy Image|—|Send via iMessage|AirDrop|—|Show in Finder|—|Hide from Zen",
    "folder image has Arc Media action order without Open or Trash");
  check(await showMenu(cards()[1]) === "Copy Image|Copy Source URL|Open Source URL|—|Send via iMessage|AirDrop|—|Delete",
    "saved capture has its separate Media action order");
  Services.prefs.setBoolPref("zen.library.preview.sources.capture", false); await pause(100);
  check(cards().length === 3, "hiding captures from the hover source keeps them in Media");
  const changed = await store.save({ ...capture, text: "Caption changed live" }, await png("#eedad3", "Updated capture"));
  check(await until(() => cards().some(card => card.title === changed.text)), "capture revisions refresh visible Media immediately");
  check(await until(() => cards().find(card => card.title === changed.text)?.querySelector("img")?.naturalWidth === 400),
    "updated capture image loads from its new revision");
  const preview = nativeMediaPreview(w);
  cards().find(card => card.title === changed.text).click();
  check(await until(() => preview.isOpen), "capture card opens the native preview");
  preview.close("downloads"); check(preview.isOpen, "Downloads ownership cannot close Media preview");
  preview.close("media"); check(!preview.isOpen, "Media preview closes cleanly");
  const actions = new ZenLibraryFileMenu(w);
  try {
    const ordinary = section.items.find(item => !item._zenLibraryCapture);
    await actions.execute("hide", mediaFileRecord(ordinary));
    check(await until(() => cards().length === 2), "Hide removes only the folder file from the grid");
    check(await IOUtils.exists(file), "Hide preserves the owned image on disk");
    const selected = section.items.find(item => item._zenLibraryCapture?.id === changed.id);
    const imagePath = selected.target.path;
    await actions.execute("delete-capture", selected);
    check(await until(() => cards().length === 1 && cards()[0].title === withoutCaption.url),
      "Delete updates Media and retains the other capture");
    check(!await IOUtils.exists(imagePath), "Delete removes only the selected capture image");
  } finally { actions.destroy(); }
  const privateWindow = w.OpenBrowserWindow({ private: true });
  try {
    check(await until(() => privateWindow.gBrowserInit?.delayedStartupFinished), "owned private window finishes starting");
    privateWindow.customElements.get("zen-library").toggle("media");
    check(await until(() => privateWindow.document.querySelector("zen-library-media-section")?.loading === false),
      "private Media finishes its folder scan");
    const privateSection = privateWindow.document.querySelector("zen-library-media-section");
    check(privateSection && !privateSection.items.some(item => item._zenLibraryCapture), "private Media excludes public captures");
  } finally { privateWindow.close(); }
  const kept = section.items[0];
  check(await preview.open({ items: [kept], index: 0, presentation: "media" }), "remaining capture can reopen native Media");
  Services.prefs.setBoolPref("zen.library.media.enabled", false);
  check(!preview.isOpen, "turning Media off closes its native preview");
  check(store.items.length === 1, "turning Media off preserves saved captures");
  Services.prefs.setBoolPref("zen.library.media.enabled", true);
  check(await until(() => cards().length === 1), "reenabling Media restores the retained capture");
  Services.prefs.setBoolPref("zen.library.preview.sources.capture", true);
  await w.gZenWorkspaces.changeWorkspaceWithID(w.gZenWorkspaces.getWorkspaces()[0].uuid);
  // Restore a folder image and the captioned capture for direct visual inspection.
  await IOUtils.write(PathUtils.join(root, "Visible folder image.png"), bytes);
  await store.save({ ...capture, text: "Saved capture caption" }, await png("#e4e9ff", "Saved capture"));
  Services.prefs.setBoolPref("zen.library.media.enabled", false);
  Services.prefs.setBoolPref("zen.library.media.enabled", true);
  check(await until(() => cards().length === 3), "visual inspection fixtures are restored");
  return { checks, failures, menus, layouts, productionProfileUsed: false, sharingInvoked: false,
    fixturesRetainedForVisualInspection: true };
})().then(done, error => done({ error: String(error), stack: error.stack }));
