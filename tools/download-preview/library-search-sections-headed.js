const done = arguments[arguments.length - 1];
(async () => {
  if (!PathUtils.profileDir.includes("zen-region-colors-native-")) throw new Error("Owned profile required");
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const until = async predicate => {
    for (let i = 0; i < 200 && !predicate(); i++) await pause(10);
    return !!predicate();
  };
  let checks = 0; const failures = [];
  const check = (value, label) => { checks++; if (!value) failures.push(label); };
  const lib = d.querySelector("zen-library");
  if (!lib.hasAttribute("open")) lib.constructor.toggle("downloads");
  await pause(500);
  for (const id of ["history", "media", "boosts"]) {
    lib.querySelector(`.zen-library-tab[data-section="${id}"]`).click();
    let section;
    if (!await until(() => (section = lib.querySelector(`zen-library-${id}-section[showing]`)))) throw new Error(id + " did not mount");
    await section.updateComplete; await pause(350);
    const top = section.querySelector(".zen-library-search-top");
    const search = section.querySelector(".zen-library-search-mode");
    if (id === "media") {
      check(section.hasAttribute("needs-opt-in") && w.getComputedStyle(top).display === "none",
        "media: existing opt-in state keeps search hidden");
      // Enable only this disposable profile, with no source folders to scan.
      Services.prefs.setStringPref("zen.library.media.folders", "");
      Services.prefs.setBoolPref("zen.library.media.enabled", true);
      await until(() => !section.hasAttribute("needs-opt-in"));
      await section.updateComplete;
    }
    check(!section.animateFilterChanges && w.getComputedStyle(top).display === "grid", id + ": existing grid layout retained");
    check(w.getComputedStyle(search).display === "contents", id + ": wrapper does not add a layout box");
    const input = section.querySelector("input"); input.focus();
    check(d.activeElement === input && search.getAttribute("aria-hidden") === "false", id + ": search stays focusable and accessible");
    if (section.filterGroups.length) {
      section.querySelector(".zen-library-filter-button").click(); await section.updateComplete;
      await Promise.all(top.getAnimations({subtree:true}).map(a => a.finished.catch(() => {})));
      await pause(350);
      const results = section.querySelector(".zen-library-search-results");
      const amount = parseFloat(section.style.getPropertyValue("--zen-library-filter-height"));
      check(w.getComputedStyle(section.querySelector(".zen-library-search-header")).opacity === "0" &&
        w.getComputedStyle(section.querySelector(".zen-library-filter-header")).opacity === "1", id + ": existing header fade retained");
      check(Math.abs(new w.DOMMatrixReadOnly(w.getComputedStyle(results).transform).m42 - amount) < .1,
        id + ": existing results translation retained");
      check(search.getAttribute("aria-hidden") === "true" && section.querySelector(".zen-library-filter-mode").getAttribute("aria-hidden") === "false",
        id + ": only the active filter branch is accessible");
      section.querySelector(".zen-library-filter-done").click(); await section.updateComplete; await pause(350);
      check(!section.filtersOpen && w.getComputedStyle(results).transform === "none", id + ": Done restores original layout");
    } else {
      check(!section.querySelector(".zen-library-filter-button"), id + ": no new filter control introduced");
    }
    if (id === "media") {
      Services.prefs.setBoolPref("zen.library.media.enabled", false);
      Services.prefs.clearUserPref("zen.library.media.folders");
    }
  }
  lib.querySelector('.zen-library-tab[data-section="downloads"]').click(); await pause(350);
  return {checks, failures, productionProfileUsed:false};
})().then(done, error => done({error:String(error),stack:error.stack}));
