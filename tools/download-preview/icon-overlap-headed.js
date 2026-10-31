// Operates only in the disposable browser profile owned by the validation run.
const done = arguments[arguments.length - 1], spaceIndex = Number(arguments[0] || 0);
(async () => {
  const profile = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
  if (!profile.includes("zen-region-colors-native-")) throw Error("Owned disposable profile required");
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const { ZenDownloadIconMotion } = ChromeUtils.importESModule("moz-src:///zen/library/ZenDownloadMotion.sys.mjs");
  const space = w.gZenWorkspaces.getWorkspaces()[spaceIndex];
  await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid);
  const sprite = d.querySelector("#zen-library-button .zen-library-sprite");
  for (const animation of sprite.getAnimations()) animation.finish();
  await Promise.resolve();
  const scenarios = await IOUtils.readJSON("/Users/matthewnoto/Temp/zen-arc-repair/tools/download-preview/icon-trajectory-reference.json");
  let checks = 0, nextTimer = 0, time = 0, maximumYError = 0, maximumScaleError = 0;
  const failures = [], timers = new Map(), samples = [];
  const check = (ok, message) => { checks++; if (!ok && failures.length < 30) failures.push(message); };
  const clock = {
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const proxy = { document: { timeline: { get currentTime() { return time; } } } };
  for (const scenario of scenarios) {
    const motion = new ZenDownloadIconMotion(proxy, sprite, clock);
    let start = 0;
    try {
      const inputs = scenario.events.filter(e => ["arrival", "dismissal", "reset"].includes(e.action));
      for (const point of scenario.samples) {
        time = point.milliseconds;
        for (const input of inputs.filter(e => e.milliseconds === time)) {
          motion.update(input.action); start = time;
        }
        for (const animation of sprite.getAnimations()) {
          animation.pause(); animation.currentTime = Math.min(time - start, animation.effect.getTiming().duration);
        }
        const style = w.getComputedStyle(sprite);
        const y = Number.parseFloat(style.translate.split(" ")[1] || "0");
        const scale = style.transform === "none" ? 1 : new w.DOMMatrix(style.transform).a;
        const yError = Math.abs(y - point.y), scaleError = Math.abs(scale - point.scale);
        maximumYError = Math.max(maximumYError, yError);
        maximumScaleError = Math.max(maximumScaleError, scaleError);
        check(yError < .0051, `${scenario.case} Y at ${time}ms: ${y} versus ${point.y}`);
        check(scaleError < .00012, `${scenario.case} scale at ${time}ms: ${scale} versus ${point.scale}`);
      }
      samples.push({ scenario: scenario.case, points: scenario.samples.length });
    } finally { motion.stop(); }
    check(timers.size === 0 && sprite.getAnimations().length === 0, scenario.case + ": cleanup");
  }
  return { space: space.name, checks, failures, maximumYError, maximumScaleError, samples,
    production_profile_used: false, scope: "Native scalar samples against the real footer compositor; not production Arc pixel equality" };
})().then(done, error => done({ error: String(error), stack: error.stack }));
