const done = arguments[arguments.length - 1];
(async () => {
  // Owned disposable profile only. No production browser instrumentation.
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const Library = w.customElements.get("zen-library"), library = Library.getInstance();
  let checks = 0; const failures = [], rows = [];
  const check = (ok, title) => { checks++; if (!ok) failures.push(title); };
  const tab = id => library.querySelector(`.zen-library-tab[data-section="${id}"]`);
  const icon = id => tab(id).querySelector(".zen-library-tab-icon-image");
  const style = (node, pseudo) => w.getComputedStyle(node, pseudo);
  const pick = async id => { library.activeTab = id; await library.updateComplete; await pause(25); };
  if (library.openProgress < 0.5) Library.toggle("downloads");
  else await pick("downloads");
  for (let i = 0; i < 120 && !library.hasAttribute("open"); i++) await pause(25);
  await pause(650);
  check(library.hasAttribute("open"), "Library opens in the candidate");
  const spaces = w.gZenWorkspaces.getWorkspaces();
  for (const space of spaces) {
    await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid); await pause(200);
    check(library.getAttribute("zen-space-name") === space.name, space.name + ": Library tracks the active Space");
    check(style(library).getPropertyValue("--zen-library-icon-primary").includes("light-dark"), space.name + ": source palette supplies primary icon color");
    const cells = [...library.querySelectorAll(".zen-library-tab")].map(node => {
      const label = node.querySelector("label"), img = node.querySelector(".zen-library-tab-icon-image");
      const s = style(img), t = style(label), r = node.getBoundingClientRect();
      return { section:node.dataset.section, selected:node.hasAttribute("active"), title:label.textContent,
        color:t.color, opacity:t.opacity, font:t.font, fill:s.fill, stroke:s.stroke,
        image:s.backgroundImage, width:r.width, height:r.height };
    });
    check(cells.every(c => c.font.includes("700 11px")), space.name + ": all labels use 11pt bold");
    check(cells.every(c => c.opacity === (c.selected ? "1" : "0.7")), space.name + ": label selection opacity matches");
    check(cells.find(c => c.section === "history").title === "Archived Tabs", space.name + ": archive label matches");
    check(cells.filter(c => !c.selected).every(c => c.fill === "rgba(0, 0, 0, 0)" && /0\.7\)/.test(c.stroke)), space.name + ": inactive icons retain only a 70% primary outline");
    rows.push({space:space.name, cells});
  }
  await w.gZenWorkspaces.changeWorkspaceWithID(spaces[0].uuid); await pause(200);
  for (const id of ["media","easels","spaces","boosts","history","downloads"]) {
    await pick(id);
    const animation = icon(id).getAnimations()[0], end = id === "boosts" ? 45 : 35;
    check(!!animation, id + ": selecting starts the native segment");
    if (!animation) continue;
    animation.pause(); animation.currentTime = 0;
    check(Math.abs(new w.DOMMatrix(style(icon(id)).transform).e + 28) < 0.01, id + ": starts at frame 1");
    check(Math.abs(animation.effect.getTiming().duration - end / 60 * 1000) < 0.01, id + ": includes the final marker frame at 60fps");
    animation.finish(); await pause(20);
    check(Math.abs(new w.DOMMatrix(style(icon(id)).transform).e + 28 * end) < 0.01, id + ": retains the final pose");
    const same = icon(id).getAnimations()[0]; await pick(id);
    check(icon(id).getAnimations()[0] === same, id + ": selecting the current section does not replay");
  }
  const downloads = tab("downloads"), rect = icon("downloads").getBoundingClientRect();
  InspectorUtils.addPseudoClassLock(downloads, ":hover");
  InspectorUtils.addPseudoClassLock(downloads, ":active"); await pause(450);
  check(style(downloads, "::before").inset === "2px", "pressed highlight uses a 2pt inset");
  check(style(downloads, "::before").borderRadius === "12px", "highlight uses 12pt corners");
  check(icon("downloads").getBoundingClientRect().x === rect.x, "pressing leaves the icon in place");
  InspectorUtils.removePseudoClassLock(downloads, ":active");
  InspectorUtils.removePseudoClassLock(downloads, ":hover");
  Library.animateProgress(0); await pause(700);
  check([...library.querySelectorAll(".zen-library-tab-icon-image")].every(n => !n.getAnimations().length), "closing resets all icon animations");
  Services.prefs.setIntPref("ui.prefersReducedMotion", 1); await pause(50);
  Library.toggle("downloads"); await pause(650); await pick("history");
  check(!icon("history").getAnimations().length, "reduced motion skips selection playback");
  Services.prefs.clearUserPref("ui.prefersReducedMotion");
  await pick("downloads"); await pause(700);
  return {checks,failures,rows,productionProfileUsed:false,hoverTest:"owned DOM pseudo-state only; not physical hover"};
})().then(done, error => done({error:String(error),stack:error.stack}));
