// Run only in a disposable candidate. Start site-control-fixture.py and set
// w.siteCaptureFixtureBase to its loopback URL. Native Arc reference was checked
// separately at y=600; this harness extends the Zen regression across Spaces.
if (!Services.prefs.getBoolPref("zen.developer-mode.fixture-tests", false))
  throw Error("Use a disposable fixture profile");
const base = new URL(w.siteCaptureFixtureBase);
if (base.protocol !== "http:" || base.hostname !== "127.0.0.1")
  throw Error("Use the local synthetic fixture");
const { ZenWindowCapture } = ChromeUtils.importESModule(
  "resource:///modules/ZenWindowCapture.sys.mjs"
);
const originalSpace = w.gZenWorkspaces.activeWorkspace;
const originalTab = w.gBrowser.selectedTab;
const results = [];
const wait = async test => {
  const deadline = Date.now() + 10000;
  while (!(await test())) {
    if (Date.now() > deadline) throw Error("Scroll fixture did not settle");
    await new Promise(r => w.setTimeout(r, 25));
  }
};
try {
  for (const [index, space] of w.gZenWorkspaces.getWorkspaces().entries()) {
    await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid);
    for (const scroll of [0, 600, 1200]) {
      const url = `${base.origin}/full?scroll=${scroll}`;
      const tab = w.gBrowser.addTrustedTab(url);
      w.gBrowser.selectedTab = tab;
      const browser = tab.linkedBrowser;
      const capture = new ZenWindowCapture(w);
      let shot;
      try {
        await wait(() => browser.currentURI.spec === url && !browser.webProgress.isLoadingDocument);
        // First capture registers the geometry actor. No pixels are copied to
        // the clipboard; all snapshots are released within this iteration.
        shot = await capture.capture(browser, { fullPage: true });
        shot.close();
        const actor = browser.browsingContext.currentWindowGlobal.getActor("ZenWindowCapture");
        const bounds = () => actor.sendQuery("ZenWindowCapture:VisibleBounds");
        await wait(async () => (await bounds()).top === scroll);
        const before = await bounds();
        shot = await capture.capture(browser, { fullPage: true });
        const image = await w.createImageBitmap(await shot.png());
        const canvas = new w.OffscreenCanvas(image.width, image.height);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        image.close();
        try {
          const scale = before.devicePixelRatio;
          const sample = (x, y) => Array.from(ctx.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data).slice(0, 3);
          const stickyTop = Math.min(1060, Math.max(300, scroll + 16));
          const colors = [sample(140, scroll + 18), sample(310, stickyTop + 10), sample(140, 2310)];
          const expected = [[255, 0, 0], [0, 180, 0], [0, 0, 255]];
          if (JSON.stringify(colors) !== JSON.stringify(expected))
            throw Error(`Positioned elements moved: ${index + 1}/${scroll}: ${JSON.stringify(colors)}`);
          const after = await bounds();
          if (before.left !== after.left || before.top !== after.top)
            throw Error("Capture changed the page's scroll position");
          if (canvas.height !== 2400 * scale) throw Error("Incomplete document capture");
          results.push({space: index + 1, scroll, stickyTop, fixedTop: scroll + 8,
            width: canvas.width, height: canvas.height, colors, scrollPreserved: true});
        } finally { canvas.width = canvas.height = 0; }
      } finally {
        shot?.close();
        capture.destroy();
        if (tab.isConnected) w.gBrowser.removeTab(tab, {animate: false});
      }
    }
  }
  if (w.captureEvidenceDir) await IOUtils.writeJSON(w.captureEvidenceDir + "/scrolled-captures.json", results);
  return {checks: results.length, allPassed: true};
} finally {
  await w.gZenWorkspaces.changeWorkspaceWithID(originalSpace);
  if (originalTab.isConnected) w.gBrowser.selectedTab = originalTab;
}
