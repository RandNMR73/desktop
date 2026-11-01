const done = arguments[arguments.length - 1], spaceIndex = Number(arguments[0] || 0);
(async () => {
  const profile = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
  if (!profile.includes("zen-region-colors-native-")) throw Error("Owned disposable profile required");
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const space = w.gZenWorkspaces.getWorkspaces()[spaceIndex];
  await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid);
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const button = d.getElementById("zen-library-button"), b = button.getBoundingClientRect();
  button.dispatchEvent(new w.MouseEvent("mouseenter", { clientX: b.x + 16, clientY: b.y + 16 }));
  await pause(700);
  const rows = [...d.querySelectorAll("#zen-library-download-list > div")].filter(row => !row.hidden);
  const failures = [], samples = [];
  let checks = 0;
  const check = (value, message) => { checks++; if (!value) failures.push(message); };
  const near = (a, b) => Math.abs(a - b) < 0.02;
  check(rows.length === 4, "four fixture rows");
  for (const [index, row] of rows.entries()) {
    const target = row.querySelector(".zen-library-download-hit-target");
    check(!!target, `row ${index}: native hit target exists`);
    if (!target) continue;
    const bounds = target.getBoundingClientRect(), icon = row.querySelector(".zen-library-download-badge").getBoundingClientRect();
    check(near(bounds.width, Math.min(d.getElementById("navigator-toolbox").clientWidth, 1000) - 16), `row ${index}: native width`);
    check(near(bounds.height, 48), `row ${index}: native 48pt highlight height`);
    check(near(icon.x - bounds.x, 4) && near(icon.y - bounds.y, 4), `row ${index}: 4pt padding`);
    check(w.getComputedStyle(target).backgroundColor === "rgba(0, 0, 0, 0)", `row ${index}: no resting fill`);
    check(d.elementFromPoint(bounds.x + 1, bounds.y + 24) === target, `row ${index}: leading padding accepts pointer`);
    check(d.elementFromPoint(bounds.x + .25, bounds.y + .25) === target, `row ${index}: masked corner retains native rectangular content shape`);
    check(!row.contains(d.elementFromPoint(bounds.x + 50, bounds.y - 1)), `row ${index}: outer vertical gap is not a row action`);
    check(!row.contains(d.elementFromPoint(bounds.right + 1, bounds.y + 24)), `row ${index}: outer trailing gap is not a row action`);
    InspectorUtils.addPseudoClassLock(row, ":hover");
    try {
      const style = w.getComputedStyle(target);
      const expected = style.colorScheme === "dark" ?
        "color(display-p3 0.98 0.984 1 / 0.1)" : "color(display-p3 0.055 0.059 0.063 / 0.05)";
      check(style.backgroundColor === expected, `row ${index}: native SidebarItemBackground asset`);
      check(style.maskImage.includes("data:image/svg+xml"), `row ${index}: native continuous mask applied`);
      const image = new w.Image(); image.src = style.maskImage.slice(5, -2); await image.decode();
      check(near(image.naturalWidth, bounds.width) && image.naturalHeight === 48, `row ${index}: mask decodes at native dimensions`);
      const action = row.querySelector(".zen-library-download-action");
      check(w.getComputedStyle(action).display !== "none", `row ${index}: hover accessory appears`);
      samples.push({ index, bounds: bounds.toJSON(), background: style.backgroundColor, maskLoaded: true });
    } finally { InspectorUtils.removePseudoClassLock(row, ":hover"); }
  }
  const active = rows.find(row => row.download && !row.download.stopped);
  if (active) {
    const before = active.download.launchWhenSucceeded;
    active.querySelector(".zen-library-download-hit-target").dispatchEvent(new w.MouseEvent("click", { bubbles: true, button: 0 }));
    check(active.download.launchWhenSucceeded !== before, "hit target still activates the actual download row");
    active.querySelector(".zen-library-download-hit-target").dispatchEvent(new w.MouseEvent("click", { bubbles: true, button: 0 }));
    check(active.download.launchWhenSucceeded === before, "second activation restores the owned fixture setting");
  }
  return { space: space.name, checks, failures, samples, production_profile_used: false,
    scope: "Owned browser DOM hit testing and forced hover styles; not physical Arc pointer capture" };
})().then(done, error => done({ error: String(error), stack: error.stack }));
