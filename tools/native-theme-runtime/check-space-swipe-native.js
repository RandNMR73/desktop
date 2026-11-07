const done = arguments[arguments.length - 1];
const options = arguments[0] || {};
(async () => {
  if (!Services.dirsvc.get("ProfD", Ci.nsIFile).path.includes("zen-sidebar-consistency-")) {
    throw Error("Disposable profile required");
  }
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const ws = w.gZenWorkspaces, u = w.windowUtils, spaces = ws.getWorkspaces();
  if (spaces.length !== 5) throw Error("Five-Space fixture required");
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const cases = [], names = ["MozSwipeGestureMayStart", "MozSwipeGestureStart",
    "MozSwipeGestureUpdate", "MozSwipeGesture", "MozSwipeGestureEnd"];
  const read = () => ({active: ws.activeWorkspace, changing: ws.isChangingWorkspace,
    gesture: ws._swipeManager.isGestureActive,
    offsets: spaces.map(s => ws.workspaceElement(s.uuid).style.transform),
    scrollbar: w.gZenUIManager.tabsWrapper.style.scrollbarWidth,
    layers: ["zen-browser-background", "zen-toolbar-background"].map(id => {
      const node = w.document.getElementById(id), suffix = id === "zen-browser-background" ? "" : "-toolbar";
      return {first: node.style.getPropertyValue("--zen-main-browser-background" + suffix + "-old"),
        second: node.style.getPropertyValue("--zen-main-browser-background" + suffix),
        progress: Number(node.style.getPropertyValue("--zen-background-opacity"))};
    })});
  const weights = layer => {
    const result = {};
    result[layer.first] = (result[layer.first] || 0) + 1 - layer.progress;
    result[layer.second] = (result[layer.second] || 0) + layer.progress;
    return result;
  };
  const continuous = (a, b) => a.layers.every((layer, i) => {
    const x = weights(layer), y = weights(b.layers[i]);
    return [...new Set([...Object.keys(x), ...Object.keys(y)])].every(key => Math.abs((x[key] || 0) - (y[key] || 0)) < 1e-6);
  }) && a.offsets.every((offset, i) => {
    const x = parseFloat(offset.slice(11)), y = parseFloat(b.offsets[i].slice(11));
    return (Math.abs(x) >= 100 && Math.abs(y) >= 100) || Math.abs(x - y) < 0.001;
  });
  let current = null;
  const records = new WeakMap();
  const before = event => {
    if (!current) return;
    const record = {type: event.type, at: event.timeStamp, delta: event.delta,
      hasConsumer: "swipeConsumerHandlesRelease" in event, before: read()};
    records.set(event, record);
    current.events.push(record);
  };
  const after = event => {
    const record = records.get(event);
    if (record) Object.assign(record, {after: read(), accepted: event.defaultPrevented,
      owned: event.swipeConsumerHandlesRelease, offset: event.swipeProgressOffset});
  };
  names.forEach(name => { w.addEventListener(name, before, true); w.gNavToolbox.addEventListener(name, after, true); });
  const pan = (phase, dx) => new Promise((resolve, reject) => {
    const box = w.gNavToolbox.getBoundingClientRect(), scale = w.devicePixelRatio;
    const x = Math.round((w.mozInnerScreenX + box.x + box.width / 2) * scale);
    const y = Math.round((w.mozInnerScreenY + box.y + Math.min(350, box.height / 2)) * scale);
    const timer = w.setTimeout(() => reject(Error("Native input callback timed out")), 3000);
    try {
      u.sendNativeMouseScrollEvent(x, y, phase, Math.round(dx), 0, 0, 0, 0, w.gNavToolbox,
        () => { w.clearTimeout(timer); resolve(); });
    } catch (error) { w.clearTimeout(timer); reject(error); }
  });
  try {
    for (const compact of options.modes || [false, true]) {
      w.gZenCompactModeManager.preference = compact;
      w.gNavToolbox.toggleAttribute("zen-user-show", compact);
      await pause(250);
      for (const kind of options.kinds || ["fast", "stationary", "interrupted", "cancel", "reverse", "keyboard"]) {
        const indexes = ["fast", "stationary", "interrupted"].includes(kind) ? options.indexes || [0, 1, 2, 3, 4] : [1];
        for (const from of indexes) {
          const target = from === spaces.length - 1 ? from - 1 : from + 1;
          const direction = Math.sign(target - from);
          await ws.changeWorkspaceWithID(spaces[from].uuid);
          await pause(30);
          let oldSelection = null;
          if (kind === "interrupted") {
            oldSelection = ws.changeWorkspaceWithID(spaces[target].uuid);
            await pause(65);
          }
          current = {compact, kind, from, target, events: [], initial: read()};
          const width = ws.workspaceElement(ws.activeWorkspace).getBoundingClientRect().width;
          const unit = -width * 200 / Services.prefs.getIntPref("zen.workspaces.swipe-actions.delta-multiplier");
          await pan(128, 0);
          await pan(1, unit * 0.025 * direction); await pause(16);
          for (let i = 0; i < 3; i++) { await pan(2, unit * 0.025 * direction); await pause(16); }
          if (kind === "stationary") await pause(150);
          if (kind === "reverse") {
            await pause(120);
            await pan(2, -unit * 0.025 * direction); await pause(16);
            await pan(2, -unit * 0.025 * direction); await pause(16);
          }
          let explicitSelection = null;
          if (kind === "keyboard") {
            explicitSelection = ws.changeWorkspaceWithID(spaces[3].uuid);
            await pause(25);
          }
          current.beforeRelease = read();
          await pan(kind === "cancel" ? 8 : 4, 0);
          await oldSelection;
          await explicitSelection;
          await pause(1300);
          current.settled = read();
          const start = current.events.find(event => event.type === "MozSwipeGestureStart");
          const release = current.events.find(event => event.type === "MozSwipeGesture");
          const end = current.events.find(event => event.type === "MozSwipeGestureEnd");
          const expected = kind === "keyboard" ? 3 : ["fast", "interrupted"].includes(kind) ? target : from;
          current.expected = expected;
          const expectedTheme = w.gZenThemePicker.getGradientForWorkspace(spaces[expected]);
          const settledTheme = current.settled.layers.every((layer, index) => {
            const expectedGradient = expectedTheme[index ? "toolbarGradient" : "gradient"];
            return Object.entries(weights(layer)).every(([gradient, weight]) =>
              gradient === expectedGradient || Math.abs(weight) < 1e-6);
          });
          current.checks = {
            nativeStart: !!start,
            nativeEnd: !!end,
            consumerOwned: start?.hasConsumer && start?.owned === true,
            startContinuous: !!start?.after && continuous(start.before, start.after),
            settledTheme,
            interruptionObserved: kind !== "interrupted" || current.initial.changing,
            releaseContract: kind === "cancel" ? !release : !!release && !current.events.some(event => event.type === "MozSwipeGestureUpdate" && event.at >= release.at),
            settled: current.settled.active === spaces[expected].uuid &&
              current.settled.offsets[expected] === "translateX(0%)" &&
              !current.settled.changing && !current.settled.gesture && current.settled.scrollbar === "",
          };
          current.passed = Object.values(current.checks).every(Boolean);
          cases.push(current);
          current = null;
          if (cases.at(-1).settled.gesture) {
            cases.at(-1).cleanupRequired = true;
            await pan(4, 0);
            await pause(1300);
          }
        }
      }
    }
    return {input: "macOS native scroll-event phases; no emulated gesture fields; not physical trackpad input",
      cases, count: cases.length, passed: cases.every(c => c.passed),
      failed: cases.filter(c => !c.passed).map(c => ({compact: c.compact, kind: c.kind, from: c.from,
        failedChecks: Object.entries(c.checks).filter(([, passed]) => !passed).map(([name]) => name)}))};
  } finally {
    names.forEach(name => { w.removeEventListener(name, before, true); w.gNavToolbox.removeEventListener(name, after, true); });
  }
})().then(done, error => done({error: String(error), stack: error.stack}));
