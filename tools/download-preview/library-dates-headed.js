const done = arguments[arguments.length - 1];
(async () => {
  if (!PathUtils.profileDir.includes("zen-region-colors-native-")) throw new Error("Owned profile required");
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const { ZenDownloadPreview } = ChromeUtils.importESModule("moz-src:///zen/library/ZenDownloadPreview.sys.mjs");
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const until = async predicate => {
    for (let i = 0; i < 300 && !predicate(); i++) await pause(20);
    return !!predicate();
  };
  let checks = 0; const failures = [];
  const check = (value, message) => { checks++; if (!value) failures.push(message); };
  const list = await Downloads.getList(Downloads.PUBLIC);
  const previous = await list.getAll();
  for (const download of previous) await list.remove(download);
  const root = PathUtils.join(PathUtils.profileDir, "owned-dates");
  await IOUtils.makeDirectory(root);
  const now = Date.now();
  const daysAgo = (days, hours = 12) => {
    const date = new Date(now); date.setDate(date.getDate() - days);
    date.setHours(hours, 0, 0, 0); return Number(date);
  };
  const specs = [
    ["A Week Report.json", daysAgo(8)], ["Today Report.json", now],
    ["Two Week Report.json", daysAgo(15)], ["Yesterday Report.json", daysAgo(1)],
    ["Month Report.json", daysAgo(40)], ["B Week Report.json", daysAgo(8, 11)],
    ["Six Day Report.json", daysAgo(6)],
  ];
  const owned = [];
  for (const [name, started] of specs) {
    const path = PathUtils.join(root, name);
    await IOUtils.writeUTF8(path, JSON.stringify({ name, started }));
    const download = await Downloads.createDownload({ source: { url: "https://example.invalid/" + encodeURIComponent(name) }, target: path, startTime: new Date(started) });
    await download.target.refresh();
    download.succeeded = true; download.stopped = true; download.endTime = now;
    download._setBytes(download.target.size, download.target.size, true);
    await list.add(download); owned.push(download);
  }
  const lib = d.querySelector("zen-library");
  if (!lib.hasAttribute("open")) lib.constructor.toggle("downloads");
  const section = () => d.querySelector("zen-library-downloads-section");
  const rows = () => [...section().querySelectorAll(".zen-library-row")];
  const groups = () => [...section().querySelectorAll(".zen-library-group")].map(group => ({
    label: group.querySelector("h3").textContent.trim(),
    names: [...group.querySelectorAll(".zen-library-row-title")].map(title => title.textContent),
  }));
  check(await until(() => section()?.querySelectorAll(".zen-library-row").length === specs.length), "fixture rows render");
  check(await until(() => groups()[0]?.label === "Today" && groups()[1]?.label === "Yesterday"), "localized Today and Yesterday headings");
  const preview = new ZenDownloadPreview(w);
  const expected = new Map();
  for (const [name, date] of [...specs].sort((a, b) => b[1] - a[1])) {
    const label = name.startsWith("Today") ? "Today" : name.startsWith("Yesterday") ? "Yesterday" : preview.date(date, now);
    if (!expected.has(label)) expected.set(label, []);
    expected.get(label).push(name.toLowerCase());
  }
  check(JSON.stringify(groups()) === JSON.stringify([...expected].map(([label, names]) => ({ label, names }))), "native relative headings group by creation time despite identical completion dates and shuffled insertion");
  check(groups().find(group => group.names.includes("a week report.json"))?.names.length === 2, "equal relative labels share one heading");
  await pause(400);
  const geometry = [...section().querySelectorAll(".zen-library-group h3")].map(heading => {
    const style = w.getComputedStyle(heading), box = heading.getBoundingClientRect();
    return { label: heading.textContent.trim(), font: style.fontSize, weight: style.fontWeight,
      padding: style.padding, color: style.color, opacity: style.opacity,
      margin: style.margin, height: box.height, lineHeight: style.lineHeight };
  });
  check(geometry.every(item => item.font === "12px" && item.weight === "600"), "12-point semibold headings");
  check(geometry.every(item => item.padding === "8px 12px 4px" && item.margin === "0px"), "Arc heading insets");
  check(geometry.every(item => ["rgba(0, 0, 0, 0.565)", "rgba(255, 255, 255, 0.592)"].includes(item.color) && item.opacity === "1"), "GrayA11 reference color without double opacity");
  check(rows().every(row => row.getBoundingClientRect().height === 56), "grouping preserves row geometry");
  section().searchQuery = "week"; section().onSearchChanged();
  check(await until(() => rows().length === 3), "search retains matching rows");
  check(groups().length === 2 && groups().every(group => group.names.length), "search has only nonempty matching date groups");
  section().searchQuery = "unmatched owned query"; section().onSearchChanged();
  check(await until(() => rows().length === 0 && groups().length === 0), "empty search removes all headings");
  section().searchQuery = ""; section().onSearchChanged();
  check(await until(() => rows().length === specs.length), "clearing search restores groups");
  const originalStart = owned[0].startTime;
  owned[0].startTime = new Date(now + 1); section().onDownloadChanged(owned[0]);
  check(await until(() => groups()[0]?.names[0] === "a week report.json" && groups()[0]?.names.length === 2), "updated creation date moves the row to its new group");
  owned[0].startTime = originalStart; section().onDownloadChanged(owned[0]);
  check(await until(() => groups()[0]?.names.length === 1), "restoring creation date restores grouping");
  const extra = [];
  for (let i = 0; i < 105; i++) {
    const download = await Downloads.createDownload({ source: { url: `https://example.invalid/page-${i}` }, target: PathUtils.join(root, `pagination-${i}.json`), startTime: new Date(now - i * 1000) });
    download.succeeded = true; download.stopped = true; download.target.exists = false;
    await list.add(download); extra.push(download);
  }
  section().searchQuery = "pagination-"; section().onSearchChanged();
  check(await until(() => rows().length === 100), "first page retains the 100-row bound");
  section().onListScrolledToEnd();
  check(await until(() => rows().length === 105), "next page appends all remaining rows");
  check(groups().length === 1 && groups()[0].label === "Today", "pagination does not duplicate the same heading");
  for (const download of extra) await list.remove(download);
  section().searchQuery = ""; section().onSearchChanged();
  await until(() => rows().length === specs.length);
  const originalSet = w.setTimeout, originalClear = w.clearTimeout;
  const timers = [], cleared = [];
  try {
    w.setTimeout = function (callback, delay, ...args) {
      const id = originalSet.call(this, callback, delay, ...args); timers.push({ id, delay }); return id;
    };
    w.clearTimeout = function (id) { cleared.push(id); return originalClear.call(this, id); };
    section().onLibraryOpening();
    const first = timers.at(-1);
    check(first.delay > 0 && first.delay <= 60000, "next refresh is scheduled at a minute boundary");
    section().onLibraryOpening();
    const second = timers.at(-1);
    check(cleared.includes(first.id), "reopening replaces the date timer");
    section().onLibraryClosing();
    check(cleared.includes(second.id), "closing cancels the date timer");
  } finally {
    w.setTimeout = originalSet; w.clearTimeout = originalClear;
    section().onLibraryOpening(); preview.destroy();
  }
  const spaces = w.gZenWorkspaces.getWorkspaces(), layouts = [];
  check(spaces.length === 5, "all five reference Spaces are present");
  const grouped = JSON.stringify(groups());
  for (const space of spaces) {
    await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid); await pause(250);
    check(lib.getAttribute("zen-space-name") === space.name, space.name + ": Library follows the Space");
    const scheme = w.getComputedStyle(lib).colorScheme;
    const color = scheme === "dark" ? "rgba(255, 255, 255, 0.592)" : "rgba(0, 0, 0, 0.565)";
    const headings = [...section().querySelectorAll(".zen-library-group h3")].map(heading => {
      const style = w.getComputedStyle(heading);
      return { font: style.fontSize, weight: style.fontWeight, padding: style.padding, color: style.color, height: heading.getBoundingClientRect().height };
    });
    check(["light", "dark"].includes(scheme) && headings.every(heading => heading.font === "12px" && heading.weight === "600" && heading.padding === "8px 12px 4px" && heading.color === color), space.name + ": heading metrics and appearance-specific color match");
    check(JSON.stringify(groups()) === grouped && rows().every(row => row.getBoundingClientRect().height === 56), space.name + ": grouping and row height stay consistent");
    layouts.push({ space: space.name, scheme, headings });
  }
  await w.gZenWorkspaces.changeWorkspaceWithID(spaces[0].uuid); await pause(250);
  return { checks, failures, groups: groups(), geometry, layouts, productionProfileUsed: false,
    exactParityClaimed: false, pending: ["physical hover", "remaining Library chrome"] };
})().then(done, error => done({ error: String(error), stack: error.stack }));
