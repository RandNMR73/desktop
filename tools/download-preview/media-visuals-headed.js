const videoFixture = arguments[0];
const done = arguments[arguments.length - 1];
(async () => {
  // Run only in the owned disposable browser profile; all data is synthetic.
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const { libraryCaptures } = ChromeUtils.importESModule("moz-src:///zen/library/ZenLibraryCaptures.sys.mjs");
  const store = libraryCaptures(); await store.ready; await store.clear();
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const until = async predicate => {
    for (let i = 0; i < 120 && !predicate(); i++) await pause(25);
    return !!predicate();
  };
  let checks = 0; const failures = [], layouts = [];
  const check = (value, label) => { checks++; if (!value) failures.push(label); };
  const png = async (width, height, color, title) => {
    const canvas = new w.OffscreenCanvas(width, height), ctx = canvas.getContext("2d");
    ctx.fillStyle = color; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#203240"; ctx.font = "bold 24px sans-serif";
    ctx.fillText(title, 16, 45);
    for (let i = 0; i < 5; i++) ctx.fillRect(16, 75 + i * 24, width - 32 - i * 12, 6);
    return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  };
  const root = PathUtils.join(PathUtils.profileDir, "owned-media-visuals-" + Services.uuid.generateUUID());
  await IOUtils.makeDirectory(root);
  await IOUtils.write(PathUtils.join(root, "Landscape.png"), await png(400, 280, "#d5eee2", "Landscape"));
  await IOUtils.write(PathUtils.join(root, "Portrait.png"), await png(220, 440, "#f6e7b0", "Portrait"));
  await IOUtils.copy(videoFixture, PathUtils.join(root, "Video.mp4"));
  for (const [name, width, height, color] of [
    ["Saved landscape", 400, 280, "#e4e9ff"], ["Saved portrait", 220, 440, "#eedad3"],
  ]) {
    await store.save({ id: Services.uuid.generateUUID().toString().slice(1, -1),
      url: "https://example.invalid/capture", text: name, createdDate: Date.now() - 86400000,
      captureType: "partialPage", captureLayoutInfo: { webContentSize: { width: 1200, height: 2000 },
        webContentOffset: { x: 0, y: 0 }, frameRelativeToViewport: { x: 0, y: 0, width, height } } },
      await png(width, height, color, name));
  }
  Services.prefs.setBoolPref("zen.library.media.enabled", false);
  Services.prefs.setStringPref("zen.library.media.folders", root);
  Services.prefs.setBoolPref("zen.library.media.enabled", true);
  const Library = w.customElements.get("zen-library");
  if (Library.getInstance().openProgress < 0.5) Library.toggle("media");
  else Library.getInstance().activeTab = "media";
  check(await until(() => d.querySelector("zen-library-media-section")?.items.length === 5), "five synthetic media items mount");
  const section = d.querySelector("zen-library-media-section");
  const cards = () => [...section.querySelectorAll(".zen-library-media-item")];
  check(await until(() => cards().length === 5 && cards().every(card => {
    const media = card.querySelector(".zen-library-media-thumb");
    return media?.localName === "video" ? media.videoWidth === 640 : media?.naturalWidth > 0;
  })), "landscape, portrait, video, and capture thumbnails load");
  const rect = element => {
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  };
  const spaces = w.gZenWorkspaces.getWorkspaces();
  for (const space of spaces) {
    await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid); await pause(350);
    const rows = cards().map(card => {
      const media = card.querySelector(".zen-library-media-thumb"), picture = media.parentElement;
      const border = picture.querySelector("rect"), play = card.querySelector(".zen-library-media-play");
      return { title: card.title, kind: picture.dataset.kind, card: rect(card), picture: rect(picture),
        image: rect(media), naturalWidth: media.videoWidth || media.naturalWidth,
        naturalHeight: media.videoHeight || media.naturalHeight,
        border: border && { width: border.getBBox().width, height: border.getBBox().height },
        play: play && { ...rect(play), loaded: play.naturalWidth > 0, background: w.getComputedStyle(play).backgroundColor } };
    });
    const bounds = rect(section.querySelector(".zen-library-search-results"));
    check(rows.every(r => r.card.x >= bounds.x && r.card.right <= bounds.right + 0.1), space.name + ": both columns fit without horizontal clipping");
    check(rows.every(r => r.picture.x >= r.card.x && r.picture.y >= r.card.y &&
      r.picture.right <= r.card.right && r.picture.bottom <= r.card.bottom), space.name + ": all aspect ratios stay within their cards");
    check(rows.every(r => Math.abs(r.image.width / r.image.height - r.naturalWidth / r.naturalHeight) < 0.01),
      space.name + ": portrait and landscape thumbnails preserve their aspect ratios");
    check(rows.filter(r => r.kind === "capture").every(r => r.border && r.border.width > 0 &&
      Math.abs(r.border.width - (r.picture.width - 2)) < 0.1 && Math.abs(r.border.height - (r.picture.height - 2)) < 0.1),
      space.name + ": capture border follows the rendered image instead of the square cell");
    check(rows.find(r => r.kind === "video")?.play?.loaded, space.name + ": native play symbol is packaged and rendered");
    layouts.push({ space: space.name, bounds, rows });
  }
  await w.gZenWorkspaces.changeWorkspaceWithID(spaces[0].uuid); await pause(350);
  const hovered = cards()[0], before = rect(hovered.querySelector(".zen-library-media-thumb"));
  InspectorUtils.addPseudoClassLock(hovered, ":hover"); await pause(350);
  const after = rect(hovered.querySelector(".zen-library-media-thumb"));
  check(before.width === after.width && before.height === after.height && before.x === after.x && before.y === after.y,
    "highlighting a card does not scale or shift its image");
  InspectorUtils.removePseudoClassLock(hovered, ":hover");
  return { checks, failures, layouts };
})().then(done, error => done({ error: String(error), stack: error.stack }));
