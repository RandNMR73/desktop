// Async chrome-context body; w must be an isolated candidate browser window.
// The local Capture Window fixture is required on port 62979. Never run this in
// a personal profile. This checks the capture backend, not portrait UI parity.
if (!Services.prefs.getBoolPref("zen.developer-mode.fixture-tests", false))
  throw new Error("Use a disposable fixture profile");
const { ZenWindowCapture } = ChromeUtils.importESModule(
  "resource:///modules/ZenWindowCapture.sys.mjs",
);
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const wait = async (predicate) => {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    assert(Date.now() < deadline, "Fixture load timed out");
    await new Promise((resolve) => w.setTimeout(resolve, 25));
  }
};
const settle = () =>
  new Promise((resolve) =>
    w.requestAnimationFrame(() => w.requestAnimationFrame(resolve)),
  );
const originalTab = w.gBrowser.selectedTab,
  originalSpace = w.gZenWorkspaces.activeWorkspace;
const tabs = [],
  report = { spaces: [], races: {} };
const capture = new ZenWindowCapture(w);
const create = async (suffix) => {
  const url = `http://127.0.0.1:62979/capture-${suffix}`;
  const tab = w.gBrowser.addTrustedTab(url);
  tabs.push(tab);
  w.gBrowser.selectedTab = tab;
  await wait(
    () =>
      tab.linkedBrowser.currentURI.spec === url &&
      !tab.linkedBrowser.webProgress.isLoadingDocument,
  );
  await settle();
  return tab;
};
try {
  for (const [index, space] of w.gZenWorkspaces.getWorkspaces().entries()) {
    await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid);
    const tab = await create(`space-${index}`),
      browser = tab.linkedBrowser;
    const started = w.performance.now();
    const shot = await capture.capture(browser);
    assert(shot && shot.valid(), `No snapshot in Space ${index + 1}`);
    const capturedMs = w.performance.now() - started;
    const [png, second] = await Promise.all([shot.png(), shot.png()]);
    assert(png === second, "Encoding was duplicated");
    const bitmap = await w.createImageBitmap(png);
    const canvas = new w.OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const at = (x, y) =>
      Array.from(context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data);
    const header = at(8, 8),
      left = at(8, shot.height / 2),
      right = at(shot.width - 8, shot.height / 2);
    assert(
      header[0] > 140 && header[1] < 100,
      "Snapshot includes chrome or misses the red page header",
    );
    assert(
      left[1] > left[0] && right[2] > right[1],
      "Page columns missing from viewport",
    );
    if (w.captureEvidenceDir)
      await IOUtils.write(
        `${w.captureEvidenceDir}/zen-viewport-space-${index + 1}.png`,
        new Uint8Array(await png.arrayBuffer()),
      );
    report.spaces.push({
      index: index + 1,
      width: shot.width,
      height: shot.height,
      header,
      left,
      right,
      capturedMs,
      bytes: png.size,
    });
    canvas.width = canvas.height = 0;
    shot.close();
    assert(
      !shot.valid() && (await shot.png()) === null,
      "Closed snapshot retained access",
    );
  }
  const a = await create("race-a"),
    b = await create("race-b");
  w.gBrowser.selectedTab = a;
  await settle();
  let pending = capture.capture(a.linkedBrowser);
  w.gBrowser.selectedTab = b;
  assert((await pending) === null, "Selection race captured the wrong page");
  report.races.captureSelection = true;
  let shot = await capture.capture(b.linkedBrowser);
  pending = shot.copy();
  w.gBrowser.selectedTab = a;
  assert((await pending) === false, "Selection race copied a stale PNG");
  report.races.copySelection = true;
  shot = await capture.capture(a.linkedBrowser);
  const space = w.gZenWorkspaces
    .getWorkspaces()
    .find((item) => item.uuid !== w.gZenWorkspaces.activeWorkspace);
  await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid);
  assert(
    !shot.valid() && (await shot.copy()) === false,
    "Space change kept an old capture alive",
  );
  report.races.space = true;
  await w.gZenWorkspaces.changeWorkspaceWithID(
    a.getAttribute("zen-workspace-id"),
  );
  w.gBrowser.selectedTab = a;
  await settle();
  shot = await capture.capture(a.linkedBrowser);
  w.gBrowser.removeTab(a, { animate: false });
  assert(
    !shot.valid() && (await shot.copy()) === false,
    "Closed tab retained a usable capture",
  );
  report.races.close = true;
  w.gBrowser.selectedTab = b;
  await settle();
  shot = await capture.capture(b.linkedBrowser);
  capture.destroy();
  assert(
    !shot.valid() && (await shot.png()) === null,
    "Teardown retained a usable capture",
  );
  report.races.destroy = true;
  if (w.captureEvidenceDir)
    await IOUtils.writeUTF8(
      `${w.captureEvidenceDir}/runtime-validation.json`,
      JSON.stringify(report, null, 2),
    );
  return report;
} finally {
  capture.destroy();
  for (const tab of tabs)
    if (tab.isConnected) w.gBrowser.removeTab(tab, { animate: false });
  await w.gZenWorkspaces.changeWorkspaceWithID(originalSpace);
  if (originalTab.isConnected) w.gBrowser.selectedTab = originalTab;
  delete w.captureEvidenceDir;
}
