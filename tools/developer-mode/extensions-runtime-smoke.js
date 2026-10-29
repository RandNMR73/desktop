// Run as an async chrome-context body with `w` bound to the isolated test window.
// Install only this directory's temporary fixture extensions first. The fixture
// server must answer HTTP requests on 127.0.0.1:62979. Never use a personal profile.
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
assert(
  Services.prefs.getBoolPref("zen.developer-mode.fixture-tests", false),
  "Set zen.developer-mode.fixture-tests only in an isolated test profile",
);
const pause = () =>
  new Promise((resolve) =>
    w.requestAnimationFrame(() => w.requestAnimationFrame(resolve)),
  );
const wait = async (predicate) => {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    assert(Date.now() < deadline, "Timed out waiting for fixture");
    await new Promise((resolve) => w.setTimeout(resolve, 25));
  }
};
const popupId = "developer-popup-fixture@zen.test";
const actionId = "developer-action-fixture@zen.test";
const api = (id) =>
  w.gUnifiedExtensions.browserActionFor(
    w.gUnifiedExtensions.getActivePolicies().find((policy) => policy.id === id),
  );
const popup = api(popupId),
  action = api(actionId);
assert(popup && action, "Install the two temporary test extensions");
const placements = [popup, action].map((item) => [
  item.id,
  w.CustomizableUI.getPlacementOfWidget(item.id),
]);
const oldTab = w.gBrowser.selectedTab,
  oldSpace = w.gZenWorkspaces.activeWorkspace;
const tabs = [],
  report = { spaces: [], race: {} };
const bar = (tab) =>
  tab.linkedBrowser
    .closest(".browserContainer")
    .querySelector(".zen-developer-toolbar");
const button = (tab, id) =>
  bar(tab)?.querySelector(`[data-extension-id="${id}"]`);
const create = async (suffix) => {
  const url = `http://127.0.0.1:62979/developer-extension-${suffix}`;
  const tab = w.gBrowser.addTrustedTab(url);
  tabs.push(tab);
  w.gBrowser.selectedTab = tab;
  await wait(
    () =>
      tab.linkedBrowser.currentURI.spec === url &&
      !tab.linkedBrowser.webProgress.isLoadingDocument &&
      bar(tab),
  );
  await pause();
  return tab;
};
let privateWindow;
try {
  for (const item of [popup, action])
    await w.gUnifiedExtensions.pinToToolbar(item.id, true);
  for (const [index, space] of w.gZenWorkspaces.getWorkspaces().entries()) {
    await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid);
    const tab = await create(`space-${index}`);
    assert(
      button(tab, popupId) && button(tab, actionId),
      `Missing pinned actions in Space ${index + 1}`,
    );
    action.action.setProperty(tab, "title", `Space ${index + 1}`);
    action.action.setProperty(tab, "enabled", false);
    action.action.setProperty(tab, "badgeText", String(index + 1));
    await pause();
    const node = button(tab, actionId);
    assert(
      node.title === `Space ${index + 1}` &&
        node.disabled &&
        node.lastElementChild.textContent === String(index + 1),
      "Tab-specific action state did not update",
    );
    action.action.setProperty(tab, "enabled", true);
    await pause();
    node.click();
    await wait(
      () => node.title === `Clicked ${tab.linkedBrowser.currentURI.spec}`,
    );
    assert(
      node.lastElementChild.textContent === "1",
      "No-popup click handler did not run",
    );
    let mutations = 0;
    const observer = new w.MutationObserver(
      (records) => (mutations += records.length),
    );
    observer.observe(bar(tab), {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });
    for (let i = 0; i < 100; i++) w.gZenDeveloperMode.refresh();
    await pause();
    observer.disconnect();
    assert(mutations === 0, "Unchanged refresh mutated extension controls");
    const toolbar = bar(tab).getBoundingClientRect(),
      page = tab.linkedBrowser.getBoundingClientRect();
    assert(
      toolbar.height === 40 && Math.abs(page.top - toolbar.bottom) < 1,
      "Toolbar changed content geometry",
    );
    report.spaces.push({
      space: index + 1,
      actions: 2,
      unchangedRefreshMutations: mutations,
      toolbarHeight: toolbar.height,
    });
  }

  // Delay PanelMultiView at the real async boundary. A stale request must never
  // invoke the extension or grant activeTab permission to a replacement tab/site.
  const owner = await create("race-owner");
  const other = await create("race-other");
  const originalShow = w.PanelUI.showSubView;
  const originalTrigger = popup.action.triggerClickOrPopup;
  let triggers = 0;
  popup.action.triggerClickOrPopup = function (...args) {
    triggers++;
    return originalTrigger.apply(this, args);
  };
  try {
    for (const scenario of ["selection", "navigation", "close"]) {
      w.gBrowser.selectedTab = owner;
      await pause();
      let release,
        entered = false,
        finished;
      const complete = new Promise((resolve) => (finished = resolve));
      const gate = new Promise((resolve) => (release = resolve));
      w.PanelUI.showSubView = async function (...args) {
        entered = true;
        await gate;
        try {
          return await originalShow.apply(this, args);
        } finally {
          finished();
        }
      };
      button(owner, popupId).click();
      assert(entered, "Popup request did not enter async gate");
      if (scenario === "selection") w.gBrowser.selectedTab = other;
      else if (scenario === "navigation") {
        const url = "http://127.0.0.1:62979/developer-extension-navigated";
        owner.linkedBrowser.loadURI(Services.io.newURI(url), {
          triggeringPrincipal:
            Services.scriptSecurityManager.getSystemPrincipal(),
        });
        await wait(
          () =>
            owner.linkedBrowser.currentURI.spec === url &&
            !owner.linkedBrowser.webProgress.isLoadingDocument,
        );
      } else w.gBrowser.removeTab(owner, { animate: false });
      release();
      await complete;
      assert(triggers === 0, `${scenario}: stale popup invoked the extension`);
      assert(
        !w.document.querySelector(
          '#customizationui-widget-panel[state="open"]',
        ),
        `${scenario}: stale popup remained open`,
      );
      report.race[scenario] = "discarded before extension invocation";
    }
  } finally {
    w.PanelUI.showSubView = originalShow;
    popup.action.triggerClickOrPopup = originalTrigger;
  }

  privateWindow = w.OpenBrowserWindow({ private: true });
  await wait(() => privateWindow.gBrowserInit?.delayedStartupFinished);
  const pt = privateWindow.gBrowser.addTrustedTab(
    "http://127.0.0.1:62979/developer-extension-private",
  );
  privateWindow.gBrowser.selectedTab = pt;
  await wait(
    () =>
      pt.linkedBrowser.currentURI.spec.endsWith(
        "developer-extension-private",
      ) &&
      !pt.linkedBrowser.webProgress.isLoadingDocument &&
      privateWindow.document.querySelector(".zen-developer-toolbar"),
  );
  assert(
    !privateWindow.gUnifiedExtensions
      .getActivePolicies()
      .some((policy) => [popupId, actionId].includes(policy.id)),
    "Fixture unexpectedly has private access",
  );
  assert(
    !privateWindow.document.querySelector(".zen-developer-extension"),
    "Extension without private access appeared in a private toolbar",
  );
  report.privateAccessFiltered = true;
  privateWindow.close();
  await wait(() => privateWindow.closed);
  return report;
} finally {
  if (privateWindow && !privateWindow.closed) privateWindow.close();
  for (const tab of tabs)
    if (tab.isConnected) w.gBrowser.removeTab(tab, { animate: false });
  for (const [id, placement] of placements) {
    if (placement)
      w.CustomizableUI.addWidgetToArea(id, placement.area, placement.position);
    else w.CustomizableUI.removeWidgetFromArea(id);
  }
  await w.gZenWorkspaces.changeWorkspaceWithID(oldSpace);
  if (oldTab.isConnected) w.gBrowser.selectedTab = oldTab;
}
