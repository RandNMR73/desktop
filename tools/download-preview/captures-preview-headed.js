const done = arguments[arguments.length - 1];
(async () => {
  // Owned disposable profile only: these fixtures never enter a user profile.
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const { libraryCaptures } = ChromeUtils.importESModule("moz-src:///zen/library/ZenLibraryCaptures.sys.mjs");
  const { nativeMediaPreview } = ChromeUtils.importESModule("moz-src:///zen/library/ZenNativeMediaPreview.sys.mjs");
  const store = libraryCaptures(); await store.ready; await store.clear();
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const until = async predicate => {
    for (let i = 0; i < 120 && !predicate(); i++) await pause(25);
    return !!predicate();
  };
  const rows = (win = w) => [...(win.document.getElementById("zen-library-download-list")?.children || [])]
    .filter(row => !row.hidden);
  const title = row => row.querySelector(".zen-library-download-list-title").textContent;
  const enter = () => {
    const button = d.getElementById("zen-library-button"), r = button.getBoundingClientRect();
    button.dispatchEvent(new w.MouseEvent("mouseenter", { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
  };
  const leave = () => d.getElementById("zen-library-button").dispatchEvent(
    new w.MouseEvent("mouseleave", { clientX: 600, clientY: 400 }));
  const prefix = "zen.library.preview.sources.";
  for (const source of ["documents", "desktop", "screenshot", "download"]) Services.prefs.setBoolPref(prefix + source, false);
  Services.prefs.setBoolPref(prefix + "capture", true);
  const canvas = new w.OffscreenCanvas(400, 280), context = canvas.getContext("2d");
  const fixtures = [], windows = [], layouts = [], menus = [];
  for (let i = 0; i < 6; i++) {
    context.fillStyle = ["#e4e9ff", "#efe1f8", "#d5eee2", "#f6e7b0", "#eedad3", "#d9ecf3"][i];
    context.fillRect(0, 0, 400, 280);
    context.fillStyle = "#203240"; context.font = "bold 32px sans-serif"; context.fillText("Capture " + (i + 1), 24, 58);
    for (let row = 0; row < 5; row++) context.fillRect(24, 90 + row * 26, 310 - row * 28, 7);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
    const item = await store.save({ id: Services.uuid.generateUUID().toString().slice(1, -1),
      url: "https://example.invalid/capture-source/" + (i + 1), createdDate: Date.now() - (6 - i) * 86400000,
      text: i === 2 ? null : i === 3 ? "" : "Saved capture " + (i + 1), captureType: "partialPage",
      captureLayoutInfo: { webContentSize: { width: 1200, height: 2000 }, webContentOffset: { x: 0, y: 400 },
        frameRelativeToViewport: { x: 16, y: 24, width: 400, height: 280 } } }, bytes);
    fixtures.push({ item, bytes });
  }
  let checks = 0; const failures = [];
  const check = (value, label) => { checks++; if (!value) failures.push(label); };
  const footprint = node => {
    const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  const footer = d.getElementById("zen-sidebar-foot-buttons");
  const focusEvents = [];
  const onFocusChange = event => focusEvents.push({ type: event.type, time: Date.now(), open: footer.hasAttribute("zen-library-stack-open") });
  w.addEventListener("blur", onFocusChange); w.addEventListener("focus", onFocusChange);
  try {
    check(await until(() => w.gBrowserInit.delayedStartupFinished), "browser startup finishes before geometry checks");
    check(await until(() => rows().length === 4), "four saved captures populate the preview");
    check(rows().map(row => row.download._zenLibraryCapture?.id).join() === fixtures.slice(2).map(f => f.item.id).join(),
      "newest four captures appear oldest-to-newest toward the footer");
    check(title(rows()[0]) === fixtures[2].item.url, "absent caption uses full source URL");
    check(title(rows()[1]) === "", "explicit empty caption remains empty");
    check(!footer.hasAttribute("zen-library-badge"), "saved captures do not masquerade as unread download arrivals");
    for (const space of w.gZenWorkspaces.getWorkspaces()) {
      await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid); enter();
      check(await until(() => footer.hasAttribute("zen-library-stack-open")), space.name + ": hover opens captures");
      await pause(550);
      check(footer.hasAttribute("zen-library-stack-open"), space.name + ": preview remains expanded while measuring");
      const visible = rows(), sidebar = footprint(d.getElementById("navigator-toolbox"));
      check(visible.length === 4, space.name + ": four visible capture rows");
      const geometry = visible.map(row => {
        const badge = footprint(row.querySelector(".zen-library-download-badge"));
        check(!row.querySelector(".zen-library-download-badge").hasAttribute("downloading"),
          space.name + ": completed capture keeps its thumbnail instead of a download arrow");
        const label = footprint(row.querySelector(".zen-library-download-list-title"));
        check(Math.abs(badge.width - 40) < 0.1 && Math.abs(badge.height - 40) < 0.1, space.name + ": 40-point thumbnail");
        check(Math.abs(badge.x - sidebar.x - 8) < 0.1, space.name + ": thumbnail starts at 8 points");
        check(Math.abs(label.x - sidebar.x - 60) < 0.1, space.name + ": title starts at 60 points");
        check(w.getComputedStyle(row.querySelector(".zen-library-download-list-title")).fontSize === "14px",
          space.name + ": 14-point title");
        check(row.querySelector(".zen-library-download-action").hidden, space.name + ": no Finder action on captures");
        return { badge, label, title: title(row) };
      });
      check(geometry.slice(1).every((g, i) => Math.abs(g.badge.y - geometry[i].badge.y - 56) < 0.1), space.name + ": 56-point row pitch");
      layouts.push({ space: space.name, geometry });
      const row = visible.at(-1), r = row.getBoundingClientRect();
      row.dispatchEvent(new w.MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2,
        screenX: w.mozInnerScreenX + r.x + 60, screenY: w.mozInnerScreenY + r.y + 20 }));
      check(await until(() => d.querySelector(".zen-library-download-menu")?.state === "open"), space.name + ": capture menu opens");
      const menu = d.querySelector(".zen-library-download-menu");
      if (menu) {
        const labels = [...menu.children].map(item => item.localName === "menuseparator" ? "—" : item.label);
        check(labels.join("|") === "Copy Image|—|Send via iMessage|AirDrop|—|Open Source URL|Copy Source URL|—|Delete",
          space.name + ": exact capture hover menu labels and order");
        menus.push({ space: space.name, labels }); menu.hidePopup();
        await until(() => !menu.isConnected);
      }
      leave();
    }
    const openWindow = async options => {
      const win = w.OpenBrowserWindow(options); windows.push(win);
      check(await until(() => win.gBrowserInit?.delayedStartupFinished), "owned secondary window is ready");
      return win;
    };
    const second = await openWindow();
    check(await until(() => rows(second).length === 4), "new normal window loads captures");
    const privateWindow = await openWindow({ private: true });
    check(rows(privateWindow).length === 0, "private window excludes public captures");
    Services.prefs.setBoolPref(prefix + "capture", false);
    check(rows().length === 0 && rows(second).length === 0, "source toggle removes captures in both windows immediately");
    check(store.items.length === 6, "source toggle preserves stored captures");
    Services.prefs.setBoolPref(prefix + "capture", true);
    check(await until(() => rows().length === 4 && rows(second).length === 4), "reenabling source restores both windows");
    const previous = fixtures.at(-1), changed = await store.save({ ...previous.item, text: "Caption updated in another window" }, previous.bytes);
    check(await until(() => title(rows().at(-1)) === changed.text && title(rows(second).at(-1)) === changed.text),
      "caption/image revision updates both windows");
    check(rows(privateWindow).length === 0, "capture updates do not enter private window");
    const { ZenLibraryFileMenu } = ChromeUtils.importESModule("moz-src:///zen/library/ZenLibraryFileMenu.sys.mjs");
    const actions = new ZenLibraryFileMenu(w), record = rows().at(-1).download, imagePath = record.target.path;
    try { await actions.execute("delete-capture", record); } finally { actions.destroy(); }
    check(await until(() => rows().length === 4 && rows().every(row => row.download._zenLibraryCapture.id !== changed.id)),
      "Delete backfills the fourth capture");
    check(rows(second).every(row => row.download._zenLibraryCapture.id !== changed.id), "Delete updates the other window");
    check(!await IOUtils.exists(imagePath), "Delete removes the owned image after metadata commits");
    check(store.items.length === 5, "Delete removes only the selected capture");
    const preview = nativeMediaPreview(w), selected = rows().at(-1).download;
    check(await preview.openDownloads(selected, rows().map(row => row.download)), "native preview accepts capture presentation");
    check(preview.isOpen, "capture opens in the owned native preview");
    preview.close();
    check(!preview.isOpen, "capture preview closes cleanly");
  } finally {
    w.removeEventListener("blur", onFocusChange); w.removeEventListener("focus", onFocusChange);
    for (const win of windows) if (!win.closed) win.close();
    await w.gZenWorkspaces.changeWorkspaceWithID(w.gZenWorkspaces.getWorkspaces()[0].uuid);
    leave(); enter(); await pause(550);
  }
  return { checks, failures, layouts, menus, focusEvents, productionProfileUsed: false, sharingInvoked: false,
    fixturesRetainedForVisualInspection: true };
})().then(done, error => done({ error: String(error), stack: error.stack }));
