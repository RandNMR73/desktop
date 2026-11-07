// Native macOS events only; no emulated gesture fields. Run in the disposable
// five-Space fixture after packaging the new native engine.
const done = arguments[arguments.length - 1];
const options = arguments[0] || {};
(async () => {
  if (!Services.dirsvc.get("ProfD", Ci.nsIFile).path.includes("zen-sidebar-consistency-")) {
    throw Error("Disposable profile required");
  }
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const ws = w.gZenWorkspaces, spaces = ws.getWorkspaces(), cases = [];
  if (spaces.length !== 5) throw Error("Five-Space fixture required");
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const library = () => w.document.querySelector("zen-library");
  const read = () => ({
    active: ws.activeWorkspace,
    changing: ws.isChangingWorkspace,
    gesture: ws._swipeManager.isGestureActive,
    offsets: spaces.map(s => ws.workspaceElement(s.uuid).style.transform),
    add: w.document.querySelector(".zen-swipe-add-space-container")?.style.translate ?? null,
    opacity: Number(w.document.querySelector(".zen-swipe-add-space-background")?.style.opacity ?? 0),
    library: library()?.openProgress ?? 0,
    scrollbar: w.gZenUIManager.tabsWrapper.style.scrollbarWidth,
  });
  const names = ["MozSwipeGestureMayStart", "MozSwipeGestureStart",
    "MozSwipeGestureUpdate", "MozSwipeGesture", "MozSwipeGestureEnd"];
  let recording = null;
  const before = event => {
    if (!recording) return;
    const record = {type: event.type, at: event.timeStamp, delta: event.delta, before: read()};
    recording.push(record);
    // Opening Library attaches a capturing handler to the app wrapper, which
    // consumes updates before they reach the toolbox. Read after dispatch
    // rather than depending on that particular event target.
    w.setTimeout(() => Object.assign(record, {after: read(), accepted: event.defaultPrevented,
      owned: event.swipeConsumerHandlesRelease, offset: event.swipeProgressOffset}), 0);
  };
  names.forEach(name => {
    w.addEventListener(name, before, true);
  });
  const pan = (phase, dx) => new Promise((resolve, reject) => {
    const box = w.gNavToolbox.getBoundingClientRect(), scale = w.devicePixelRatio;
    const x = Math.round((w.mozInnerScreenX + box.x + box.width / 2) * scale);
    const y = Math.round((w.mozInnerScreenY + box.y + Math.min(350, box.height / 2)) * scale);
    const timer = w.setTimeout(() => reject(Error("Native input callback timed out")), 3000);
    try {
      w.windowUtils.sendNativeMouseScrollEvent(x, y, phase, Math.round(dx), 0, 0, 0, 0,
        w.gNavToolbox, () => { w.clearTimeout(timer); w.setTimeout(resolve, 0); });
    } catch (error) { w.clearTimeout(timer); reject(error); }
  });
  const reset = async () => {
    // Cleanup is recorded separately and never makes a failed case pass.
    if (ws._swipeManager.isGestureActive) await pan(8, 0);
    library()?.constructor.close();
    await pause(1200);
  };
  try {
    for (const compact of options.modes || [false, true]) {
      w.gZenCompactModeManager.preference = compact;
      w.gNavToolbox.toggleAttribute("zen-user-show", compact);
      await pause(250);
      for (const edge of options.edges || ["new-space", "library"]) {
        const rightLibrary = library()?.constructor.libraryOnRight;
        if (typeof rightLibrary !== "boolean") throw Error("Library fixture is missing");
        const sign = (edge === "library") === rightLibrary ? 1 : -1;
        const target = sign > 0 ? spaces.length - 1 : 0;
        const from = target - sign;
        for (const finish of options.finishes || ["release", "cancel"]) {
          await reset();
          await ws.changeWorkspaceWithID(spaces[from].uuid);
          const switching = ws.changeWorkspaceWithID(spaces[target].uuid);
          await pause(65);
          const result = {compact, edge, finish, from, target, initial: read(), events: []};
          recording = result.events;
          const width = ws.workspaceElement(spaces[target].uuid).getBoundingClientRect().width;
          const unit = -width * 200 / Services.prefs.getIntPref("zen.workspaces.swipe-actions.delta-multiplier");
          const firstDx = Math.round(unit * .01 * sign);
          await pan(128, 0);
          await pan(1, firstDx);
          const start = result.events.find(e => e.type === "MozSwipeGestureStart");
          const firstUpdate = result.events.find(e => e.type === "MozSwipeGestureUpdate");
          if (!start || !firstUpdate) throw Error("Native swipe did not start");
          const initialOffset = parseFloat(start.before.offsets[target].slice(11)) / 100;
          const factor = firstUpdate.delta / firstDx;
          const totalDx = Math.round(unit * (initialOffset + .02 * sign));
          await pan(2, totalDx - firstDx);
          const crossing = result.events.filter(e => e.type === "MozSwipeGestureUpdate").at(-1);
          const entry = read();
          await switching;
          await pause(20);
          await pan(2, 0);
          const duplicate = result.events.filter(e => e.type === "MozSwipeGestureUpdate").at(-1);
          const repeatedEntry = read();
          const rebasedDelta = crossing.delta + (crossing.offset || 0);
          await pause(150);
          await pan(finish === "cancel" ? 8 : 4, 0);
          await pause(1400);
          result.settled = read();
          recording = null;
          if (result.settled.gesture || Math.abs(result.settled.library) > .001 || result.settled.add) {
            result.cleanupRequired = true;
            await reset();
          }

          // Compare with fresh entry at the same native progress. Two adjacent
          // whole-pixel samples bracket the rebased fractional pixel so input
          // quantization cannot masquerade as a visual mismatch.
          const referenceEvents = [];
          recording = referenceEvents;
          const lowerDx = Math.floor(rebasedDelta / factor);
          await pan(128, 0);
          await pan(1, lowerDx);
          const lowerEvent = referenceEvents.filter(e => e.type === "MozSwipeGestureUpdate").at(-1);
          const lower = read();
          await pan(2, 1);
          const upperEvent = referenceEvents.filter(e => e.type === "MozSwipeGestureUpdate").at(-1);
          const upper = read();
          const key = edge === "library" ? "library" : "opacity";
          const fraction = (rebasedDelta - lowerEvent.delta) / (upperEvent.delta - lowerEvent.delta);
          const referenceValue = lower[key] + fraction * (upper[key] - lower[key]);
          await pan(8, 0);
          recording = null;
          await reset();
          Object.assign(result, {initialOffset, factor, totalDx, crossing, duplicate,
            entry, repeatedEntry, rebasedDelta,
            reference: {lower, upper, lowerDelta: lowerEvent.delta, upperDelta: upperEvent.delta, fraction, referenceValue}});
          result.checks = {
            interruptionObserved: result.initial.changing && Math.abs(initialOffset) > .01,
            consumerInitiallyOwned: start.owned === true,
            edgeTookOwnership: crossing.owned === false && Number.isFinite(crossing.offset) && Math.abs(crossing.offset) > .001,
            offsetAppliedOnce: Math.abs(duplicate.delta - rebasedDelta) < 1e-6 && duplicate.offset === 0,
            duplicateStable: Math.abs(entry[key] - repeatedEntry[key]) < 1e-6 && entry.add === repeatedEntry.add,
            freshEntryMatches: Number.isFinite(referenceValue) && fraction >= -1e-6 && fraction <= 1.000001 &&
              Math.abs(entry[key] - referenceValue) < 1e-6,
            nativeFinished: result.events.some(e => e.type === "MozSwipeGestureEnd"),
            noSuccessfulRelease: !result.events.some(e => e.type === "MozSwipeGesture"),
            settled: result.settled.active === spaces[target].uuid && !result.settled.changing &&
              !result.settled.gesture && result.settled.add === null && Math.abs(result.settled.library) < .001 &&
              result.settled.offsets[target] === "translateX(0%)" && result.settled.scrollbar === "",
          };
          result.passed = Object.values(result.checks).every(Boolean);
          cases.push(result);
        }
      }
    }
    return {input: "macOS native scroll-event phases; not physical trackpad input", cases,
      count: cases.length, passed: cases.every(c => c.passed),
      failed: cases.filter(c => !c.passed).map(c => ({compact: c.compact, edge: c.edge, finish: c.finish,
        failedChecks: Object.entries(c.checks).filter(([, passed]) => !passed).map(([name]) => name)}))};
  } finally {
    recording = null;
    names.forEach(name => {
      w.removeEventListener(name, before, true);
    });
    await reset();
  }
})().then(done, error => done({error: String(error), stack: error.stack}));
