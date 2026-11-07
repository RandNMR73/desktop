const done = arguments[arguments.length - 1];
(async () => {
  if (!Services.dirsvc.get("ProfD", Ci.nsIFile).path.includes("zen-sidebar-consistency-")) {
    throw Error("Disposable profile required");
  }
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const ws = w.gZenWorkspaces, u = w.windowUtils, cases = [];
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const original = {space: ws.activeWorkspace, compact: w.gZenCompactModeManager.preference};
  const pan = (box, phase, dy) => new Promise((resolve, reject) => {
    const rect = box.getBoundingClientRect(), scale = w.devicePixelRatio;
    const x = Math.round((w.mozInnerScreenX + rect.x + rect.width / 2) * scale);
    const y = Math.round((w.mozInnerScreenY + rect.y + Math.min(200, rect.height / 2)) * scale);
    const timer = w.setTimeout(() => reject(Error("Native pan callback timed out")), 3000);
    u.sendNativeMouseScrollEvent(x, y, phase, 0, dy, 0, 0, 0, w.gNavToolbox,
      () => { w.clearTimeout(timer); resolve(); });
  });
  try {
    await ws.changeWorkspaceWithID(ws.getWorkspaces()[1].uuid);
    for (const compact of [false, true]) {
      w.gZenCompactModeManager.preference = compact;
      w.gNavToolbox.toggleAttribute("zen-user-show", compact);
      await pause(400);
      const box = ws.workspaceElement(ws.activeWorkspace).querySelector(".workspace-arrowscrollbox").scrollbox;
      const viewId = u.getViewId(box);
      const read = () => {
        const panel = w.gZenNativeSidebar.isOpen ? w.gZenNativeSidebar.panel : null;
        const flags = u.getCompositorAPZTestData(panel).additionalData;
        return {top: box.scrollTop, range: box.scrollHeight - box.clientHeight,
          overscrolled: flags.some(row => row.key === String(viewId) && row.value.includes("overscrolled")),
          flags, panel: w.gZenNativeSidebar.isOpen,
          gesture: ws._swipeManager.isGestureActive,
          scrollbar: w.getComputedStyle(box).scrollbarColor};
      };
      for (const edge of ["top", "bottom"]) {
        box.scrollTo({top: edge === "top" ? 0 : 1e9, behavior: "instant"});
        await pause(300);
        const before = read(), samples = [], events = [];
        const listener = event => events.push({dy: event.deltaY, trusted: event.isTrusted,
          target: event.target.localName, x: event.clientX, y: event.clientY});
        w.addEventListener("wheel", listener, {capture: true, passive: true});
        try {
          const delta = edge === "top" ? 12 : -12;
          await pan(box, 1, delta);
          for (let n = 0; n < 12; n++) {
            await pan(box, 2, delta);
            await pause(20);
            samples.push(read());
          }
          await pause(150);
          const held = read();
          await pan(box, 4, 0);
          await pause(1800);
          const settled = read();
          const checks = {
            range: before.range > 0,
            idleBefore: !before.overscrolled,
            trustedInput: events.some(event => event.trusted && event.dy !== 0),
            overscrollWhileHeld: held.overscrolled && samples.some(sample => sample.overscrolled),
            returned: !settled.overscrolled && Math.abs(settled.top - before.top) <= 1,
            noHorizontalGesture: !held.gesture && !settled.gesture,
            samePanel: before.panel === compact && held.panel === compact && settled.panel === compact,
            sameScrollbar: before.scrollbar === held.scrollbar && held.scrollbar === settled.scrollbar,
          };
          cases.push({compact, edge, viewId, before, held, settled, events, samples, checks,
            passed: Object.values(checks).every(Boolean)});
        } finally {
          w.removeEventListener("wheel", listener, true);
          await pan(box, 8, 0);
        }
      }
    }
    return {input: "Native Cocoa scroll-event phases and compositor state; not physical trackpad input",
      cases, count: cases.length, passed: cases.every(row => row.passed),
      failed: cases.filter(row => !row.passed).map(row => ({compact: row.compact, edge: row.edge,
        checks: Object.entries(row.checks).filter(([, pass]) => !pass).map(([name]) => name)}))};
  } finally {
    w.gZenCompactModeManager.preference = original.compact;
    w.gNavToolbox.toggleAttribute("zen-user-show", original.compact);
    await ws.changeWorkspaceWithID(original.space);
  }
})().then(done, error => done({error: String(error), stack: error.stack}));
