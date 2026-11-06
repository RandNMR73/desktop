// Marionette chrome-context async script. Run only in a disposable headed
// profile with an empty Favorite tray, the native renderer and managed styles.
const done = arguments[arguments.length - 1];
(async () => {
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const g = w.gBrowser, pins = w.gZenPinnedTabManager;
  if ([...g.tabs].some(tab => tab.hasAttribute("zen-essential"))) {
    throw new Error("Use a fresh fixture with an empty Favorite tray");
  }
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const tabs = ["#ff0000", "#00ad70", "#3478f6"].map(color => {
    const image = "data:image/svg+xml," + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="13" fill="${color}"/></svg>`
    );
    const tab = g.addTrustedTab("about:blank", { inBackground: true });
    pins.addToEssentials(tab);
    g.setIcon(tab, image);
    pins.setEssentialTabIcon(tab, image);
    return tab;
  });
  const state = tab => ({
    essential: tab.hasAttribute("zen-essential"),
    selected: g.selectedTab === tab,
    marker: tab.hasAttribute("zen-favorite-selected"),
    visuallySelected: tab.hasAttribute("visuallyselected"),
    ready: tab.hasAttribute("zen-favorite-outline-ready"),
    opacity: w.getComputedStyle(tab.querySelector(".tab-background"), "::after").opacity,
    peek: tab.hasAttribute("zen-glance-tab"),
  });
  const deadline = w.performance.now() + 7000;
  while (tabs.some(tab => !state(tab).ready) && w.performance.now() < deadline) {
    await pause(10);
  }
  const clicks = [];
  for (const mode of ["pinned", "compact"]) {
    w.gZenCompactModeManager.preference = mode === "compact";
    w.gNavToolbox.toggleAttribute("zen-user-show", mode === "compact");
    await pause(700);
    for (const tab of tabs) {
      w.gNavToolbox.toggleAttribute("zen-user-show", mode === "compact");
      await pause(40);
      const rect = tab.querySelector(".tab-content").getBoundingClientRect();
      const previous = g.selectedTab;
      let trusted = false;
      const listener = event => { trusted = event.isTrusted; };
      tab.addEventListener("mousedown", listener, { once: true });
      for (const type of ["mousedown", "mouseup"]) {
        w.synthesizeMouseEvent(type, rect.x + rect.width / 2, rect.y + rect.height / 2,
          { button: 0, clickCount: 1, modifiers: 0 },
          { isDOMEventSynthesized: true, isWidgetEventSynthesized: false, isAsyncEnabled: false });
      }
      clicks.push({ mode, trusted, current: state(tab), previous: state(previous) });
      tab.removeEventListener("mousedown", listener);
      await pause(80);
    }
  }

  const owner = tabs[0], glance = w.gZenGlanceManager;
  g.selectedTab = owner;
  await pause(100);
  const child = g.addTrustedTab("about:blank", { inBackground: true });
  await glance.openGlance({ url: "about:blank" }, child, owner);
  const opened = { owner: state(owner), child: state(child) };
  await glance.fullyOpenGlance();
  const promoted = { owner: state(owner), child: state(child) };
  g.selectedTab = owner;
  await pause(100);
  const secondChild = g.addTrustedTab("about:blank", { inBackground: true });
  await glance.openGlance({ url: "about:blank" }, secondChild, owner);
  await glance.closeGlance({ onTabClose: true, skipPermitUnload: true, hasFocused: false });
  const closed = state(owner);

  return {
    clicks, opened, promoted, closed,
    pass: clicks.every(row => row.trusted && row.current.selected && row.current.ready &&
      row.current.marker && row.current.opacity === "1" && !row.previous.marker &&
      (!row.previous.essential || row.previous.opacity === "0")) &&
      opened.owner.marker && opened.owner.opacity === "1" && opened.child.selected && opened.child.peek &&
      !promoted.owner.marker && promoted.owner.opacity === "0" && promoted.child.selected && !promoted.child.peek &&
      closed.selected && closed.marker && closed.opacity === "1",
  };
})().then(done, error => done({ error: String(error), stack: error.stack }));
