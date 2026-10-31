const done = arguments[arguments.length - 1];
(async () => {
  if (!PathUtils.profileDir.includes("zen-region-colors-native-")) throw new Error("Owned profile required");
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const { ContextualIdentityService: profiles } = ChromeUtils.importESModule(
    "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs");
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const until = async predicate => {
    for (let i = 0; i < 200 && !predicate(); i++) await pause(10);
    return !!predicate();
  };
  let checks = 0; const failures = [], samples = [];
  const check = (value, label) => { checks++; if (!value) failures.push(label); };
  const near = (a, b, epsilon = 0.08) => Math.abs(a - b) <= epsilon;
  const lib = d.querySelector("zen-library");
  if (!lib.hasAttribute("open")) lib.constructor.toggle("downloads");
  let s;
  if (!await until(() => (s = d.querySelector("zen-library-downloads-section")))) throw new Error("Downloads did not open");
  await pause(500); await s.updateComplete;
  const top = s.querySelector(".zen-library-search-top");
  const search = s.querySelector(".zen-library-search-mode");
  const filter = s.querySelector(".zen-library-filter-mode");
  const input = s.querySelector("input");
  const results = s.querySelector(".zen-library-search-results");
  const animations = () => [top, search, filter].flatMap(e => e.getAnimations());
  const measure = () => ({height: top.getBoundingClientRect().height,
    search: Number(w.getComputedStyle(search).opacity),
    filter: Number(w.getComputedStyle(filter).opacity),
    resultsY: results.getBoundingClientRect().top - top.getBoundingClientRect().top});
  const finish = async () => { for (const a of animations()) a.finish(); await pause(20); };
  const seek = async time => {
    const list = animations();
    for (const a of list) a.pause();
    await Promise.all(list.map(a => a.ready));
    for (const a of list) a.currentTime = time;
    return measure();
  };
  const toggle = async open => {
    s.querySelector(open ? ".zen-library-filter-button" : ".zen-library-filter-done").click();
    await s.updateComplete;
    const list = animations();
    for (const a of list) a.pause();
    await Promise.all(list.map(a => a.ready));
    return list;
  };
  // The coefficient is the native timingCurve(.25,.1,.25,1) at 100/300ms.
  const p = 0.5758623176;
  const beforePref = Services.prefs.prefHasUserValue("ui.prefersReducedMotion")
    ? Services.prefs.getIntPref("ui.prefersReducedMotion") : null;
  const owned = profiles.create("Owned transition profile with a deliberately wrapping name", "briefcase", "blue");
  const spaces = w.gZenWorkspaces.getWorkspaces();
  try {
    Services.prefs.setIntPref("ui.prefersReducedMotion", 0); await pause(50);
    s.filtersOpen = false; s.activeFilters.clear(); s.requestUpdate(); await s.updateComplete; await finish();
    input.value = "report"; input.dispatchEvent(new w.Event("input", {bubbles:true})); await pause(300);
    for (const space of spaces) {
      await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid); await pause(100);
      s.activeFilters.add("profile:0"); s.activeFilters.add(`profile:${owned.userContextId}`);
      s.requestUpdate(); await s.updateComplete;
      await d.l10n.translateFragment(s); await pause(20);
      const initial = measure(), selectedCount = s.querySelectorAll(".zen-library-selected-filter").length;
      const opening = await toggle(true), open = await seek(100);
      const destination = filter.getBoundingClientRect().height + 20;
      check(opening.length === 3 && opening.every(a => a.effect.getTiming().duration === 300 &&
        a.effect.getTiming().easing === "cubic-bezier(0.25, 0.1, 0.25, 1)"), space.name + ": native duration and curve");
      check(near(open.height, initial.height + (destination-initial.height)*p), space.name + ": opening interpolates full height");
      check(near(open.resultsY, open.height), space.name + ": results follow animated height");
      check(near(open.search, 1-p, 0.00001) && near(open.filter, p, 0.00001), space.name + ": both complete branches crossfade");
      check(w.getComputedStyle(filter).zIndex === "1" && w.getComputedStyle(search).zIndex === "0",
        space.name + ": incoming filter paints above outgoing search");
      check([search, filter].every(e => near(e.getBoundingClientRect().top-top.getBoundingClientRect().top, 10)), space.name + ": branch tops remain fixed");
      check([".zen-library-search-header", ".zen-library-filter-header", ".zen-library-filter-panel-inner"]
        .every(selector => w.getComputedStyle(s.querySelector(selector)).opacity === "1"), space.name + ": no nested opacity jump");
      check(s.querySelectorAll(".zen-library-selected-filter").length === selectedCount && search.inert && !filter.inert &&
        search.getAttribute("aria-hidden") === "true" && filter.getAttribute("aria-hidden") === "false",
        space.name + ": outgoing chips retained but inaccessible");
      await finish();
      const opened = measure();
      check(near(opened.height, destination) && animations().length === 0, space.name + ": opening releases animation state");
      await toggle(false); const close = await seek(100);
      check(near(close.height, destination + (initial.height-destination)*p) && near(close.resultsY, close.height), space.name + ": closing moves results continuously");
      check(near(close.search,p,0.00001) && near(close.filter,1-p,0.00001), space.name + ": closing crossfade");
      check(w.getComputedStyle(search).zIndex === "1" && w.getComputedStyle(filter).zIndex === "0",
        space.name + ": incoming search paints above outgoing filter");
      check(!search.inert && filter.inert && search.getAttribute("aria-hidden") === "false" &&
        filter.getAttribute("aria-hidden") === "true", space.name + ": hidden filter branch inaccessible");
      await finish();
      check(input.value === "report" && s.searchQuery === "report" && near(measure().height, initial.height), space.name + ": query and wrapped selected chips retained");
      samples.push({space:space.name, initial, open, opened, close});
    }
    await toggle(true); const interrupted = await seek(90);
    await toggle(false); const reversed = await seek(0);
    samples.push({interrupted,reversed});
    check(near(interrupted.height,reversed.height) && near(interrupted.search,reversed.search,0.00001) &&
      near(interrupted.filter,reversed.filter,0.00001), "rapid reversal starts at the presented state");
    await seek(70); const closing = measure();
    await toggle(true); const reopened = await seek(0);
    samples.push({closing,reopened});
    check(near(closing.height,reopened.height) && near(closing.search,reopened.search,0.00001), "second reversal has no endpoint jump");
    const selectedBefore = [...s.querySelectorAll(".zen-library-selected-filter")].map(e => e.dataset.filterOption);
    s.querySelector('.zen-library-filter-chip[data-filter-option="0"]').click(); await s.updateComplete;
    check(JSON.stringify([...s.querySelectorAll(".zen-library-selected-filter")].map(e => e.dataset.filterOption)) === JSON.stringify(selectedBefore), "outgoing selected chips stay unchanged during the fade");
    await finish(); await toggle(false); await finish();
    check(!s.querySelector('.zen-library-selected-filter[data-filter-option="0"]'), "Done renders the new selection");
    await toggle(true); await seek(100);
    Services.prefs.setIntPref("ui.prefersReducedMotion", 1);
    check(await until(() => animations().length === 0), "reduced motion cancels a running transition");
    check(near(measure().height,filter.getBoundingClientRect().height+20), "reduced motion settles natural layout");
    await toggle(false); check(animations().length === 0, "reduced motion starts no transition");
    Services.prefs.setIntPref("ui.prefersReducedMotion", 0); await pause(50);
    await toggle(true); await seek(100);
    lib.constructor.toggle("downloads");
    check(await until(() => !s.filtersOpen && animations().length === 0), "closing Library cancels and resets filter mode");
    await pause(400); lib.constructor.toggle("downloads"); await pause(500);
    check(!s.filtersOpen && !search.inert && animations().length === 0, "reopening starts in search mode");
    await toggle(true); await seek(100);
    lib.querySelector('.zen-library-tab[data-section="history"]').click(); await pause(350);
    check(s.hidden && !s.filtersOpen && animations().length === 0, "switching sections cancels and resets filter mode");
    lib.querySelector('.zen-library-tab[data-section="downloads"]').click(); await pause(350);
    check(!s.hidden && !s.filtersOpen, "returning to Downloads shows search mode");
    await toggle(true); await seek(100);
    // Profile changes can reflow the active branch during the transaction.
    profiles.update(owned.userContextId, "Short", "briefcase", "blue");
    await pause(100);
    check(animations().length === 0 && near(measure().height,filter.getBoundingClientRect().height+20), "changed profile geometry releases the obsolete animated height");
    await toggle(false); await finish();
    input.focus(); check(d.activeElement === input, "search remains keyboard focusable");
  } finally {
    s.filtersOpen = false; s.activeFilters.clear(); s.searchQuery = ""; input.value = "";
    s.requestUpdate(); await s.updateComplete; await finish();
    profiles.remove(owned.userContextId);
    if (beforePref === null) Services.prefs.clearUserPref("ui.prefersReducedMotion");
    else Services.prefs.setIntPref("ui.prefersReducedMotion", beforePref);
    await w.gZenWorkspaces.changeWorkspaceWithID(spaces[0].uuid);
  }
  return {checks, failures, samples, productionProfileUsed:false,
    scope:"Native timing and owned reconstruction layout; not production Arc frame capture or full parity."};
})().then(done, error => done({error:String(error),stack:error.stack}));
