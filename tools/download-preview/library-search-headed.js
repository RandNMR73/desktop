const done = arguments[arguments.length - 1];
(async () => {
  if (!PathUtils.profileDir.includes("zen-region-colors-native-")) throw new Error("Owned profile required");
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const { ContextualIdentityService: profiles } = ChromeUtils.importESModule(
    "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs");
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const until = async predicate => {
    for (let i = 0; i < 200 && !predicate(); i++) await pause(20);
    return !!predicate();
  };
  let checks = 0; const failures = [], layouts = [];
  const check = (value, label) => { checks++; if (!value) failures.push(label); };
  for (const profile of profiles.getPublicIdentities()) {
    if (["Owned Work", "Owned Personal", "Renamed Work"].includes(profile.name)) profiles.remove(profile.userContextId);
  }
  const work = profiles.create("Owned Work", "briefcase", "blue");
  const personal = profiles.create("Owned Personal", "fingerprint", "red");
  const list = await Downloads.getList(Downloads.PUBLIC);
  for (const download of await list.getAll()) await list.remove(download);
  const root = PathUtils.join(PathUtils.profileDir, "owned-search");
  await IOUtils.makeDirectory(root);
  const specs = [["Default report.txt", 0], ["Work report.txt", work.userContextId],
    ["Work photo.png", work.userContextId], ["Personal report.txt", personal.userContextId],
    ["Legacy report.txt", undefined]];
  for (const [name, userContextId] of specs) {
    const path = PathUtils.join(root, name);
    await IOUtils.writeUTF8(path, name);
    let download = await Downloads.createDownload({
      source: { url: "https://example.invalid/" + encodeURIComponent(name),
        ...(userContextId === undefined ? {} : { userContextId }) },
      target: path, startTime: new Date(),
    });
    download.succeeded = true; download.stopped = true; download.endTime = Date.now();
    await download.target.refresh();
    download._setBytes(download.target.size, download.target.size, true);
    // Exercise the same serialization boundary used by the persisted history.
    download = await Downloads.createDownload(JSON.parse(JSON.stringify(download.toSerializable())));
    check(Number(download.source.userContextId ?? 0) === Number(userContextId ?? 0), name + ": profile survives serialization");
    await list.add(download);
  }
  const lib = d.querySelector("zen-library");
  if (!lib.hasAttribute("open")) lib.constructor.toggle("downloads");
  let s;
  if (!await until(() => (s = d.querySelector("zen-library-downloads-section")))) throw new Error("Downloads section did not open");
  const rows = () => [...s.querySelectorAll(".zen-library-row-title")].map(e => e.textContent);
  const input = () => s.querySelector("input");
  const chip = id => s.querySelector(`.zen-library-filter-chip[data-filter-option="${id}"]`);
  const selected = id => s.querySelector(`.zen-library-selected-filter[data-filter-option="${id}"]`);
  const search = async query => {
    input().value = query; input().dispatchEvent(new w.Event("input", { bubbles: true }));
    await pause(300); await s.updateComplete;
  };
  const openFilters = async () => {
    s.querySelector(".zen-library-filter-button").click(); await s.updateComplete; await pause(350);
  };
  const closeFilters = async () => {
    s.querySelector(".zen-library-filter-done").click(); await s.updateComplete; await pause(350);
  };
  check(await until(() => rows().length === specs.length), "all downloads initially visible");
  check(await until(() => input().placeholder === "Search Downloads…"), "unfiltered search placeholder");
  check(s.filterGroups.length === 1 && s.filterGroups[0].id === "profile", "only Profiles filter group");
  const expectedIds = ["0", ...profiles.getPublicIdentities().map(p => String(p.userContextId))];
  check(JSON.stringify(s.filterGroups[0].options.map(p => p.id)) === JSON.stringify(expectedIds), "all public Zen profiles, including Default, retain service order");
  check(!s.filterGroups[0].options.some(p => profiles.getPrivateUserContextIds().includes(Number(p.id))), "internal private identities are excluded");
  await openFilters();
  check(input().closest(".zen-library-search-header").inert, "search is inert in filter mode");
  check(s.querySelector(".zen-library-filter-group h3").textContent === "Profiles", "localized Profiles heading");
  chip(work.userContextId).click(); await s.updateComplete;
  check(await until(() => rows().length === 2 && rows().every(n => n.startsWith("work"))), "Work selection filters by source profile");
  check(chip(work.userContextId).getAttribute("aria-pressed") === "true", "selection exposed to accessibility");
  chip(personal.userContextId).click(); await s.updateComplete;
  check(await until(() => rows().length === 3), "multiple profiles form a union");
  await closeFilters();
  check(s.querySelectorAll(".zen-library-selected-filter").length === 2, "selected profiles appear as removable chips");
  check(await until(() => input().placeholder === "Search…"), "filtered search placeholder");
  await search("photo");
  check(rows().length === 1 && rows()[0] === "work photo.png", "search intersects selected profiles");
  await openFilters(); await closeFilters();
  check(input().value === "photo" && rows().length === 1, "filter mode preserves query and results");
  selected(work.userContextId).click(); await s.updateComplete;
  check(await until(() => rows().length === 0), "removing one profile keeps the remaining filter");
  selected(personal.userContextId).click(); await s.updateComplete;
  check(await until(() => rows().length === 1 && input().placeholder === "Search Downloads…"), "removing last chip restores unfiltered query results and placeholder");
  await search(""); await openFilters(); chip(0).click(); await s.updateComplete;
  check(await until(() => rows().length === 2 && rows().includes("legacy report.txt")), "Default includes legacy downloads without profile metadata");
  await closeFilters();
  check(selected(0)?.textContent.trim() === "Default", "Default chip localized");
  selected(0).click(); await s.updateComplete;
  await openFilters(); chip(work.userContextId).click(); await closeFilters();
  profiles.update(work.userContextId, "Renamed Work", "briefcase", "blue");
  check(await until(() => selected(work.userContextId)?.textContent.trim() === "Renamed Work"), "renaming a profile updates the selected chip immediately");
  check(rows().length === 2, "rename preserves profile selection and matching downloads");
  profiles.remove(work.userContextId);
  check(await until(() => !selected(work.userContextId) && rows().length === specs.length), "deleting selected profile clears its filter without deleting history");
  await openFilters();
  check(!chip(work.userContextId), "deleted profile removed from options");
  chip(personal.userContextId).click(); await closeFilters();
  const spaces = w.gZenWorkspaces.getWorkspaces();
  check(spaces.length === 5, "five reference Spaces");
  for (const space of spaces) {
    await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid); await pause(250);
    const css = element => w.getComputedStyle(element);
    const top = s.querySelector(".zen-library-search-top"), box = s.querySelector(".zen-library-search-box");
    const button = s.querySelector(".zen-library-filter-button"), selection = selected(personal.userContextId);
    const scheme = css(lib).colorScheme;
    const color = scheme === "dark" ? "rgba(255, 255, 255, 0.592)" : "rgba(0, 0, 0, 0.565)";
    check(css(top).padding === "10px 8px" && css(top).rowGap === "6px", space.name + ": header insets and vertical gap");
    check(css(s.querySelector(".zen-library-search-header")).gap === "3px", space.name + ": search/filter gap");
    check([box, button].every(e => e.getBoundingClientRect().height === 36 && css(e).paddingLeft === "10px"), space.name + ": control height and insets");
    check(css(box).gap === "10px" && css(button).gap === "4px", space.name + ": icon-to-label spacing");
    check([input(), button].every(e => css(e).fontSize === "14px" && css(e).fontWeight === "500"), space.name + ": 14pt medium search and Filter");
    check([box, button].every(e => e.querySelector("img").getBoundingClientRect().width === 15), space.name + ": 15pt symbols");
    check(css(top).color === color && css(button).color === color, space.name + ": GrayA11 foreground");
    check(css(selection).fontSize === "13px" && css(selection).fontWeight === "500" && css(selection).padding === "8px" && css(selection).gap === "4px", space.name + ": selected chip typography and padding");
    check(selection.querySelector("img").getBoundingClientRect().width === 14, space.name + ": 14pt removal symbol");
    check(selection.getBoundingClientRect().bottom <= s.querySelector(".zen-library-search-results").getBoundingClientRect().top, space.name + ": selected chips do not overlap results");
    await openFilters();
    check(s.querySelector(".zen-library-filter-panel").getBoundingClientRect().bottom <= s.querySelector(".zen-library-search-results").getBoundingClientRect().top, space.name + ": filter options do not overlap results");
    layouts.push({ space: space.name, scheme, color, background: css(box).backgroundColor,
      filterHeight: s.querySelector(".zen-library-filter-panel").getBoundingClientRect().height,
      selectedColor: css(chip(personal.userContextId)).color });
    await closeFilters();
  }
  selected(personal.userContextId).click(); await s.updateComplete;
  profiles.remove(personal.userContextId);
  await w.gZenWorkspaces.changeWorkspaceWithID(spaces[0].uuid);
  return { checks, failures, layouts, productionProfileUsed: false,
    exactParityClaimed: false, pending: ["physical hover", "filter animation timing", "remaining Library chrome"] };
})().then(done, error => done({ error: String(error), stack: error.stack }));
