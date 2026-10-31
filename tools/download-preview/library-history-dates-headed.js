const done = arguments[arguments.length - 1];
const phase = arguments[0] || "create";
(async () => {
  if (!PathUtils.profileDir.includes("zen-region-colors-native-")) throw new Error("Owned disposable profile required");
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const { DownloadHistory } = ChromeUtils.importESModule("resource://gre/modules/DownloadHistory.sys.mjs");
  const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const { ZenDownloadPreview, downloadCreatedDate, ZenDownloadCreationDates } = ChromeUtils.importESModule("moz-src:///zen/library/ZenDownloadPreview.sys.mjs");
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const until = async predicate => {
    for (let i = 0; i < 150; i++) { if (await predicate()) return true; await pause(20); }
    return false;
  };
  let checks = 0; const failures = [];
  const check = (value, label) => { checks++; if (!value) failures.push(label); };
  const list = await Downloads.getList(Downloads.PUBLIC);
  const history = await DownloadHistory.getList({ type: Downloads.PUBLIC });
  const folder = PathUtils.join(PathUtils.profileDir, "owned-history-dates");
  const manifest = PathUtils.join(folder, "fixtures.json");
  let fixtures;
  if (phase === "create") {
    await IOUtils.makeDirectory(folder);
    const now = Date.now();
    const daysAgo = days => { const date = new Date(now); date.setDate(date.getDate() - days); date.setHours(12, 0, 0, 0); return Number(date); };
    fixtures = [
      { label: "week", start: daysAgo(8) },
      { label: "today", start: now - 600000 },
      { label: "yesterday", start: daysAgo(1), redirected: true },
    ].map(f => ({ ...f, name: `Owned History Date ${f.label}.txt`,
      path: PathUtils.join(folder, `Owned History Date ${f.label}.txt`),
      url: `https://example.invalid/owned-history-date/${f.label}`, end: now }));
    for (const f of fixtures) {
      await IOUtils.writeUTF8(f.path, "owned history fixture");
      const source = f.redirected ? { url: `https://cdn.example.invalid/owned-history-date/${f.label}`, originalUrl: f.url } : { url: f.url };
      const item = await Downloads.createDownload({ source, target: f.path, startTime: new Date(f.start) });
      item.succeeded = true; item.stopped = true; item.endTime = f.end;
      await item.target.refresh(); item._setBytes(item.target.size, item.target.size, true);
      await list.add(item); await DownloadHistory.addDownloadToHistory(item); await DownloadHistory.updateMetaData(item);
      await list.remove(item);
      // A later ordinary visit must not become the download's creation time.
      await PlacesUtils.history.insert({ url: f.url, visits: [{ date: new Date(now), transition: PlacesUtils.history.TRANSITIONS.LINK }] });
    }
    await IOUtils.remove(fixtures[2].path);
    await IOUtils.writeJSON(manifest, fixtures);
  } else {
    fixtures = await IOUtils.readJSON(manifest);
  }
  const historyFor = async f => (await history.getAll()).find(item => item.source.url === f.url);
  const dates = new ZenDownloadCreationDates(() => {});
  check(await until(async () => !dates.update(await history.getAll())), "batched download creation dates resolve");
  const observations = [];
  for (const f of fixtures) {
    check(await until(async () => (await historyFor(f))?.placesNode), f.label + ": real history-backed record exists");
    const item = await historyFor(f);
    observations.push({ label: f.label, startTime: item.startTime ?? null, endTime: item.endTime, placesTime: item.placesNode?.time });
    check(item.startTime == null, f.label + ": record has no live startTime");
    const visits = (await PlacesUtils.history.fetch(f.url, { includeVisits: true })).visits;
    check(visits.some(visit => visit.transition === PlacesUtils.history.TRANSITIONS.DOWNLOAD && Number(visit.date) === f.start), f.label + ": download visit retains creation time despite later page visit");
    check(downloadCreatedDate(item, dates) === f.start, f.label + ": Library adapter preserves creation time");
  }
  dates.destroy();
  const sessionStart = fixtures.find(f => f.label === "yesterday").start - 86400000;
  const session = await Downloads.createDownload({ source: { url: "https://example.invalid/owned-history-date/session" },
    target: PathUtils.join(folder, "Owned History Date Session.txt"), startTime: new Date(sessionStart) });
  await IOUtils.writeUTF8(session.target.path, "owned live session");
  session.succeeded = true; session.stopped = true; session.endTime = Date.now(); await session.target.refresh();
  await list.add(session);
  const preview = new ZenDownloadPreview(w);
  try {
    const lib = d.querySelector("zen-library");
    if (!lib.hasAttribute("open")) lib.constructor.toggle("downloads");
    let section;
    if (!await until(() => (section = d.querySelector("zen-library-downloads-section")))) throw new Error("Downloads did not open");
    section.searchQuery = "owned history date"; section.onSearchChanged();
    const rows = () => [...section.querySelectorAll(".zen-library-row")];
    const names = () => rows().map(row => row.querySelector(".zen-library-row-title").textContent);
    const groups = () => [...section.querySelectorAll(".zen-library-group")].map(group => ({ label: group.querySelector("h3").textContent.trim(),
      names: [...group.querySelectorAll(".zen-library-row-title")].map(title => title.textContent) }));
    check(await until(() => rows().length === 4), "history and live session rows render together");
    const all = [...fixtures, { name: "Owned History Date Session.txt", start: sessionStart }].sort((a, b) => b.start - a.start);
    check(JSON.stringify(names()) === JSON.stringify(all.map(f => f.name.toLowerCase())), "history and live rows sort together by creation time");
    const expected = preview.groups(all.map(f => ({ startTime: new Date(f.start), name: f.name })));
    const expectedGroups = expected.map(group => ({ label: group.l10nId === "library-downloads-today" ? "Today" : group.l10nId === "library-downloads-yesterday" ? "Yesterday" : group.label,
      names: group.downloads.map(item => item.name.toLowerCase()) }));
    check(await until(() => JSON.stringify(groups()) === JSON.stringify(expectedGroups)), "history rows retain their native date headings instead of the distant-past group");
    check(rows().every(row => row.getBoundingClientRect().height === 56), "history rows preserve the measured 56pt height");
    check(await until(() => rows().find(row => row.querySelector(".zen-library-row-title").textContent.includes("yesterday"))?.hasAttribute("missing")), "missing history file retains its date group and missing-file state");
    section.searchQuery = "owned history date week"; section.onSearchChanged();
    check(await until(() => rows().length === 1), "search isolates the old history entry");
    check(groups()[0]?.label === expectedGroups.at(-1).label, "filtered history keeps its creation-date heading");
    section.searchQuery = "owned history date"; section.onSearchChanged();
    check(await until(() => JSON.stringify(names()) === JSON.stringify(all.map(f => f.name.toLowerCase()))), "clearing search restores mixed chronological order");
    check((await history.getAll()).filter(item => fixtures.some(f => item.source.url === f.url)).every(item => item.startTime == null), "presentation does not mutate history records");
    return { phase, checks, failures, observations, groups: groups(), productionProfileUsed: false };
  } finally {
    preview.destroy(); await list.remove(session);
  }
})().then(done, error => done({ error: String(error), stack: error.stack }));
