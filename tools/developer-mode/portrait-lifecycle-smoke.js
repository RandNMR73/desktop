// Async chrome-context body; isolated candidate profile and loopback fixture only.
if (!Services.prefs.getBoolPref("zen.developer-mode.fixture-tests", false))
  throw new Error("Use a disposable fixture profile");
const { ZenPortraitCapture } = ChromeUtils.importESModule(
  "resource:///modules/ZenPortraitCapture.sys.mjs",
);
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const wait = async (predicate) => {
  const until = Date.now() + 10000;
  while (!predicate()) {
    assert(Date.now() < until, "Fixture timed out");
    await new Promise((resolve) => w.setTimeout(resolve, 20));
  }
};
const settle = () =>
  new Promise((resolve) =>
    w.requestAnimationFrame(() => w.requestAnimationFrame(resolve)),
  );
const original = {
  tab: w.gBrowser.selectedTab,
  space: w.gZenWorkspaces.activeWorkspace,
  sitesPresent: Services.prefs.prefHasUserValue("zen.developer-mode.sites"),
  sites: Services.prefs.getStringPref("zen.developer-mode.sites", "[]"),
  bitmap: w.createImageBitmap,
};
const tabs = [],
  report = { spaces: [], races: {} };
let capture, releaseBitmap;
const panel = () => w.document.getElementById("zen-portrait-capture-panel");
const anchor = (browser) =>
  browser
    .closest(".browserContainer")
    .querySelector('[data-action="capture-window"]');
const developer = w.gZenDeveloperMode;
try {
  for (const [index, space] of w.gZenWorkspaces.getWorkspaces().entries()) {
    await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid);
    const url = `http://127.0.0.1:62979/portrait-lifecycle-${index}`;
    const tab = w.gBrowser.addTrustedTab(url);
    tabs.push(tab);
    w.gBrowser.selectedTab = tab;
    const browser = tab.linkedBrowser;
    await wait(
      () =>
        browser.currentURI.spec === url &&
        !browser.webProgress.isLoadingDocument,
    );
    developer.setEnabled(browser, true);
    await settle();
    const oldAnchor = anchor(browser);
    oldAnchor.click();
    await wait(() => panel()?.state === "open");
    developer.setEnabled(browser, false);
    await wait(() => panel().state === "closed");
    assert(!oldAnchor.isConnected, "Toolbar was not removed");
    assert(
      panel().querySelector("canvas").width === 0,
      "Disabled toolbar retained preview pixels",
    );

    developer.setEnabled(browser, true);
    await settle();
    let decoding = false,
      completed = false;
    const gate = new Promise((resolve) => {
      releaseBitmap = resolve;
    });
    w.createImageBitmap = async (...args) => {
      const bitmap = await original.bitmap.apply(w, args);
      decoding = true;
      await gate;
      completed = true;
      return bitmap;
    };
    anchor(browser).click();
    await wait(() => decoding);
    developer.setEnabled(browser, false);
    developer.setEnabled(browser, true);
    releaseBitmap();
    await wait(() => completed);
    await settle();
    assert(
      panel().state === "closed",
      "Removed toolbar reopened a stale popup",
    );
    assert(
      panel().querySelector("canvas").width === 0,
      "Abandoned decode retained preview pixels",
    );
    w.createImageBitmap = original.bitmap;

    // The replacement toolbar must work after the abandoned request settles.
    anchor(browser).click();
    await wait(() => panel().state === "open");
    panel().hidePopup();
    await wait(() => panel().state === "closed");
    report.spaces.push({
      index: index + 1,
      disabledPreviewClosed: true,
      pendingDecodeCancelled: true,
      replacementOpened: true,
      releasedPixels: true,
    });
  }

  const browser = w.gBrowser.selectedBrowser;
  capture = new ZenPortraitCapture(w);
  assert(
    (await capture.open(browser, null)) === false,
    "Unanchored popup opened",
  );
  assert(await capture.open(browser, anchor(browser)), "Preview did not open");
  capture.closeForBrowser({});
  assert(
    await capture.copy(),
    "Removing a different pane cancelled the capture",
  );
  const pending = capture.copy();
  capture.closeForBrowser(browser);
  assert((await pending) === false, "Removed owner copied its cached image");
  assert((await capture.copy()) === false, "Closed owner retained its session");
  report.races.removedOwnerDuringCachedCopy = true;
  report.races.unrelatedPanePreserved = true;
  report.races.missingAnchorRejected = true;
  assert(
    await capture.open(browser, anchor(browser), { quick: true }),
    "Quick capture failed",
  );
  assert(
    (await capture.copy()) === false,
    "Quick capture retained its session",
  );
  report.quickCaptureReleasedSession = true;
} finally {
  releaseBitmap?.();
  w.createImageBitmap = original.bitmap;
  capture?.destroy();
  for (const p of w.document.querySelectorAll("#zen-portrait-capture-panel"))
    p.hidePopup();
  for (const tab of tabs)
    if (tab.isConnected && !tab.closing)
      w.gBrowser.removeTab(tab, { animate: false });
  await w.gZenWorkspaces.changeWorkspaceWithID(original.space);
  if (original.tab.isConnected) w.gBrowser.selectedTab = original.tab;
  if (original.sitesPresent)
    Services.prefs.setStringPref("zen.developer-mode.sites", original.sites);
  else Services.prefs.clearUserPref("zen.developer-mode.sites");
}
if (w.captureEvidenceDir)
  await IOUtils.writeJSON(
    `${w.captureEvidenceDir}/portrait-lifecycle-validation.json`,
    report,
  );
return report;
