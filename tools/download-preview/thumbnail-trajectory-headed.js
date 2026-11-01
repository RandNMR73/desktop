// Run only through the owned disposable-profile harness. Exercise the actual
// renderer and Gecko layout against the recorded native SwiftUI geometry.
const done = arguments[arguments.length - 1], spaceIndex = Number(arguments[0] || 0);
(async () => {
  const profile = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
  if (!profile.includes("zen-region-colors-native-")) throw Error("Owned disposable profile required");
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const { ZenDownloadThumbnails } = ChromeUtils.importESModule("moz-src:///zen/library/ZenDownloadThumbnailMotion.sys.mjs");
  const references = await IOUtils.readJSON("/Users/matthewnoto/Temp/zen-arc-repair/tools/download-preview/thumbnail-overlap-reference.json");
  const space = w.gZenWorkspaces.getWorkspaces()[spaceIndex];
  await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid);
  const element = () => d.createElementNS("http://www.w3.org/1999/xhtml", "div");
  const host = element();
  host.style.cssText = "position:fixed;left:300px;top:100px;width:320px;height:320px;background:white;z-index:2147483647;pointer-events:none;";
  d.documentElement.appendChild(host);
  const origin = host.getBoundingClientRect();
  const results = [], failures = [];
  let checks = 0, maximumCenterError = 0;
  try {
    for (const mode of ["persistent", "recycled"]) for (const reference of references) {
      let now = 0, epsilon = 0, next = 0, selected = reference.initial;
      let ids = ["A", "B", "C", "D"];
      const frames = new Map(), timers = new Map();
      const items = new Map(ids.map(id => [id, { target: { path: id }, succeeded: !reference.active.includes(id) }]));
      const rows = ids.map(() => {
        const row = element(), badge = element();
        row.style.cssText = "position:absolute;left:4px;width:212px;height:52px;transform-origin:0 0;";
        badge.className = "zen-library-download-badge";
        badge.style.cssText = "all:initial;display:block;position:absolute;left:4px;top:6px;width:40px;height:40px;scale:none;background:red;";
        row.appendChild(badge); host.appendChild(row); return row;
      });
      const sprite = element(); host.appendChild(sprite);
      const proxy = {
        document: { getElementById: id => id === "navigator-toolbox" ? { clientWidth: 228 } : null },
        performance: { now: () => now }, matchMedia: () => ({ matches: false }),
        requestAnimationFrame(fn) { const id = ++next; frames.set(id, fn); return id; },
        cancelAnimationFrame(id) { frames.delete(id); },
      };
      const clock = {
        setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, at: now + delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
      };
      const renderer = new ZenDownloadThumbnails(proxy, sprite, () => {}, clock);
      const arrange = () => {
        const ordered = ids.toReversed().map((id, index) => mode === "persistent" ?
          rows[["A", "B", "C", "D"].indexOf(id)] : rows[index]);
        ordered.forEach((row, index) => {
          row.download = items.get(ids.toReversed()[index]);
          row.style.top = `${60 + index * 56}px`;
        });
        return ordered;
      };
      const paint = () => {
        for (const [id, fn] of [...frames]) { frames.delete(id); fn(now); }
      };
      const callbacks = () => {
        for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
          if (timer.at <= now + 1e-7) { timers.delete(id); timer.fn(); }
        }
      };
      let points = 0, maxError = 0;
      const discrepancies = [];
      try {
        renderer.sync(arrange(), items.get(selected) ?? null, { animate: false });
        const expected = new Map(reference.samples.map(sample => [sample.milliseconds, sample.geometry]));
        for (let ms = 0; ms <= 1200; ms += 10) {
          now = ms + epsilon;
          if (ms) paint();
          for (const event of reference.inputs.filter(event => event.milliseconds === ms)) {
            if (event.name.startsWith("select-")) {
              selected = event.name === "select-nil" ? null : event.name.at(-1);
              if (["B", "C"].includes(selected)) ids = [selected, ...ids.filter(id => id !== selected)];
              renderer.sync(arrange(), items.get(selected) ?? null);
            } else {
              const expanded = event.name === "expand";
              renderer.setExpanded(expanded);
              // The shared selection store also consumes terminal arrivals.
              if (expanded && selected && !reference.active.includes(selected)) {
                selected = null; renderer.sync(arrange(), null);
              }
            }
          }
          callbacks(); paint();
          epsilon += 0.001; now = ms + epsilon; paint();
          const native = expected.get(ms);
          if (!native?.visible || Math.min(...native.areas) <= 1) continue;
          const row = rows.find(row => row.download.target.path === reference.inspected);
          const bounds = row.firstElementChild.getBoundingClientRect();
          const center = { x: bounds.x + bounds.width / 2 - origin.x,
            y: bounds.y + bounds.height / 2 - origin.y };
          const error = Math.max(Math.abs(center.x - native.centerX), Math.abs(center.y - native.centerY));
          maximumCenterError = Math.max(maximumCenterError, error); maxError = Math.max(maxError, error);
          points++; checks++;
          if (error > 0.06 && discrepancies.length < 4) discrepancies.push({ ms, error, center,
            expected: { x: native.centerX, y: native.centerY } });
        }
      } finally { renderer.destroy(); for (const row of rows) row.remove(); sprite.remove(); }
      results.push({ mode, case: reference.case, inspected: reference.inspected, points, maximumCenterError: maxError });
      if (!points || discrepancies.length) failures.push({ mode, case: reference.case,
        inspected: reference.inspected, discrepancies });
    }
  } finally { host.remove(); }
  return { space: space.name, checks, maximumCenterError, failures, results,
    scope: "Actual renderer and Gecko DOM geometry against owned SwiftUI references, not production Arc pixel equality" };
})().then(done, error => done({ error: String(error), stack: error.stack }));
