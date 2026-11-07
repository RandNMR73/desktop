const done = arguments[arguments.length - 1];
const options = arguments[0] || {};
(async () => {
  if (!Services.dirsvc.get("ProfD", Ci.nsIFile).path.includes("zen-sidebar-consistency-") ||
      !/^http:\/\/127\.0\.0\.1:\d+$/.test(options.base)) throw Error("Owned local fixture required");
  const w = Services.wm.getMostRecentWindow("navigator:browser"), u = w.windowUtils;
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const original = {tab: w.gBrowser.selectedTab, compact: w.gZenCompactModeManager.preference};
  w.gZenCompactModeManager.preference = false;
  w.gNavToolbox.removeAttribute("zen-user-show");
  const tab = w.gBrowser.addTab(options.base + "/vertical-page", {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
  w.gBrowser.selectedTab = tab;
  const browser = tab.linkedBrowser, cases = [];
  let manager, requestName, responseName, currentReply;
  const listener = message => currentReply?.(message.data);
  const frameScript = (requestName, responseName) => {
    if (content.location.hostname !== "127.0.0.1") throw Error("Local content required");
    let events = [];
    const wheel = event => events.push({dy: event.deltaY, trusted: event.isTrusted});
    content.addEventListener("wheel", wheel, {capture: true, passive: true});
    const read = () => {
      const root = content.document.scrollingElement;
      return {top: root.scrollTop, range: root.scrollHeight - root.clientHeight,
        viewId: content.windowUtils.getViewId(root),
        flags: content.windowUtils.getCompositorAPZTestData().additionalData,
        events, url: content.location.href};
    };
    const receive = async message => {
      try {
        const request = message.data;
        if (request.operation === "setup") {
          content.document.body.style.margin = "0";
          content.document.body.style.height = request.long ? "4000px" : "80px";
          content.scrollTo({top: request.edge === "bottom" ? 1e9 : 0, behavior: "instant"});
          events = [];
          await new Promise(resolve => content.requestAnimationFrame(() => content.requestAnimationFrame(resolve)));
        }
        if (request.operation === "stop") {
          content.removeEventListener("wheel", wheel, true);
          removeMessageListener(requestName, receive);
        }
        sendAsyncMessage(responseName, read());
      } catch (error) { sendAsyncMessage(responseName, {error: String(error)}); }
    };
    addMessageListener(requestName, receive);
    sendAsyncMessage(responseName, {ready: true});
  };
  const receive = () => new Promise((resolve, reject) => {
    const timer = w.setTimeout(() => { currentReply = null; reject(Error("Content reply timed out")); }, 5000);
    currentReply = value => { currentReply = null; w.clearTimeout(timer);
      value.error ? reject(Error(value.error)) : resolve(value); };
  });
  const ask = async request => { const reply = receive(); manager.sendAsyncMessage(requestName, request); return reply; };
  const pan = (phase, dy) => new Promise((resolve, reject) => {
    const box = browser.getBoundingClientRect(), scale = w.devicePixelRatio;
    const x = Math.round((w.mozInnerScreenX + box.x + box.width / 2) * scale);
    const y = Math.round((w.mozInnerScreenY + box.y + box.height / 2) * scale);
    const timer = w.setTimeout(() => reject(Error("Native pan callback timed out")), 3000);
    u.sendNativeMouseScrollEvent(x, y, phase, 0, dy, 0, 0, 0, browser,
      () => { w.clearTimeout(timer); resolve(); });
  });
  // Remote content owns a different layer tree from browser chrome. Query its
  // compositor in the frame, where the scroll ID and flags refer to one tree.
  const state = content => {
    const flags = content.flags;
    return {flags, overscrolled: flags.some(row => row.key === String(content.viewId) && row.value.includes("overscrolled"))};
  };
  try {
    const deadline = w.performance.now() + 10000;
    while (browser.currentURI.spec !== options.base + "/vertical-page" || browser.webProgress.isLoadingDocument) {
      if (w.performance.now() > deadline) throw Error("Local page did not load");
      await pause(50);
    }
    manager = browser.messageManager;
    requestName = "ZenOwnedBounceRequest" + Date.now();
    responseName = requestName + "Reply";
    manager.addMessageListener(responseName, listener);
    const ready = receive();
    manager.loadFrameScript("data:application/javascript," + encodeURIComponent(
      `(${frameScript})(${JSON.stringify(requestName)},${JSON.stringify(responseName)})`), false);
    if (!(await ready).ready) throw Error("Content fixture did not initialize");
    for (const long of [true, false]) {
      for (const edge of ["top", "bottom"]) {
        const before = await ask({operation: "setup", long, edge});
        await pause(300);
        const initial = state(await ask({operation: "read"})), samples = [];
        const delta = edge === "top" ? 12 : -12;
        await pan(1, delta);
        for (let n = 0; n < 12; n++) { await pan(2, delta); await pause(20); samples.push(state(await ask({operation: "read"}))); }
        await pause(150);
        const heldContent = await ask({operation: "read"}), held = state(heldContent);
        await pan(4, 0);
        await pause(1800);
        const after = await ask({operation: "read"}), settled = state(after);
        const checks = {range: long ? before.range > 0 : before.range === 0,
          idleBefore: !initial.overscrolled,
          trustedInput: heldContent.events.some(event => event.trusted && event.dy !== 0),
          held: held.overscrolled && samples.some(sample => sample.overscrolled),
          returned: !settled.overscrolled && Math.abs(after.top - before.top) <= 1,
          samePage: after.url === before.url && after.viewId === before.viewId};
        cases.push({long, edge, before, initial, held, heldContent, settled, after, samples, checks,
          passed: Object.values(checks).every(Boolean)});
      }
    }
    await ask({operation: "stop"});
    return {input: "Native Cocoa scroll-event phases and compositor state; not physical trackpad input",
      cases, count: cases.length, passed: cases.every(row => row.passed),
      failed: cases.filter(row => !row.passed).map(row => ({long: row.long, edge: row.edge,
        checks: Object.entries(row.checks).filter(([, pass]) => !pass).map(([name]) => name)}))};
  } finally {
    if (manager && responseName) manager.removeMessageListener(responseName, listener);
    w.gBrowser.removeTab(tab, {animate: false});
    if (original.tab.isConnected) w.gBrowser.selectedTab = original.tab;
    w.gZenCompactModeManager.preference = original.compact;
    w.gNavToolbox.toggleAttribute("zen-user-show", original.compact);
  }
})().then(done, error => done({error: String(error), stack: error.stack}));
