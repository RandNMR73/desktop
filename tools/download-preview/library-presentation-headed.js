const done = arguments[arguments.length - 1];
(async () => {
  if (!PathUtils.profileDir.includes("zen-region-colors-native-")) {
    throw new Error("Owned disposable profile required");
  }
  const fixtureRoot = arguments[0];
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const { ZenDownloadPreview } = ChromeUtils.importESModule("moz-src:///zen/library/ZenDownloadPreview.sys.mjs");
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const until = async predicate => {
    for (let i = 0; i < 400 && !predicate(); i++) await pause(25);
    return !!predicate();
  };
  let checks = 0; const failures = [];
  const check = (value, label) => { checks++; if (!value) failures.push(label); };
  const list = await Downloads.getList(Downloads.PUBLIC);
  const root = PathUtils.join(PathUtils.profileDir, "owned-library");
  await IOUtils.makeDirectory(root);
  const specs = [
    ["REPORT.PDF", "pdf", "PDF", "https://assets.example.invalid/report.pdf", " from assets.example.invalid"],
    ["Chart.PNG", "png", "Image", "https://www.example.invalid/chart.png", " from example.invalid"],
    ["Result.JSON", "json", "Download", "blob:https://example.invalid/owned", ""],
    ["Installer.DMG", "dmg", "Disk Image", "https://downloads.example.invalid/installer.dmg", " from downloads.example.invalid"],
    ["Archive.ZIP", "zip", "Zip Archive", "https://example.invalid/archive.zip", " from example.invalid"],
    ["Music.MP3", "mp3", "Audio", "https://example.invalid/music.mp3", " from example.invalid"],
    ["Movie.MOV", "mov", "Movie", "https://example.invalid/movie.mov", " from example.invalid"],
    ["Bundle.TAR", "tar", "Archive", "https://example.invalid/bundle.tar", " from example.invalid"],
  ];
  const owned = [];
  for (const [name, extension, , url] of specs) {
    const path = PathUtils.join(root, name);
    if (["pdf", "png"].includes(extension)) {
      await IOUtils.copy(PathUtils.join(fixtureRoot, `Preview fixture.${extension}`), path);
    } else await IOUtils.writeUTF8(path, extension === "json" ? JSON.stringify({ owned: true, title: "Document preview fixture" }) : "owned fixture");
    const download = await Downloads.createDownload({ source: { url }, target: path,
      startTime: new Date(Date.now() - owned.length * 86400000) });
    await download.target.refresh();
    download.succeeded = true; download.stopped = true;
    download.endTime = Number(download.startTime);
    download._setBytes(download.target.size, download.target.size, true);
    await list.add(download); owned.push(download);
  }
  const lib = d.querySelector("zen-library");
  lib.constructor.toggle("downloads");
  const section = () => d.querySelector("zen-library-downloads-section");
  check(await until(() => section()?.querySelectorAll(".zen-library-row").length === specs.length), "all owned rows render");
  const rows = () => [...section().querySelectorAll(".zen-library-row")];
  const rowFor = name => rows().find(row => row.querySelector(".zen-library-row-title").textContent === name.toLowerCase());
  check(await until(() => specs.every(([name,,kind,,source]) => rowFor(name)?.querySelector(".zen-library-row-subtitle").textContent.replace(/[\u2066-\u2069]/g, "").trim() === kind + source)), "all native type labels and source domains localize correctly");
  check(await until(() => ["REPORT.PDF", "Result.JSON", "Chart.PNG"].every(name => rowFor(name)?.querySelector("img").src.startsWith("data:image/png;base64,"))), "PDF, JSON and image rows receive real native thumbnails");
  await pause(500);
  const geometry = rows().map(row => {
    const bounds = row.getBoundingClientRect(), icon = row.querySelector(".zen-library-row-icon"), text = row.querySelector(".zen-library-row-title");
    const box = icon.getBoundingClientRect(), title = w.getComputedStyle(text), style = w.getComputedStyle(row);
    return { title: text.textContent, height: bounds.height, iconWidth: box.width, iconHeight: box.height,
      imageWidth: icon.naturalWidth, imageHeight: icon.naturalHeight, titleOffset: text.getBoundingClientRect().x - bounds.x,
      fontSize: title.fontSize, fontWeight: title.fontWeight, paddingLeft: style.paddingLeft,
      gap: style.gap, radius: style.borderRadius, subtitle: row.querySelector(".zen-library-row-subtitle").textContent.trim() };
  });
  check(geometry.every(row => row.height === 56), "all rows use the 56-point reference height");
  check(geometry.every(row => row.iconWidth === 24 && row.iconHeight === 24), "all icons share the 24-point frame");
  check(geometry.every(row => row.fontSize === "14px" && row.fontWeight === "400"), "all titles use regular 14-point text");
  check(geometry.every(row => row.paddingLeft === "12px" && row.gap === "8px" && row.radius === "12px"), "reference side padding, spacing and radius");
  check(geometry.every(row => row.titleOffset === 44), "title starts 44 points after the row edge");
  check(section().querySelector("input").placeholder === "Search Downloads…", "reference search placeholder includes ellipsis");
  const pdf = rowFor("REPORT.PDF");
  const img = pdf.querySelector("img");
  check(img.naturalWidth <= 48 && img.naturalHeight <= 48 && img.naturalWidth > 0, "native thumbnail uses the list size at Retina scale");
  check(!section().querySelector(".zen-library-download-url"), "completed subtitle does not swap to a raw URL");
  owned[0].target.exists = false;
  section().onDownloadChanged(owned[0]);
  check(await until(() => rowFor("REPORT.PDF").querySelector(".zen-library-row-subtitle").textContent.trim() === "File deleted or moved"), "missing file displays the reference status");
  owned[0].target.exists = true;
  section().onDownloadChanged(owned[0]);
  check(await until(() => rowFor("REPORT.PDF").querySelector("img").src.startsWith("data:image/png;base64,")), "restoring a file refreshes its presentation");
  section().searchQuery = "result.json"; section().onSearchChanged();
  check(await until(() => rows().length === 1 && rows()[0].textContent.includes("result.json")), "search retains the matching lowercase filename");
  section().searchQuery = ""; section().onSearchChanged();
  check(await until(() => rows().length === specs.length), "clearing search restores all rows");
  const originalThumbnail = ZenDownloadPreview.prototype.thumbnail;
  const waiting = [], extra = [];
  let started = 0;
  ZenDownloadPreview.prototype.thumbnail = function (download, size) {
    if (size !== 24 || !download.target.path.includes("Queued fixture")) {
      return originalThumbnail.call(this, download, size);
    }
    started++;
    return new Promise(resolve => waiting.push(resolve));
  };
  try {
    for (let i = 0; i < 8; i++) {
      const path = PathUtils.join(root, `Queued fixture ${i}.json`);
      await IOUtils.writeUTF8(path, "{}");
      const download = await Downloads.createDownload({ source: { url: "https://example.invalid/queued" }, target: path });
      await download.target.refresh(); download.succeeded = true; download.stopped = true;
      download.endTime = Date.now();
      await list.add(download); extra.push(download);
    }
    check(await until(() => started === 3), "long list limits active thumbnail work to three");
    lib.constructor.toggle();
    check(await until(() => !lib.hasAttribute("open")), "Library closes normally while thumbnails are pending");
    for (const resolve of waiting) resolve(null);
    await pause(150);
    check(started === 3, "late thumbnail results after close do not restart queued work");
  } finally {
    ZenDownloadPreview.prototype.thumbnail = originalThumbnail;
    for (const download of extra) await list.remove(download);
    for (const resolve of waiting) resolve(null);
    lib.constructor.toggle("downloads");
    await until(() => rows().length === specs.length);
  }
  return { checks, failures, geometry, productionProfileUsed: false,
    exactParityClaimed: false, pending: ["date grouping", "physical hover", "remaining Library chrome"] };
})().then(done, error => done({ error: String(error), stack: error.stack }));
