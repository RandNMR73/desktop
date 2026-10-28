// Async chrome-context body. Use only the disposable candidate profile and
// loopback fixture described in README.md. This is not native visual parity.
if (!Services.prefs.getBoolPref("zen.developer-mode.fixture-tests", false))
  throw new Error("Use a disposable fixture profile");
const { ZenPortraitCapture } = ChromeUtils.importESModule(
  "resource:///modules/ZenPortraitCapture.sys.mjs",
);
const { ZenWindowCapture } = ChromeUtils.importESModule(
  "resource:///modules/ZenWindowCapture.sys.mjs",
);
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const settle = () =>
  new Promise((resolve) =>
    w.requestAnimationFrame(() => w.requestAnimationFrame(resolve)),
  );
const wait = async (predicate) => {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    assert(Date.now() < deadline, "Fixture timed out");
    await new Promise((resolve) => w.setTimeout(resolve, 20));
  }
};
const original = {
  tab: w.gBrowser.selectedTab,
  space: w.gZenWorkspaces.activeWorkspace,
};
const saved = [
  "zen.portrait-capture.color",
  "zen.portrait-capture.watermark",
].map((name) => ({
  name,
  present: Services.prefs.prefHasUserValue(name),
  value: name.endsWith("color")
    ? Services.prefs.getIntPref(name, 875)
    : Services.prefs.getBoolPref(name, true),
}));
const tabs = [],
  report = { spaces: [], races: {} };
const originalWorker = w.Worker;
let compositions = 0;
w.Worker = new Proxy(originalWorker, {
  construct(target, args) {
    if (args[0] === "resource:///modules/ZenPortraitCaptureWorker.mjs")
      compositions++;
    return Reflect.construct(target, args);
  },
});
const capture = new ZenPortraitCapture(w),
  raw = new ZenWindowCapture(w);
const create = async (suffix) => {
  const url = `http://127.0.0.1:62979/portrait-${suffix}`;
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
const existingPanels = new Set(
  w.document.querySelectorAll("#zen-portrait-capture-panel"),
);
const panel = () =>
  [...w.document.querySelectorAll("#zen-portrait-capture-panel")].find(
    (p) => !existingPanels.has(p),
  );
const anchor = (tab) =>
  tab.linkedBrowser
    .closest(".browserContainer")
    .querySelector('[data-action="capture-window"]');
const preview = () => panel().querySelector("canvas");
const sample = () =>
  Array.from(preview().getContext("2d").getImageData(0, 0, 1, 1).data);
const checksum = () => {
  const c = preview(),
    data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  return data.reduce((sum, v, i) => (sum + v * ((i % 251) + 1)) >>> 0, 0);
};
try {
  Services.prefs.setIntPref("zen.portrait-capture.color", 875);
  Services.prefs.setBoolPref("zen.portrait-capture.watermark", true);
  for (const [index, space] of w.gZenWorkspaces.getWorkspaces().entries()) {
    await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid);
    const tab = await create(`space-${index}`);
    const started = w.performance.now();
    assert(
      await capture.open(tab.linkedBrowser, anchor(tab)),
      "Preview did not open",
    );
    await wait(() => panel()?.state === "open");
    await settle();
    const size = preview().getBoundingClientRect(),
      baseline = sample();
    assert(preview().width === 280, "Preview used full-size allocation");
    assert(
      size.width === 140 && size.height === 96,
      "Preview control dimensions changed",
    );
    const color = panel().querySelector("input[type=range]");
    color.value = "0";
    color.dispatchEvent(new w.Event("input"));
    await settle();
    const first = sample();
    color.value = "1000";
    color.dispatchEvent(new w.Event("input"));
    await settle();
    const last = sample();
    assert(
      first.join() !== last.join() && baseline.join() !== first.join(),
      "Slider did not change preview",
    );
    const watermark = panel().querySelector("input[type=checkbox]");
    const before = checksum();
    watermark.click();
    await settle();
    assert(checksum() !== before, "Watermark did not change preview");
    report.spaces.push({
      index: index + 1,
      previewPixels: [preview().width, preview().height],
      controlCSS: [size.width, size.height],
      baseline,
      first,
      last,
      elapsedMs: w.performance.now() - started,
    });
    let copyStarted = w.performance.now();
    assert(await capture.copy(), "Portrait PNG copy failed");
    const firstCopyMs = w.performance.now() - copyStarted;
    assert(panel().state === "open", "Copy dismissed the preview");
    const encoded = compositions;
    const accept = panel().querySelector(".zen-portrait-capture-accept");
    accept.focus();
    copyStarted = w.performance.now();
    assert(await capture.copy(), "Repeated portrait copy failed");
    const repeatCopyMs = w.performance.now() - copyStarted;
    assert(compositions === encoded, "Unchanged copy recomposed the image");
    assert(w.document.activeElement === accept, "Copy lost keyboard focus");
    color.value = "875";
    color.dispatchEvent(new w.Event("input"));
    await settle();
    color.focus();
    assert(await capture.copy(), "Edited portrait copy failed");
    assert(
      compositions === encoded + 1,
      "Edited copy used an outdated encoding",
    );
    assert(w.document.activeElement === color, "Copy lost the focused slider");
    Object.assign(report.spaces.at(-1), {
      clipboardCopied: true,
      previewRetainedAfterCopy: true,
      repeatReusedEncoding: true,
      editingReencoded: true,
      focusRestored: true,
      firstCopyMs,
      repeatCopyMs,
    });
    capture.close();
    assert(preview().width === 0, "Closed preview retained its pixels");
    Services.prefs.setIntPref("zen.portrait-capture.color", 875);
    Services.prefs.setBoolPref("zen.portrait-capture.watermark", true);
  }
  const owner = await create("owner");
  await capture.open(owner.linkedBrowser, anchor(owner));
  const copying = capture.copy();
  assert(
    [...panel().querySelectorAll("input")].every((control) => control.disabled),
    "Capture options remained editable during final encoding",
  );
  report.controlsDisabledDuringCopy = true;
  const other = await create("other");
  assert(
    (await copying) === false,
    "Selection during encoding copied stale pixels",
  );
  report.races.selectionDuringEncoding = true;
  await capture.open(other.linkedBrowser, anchor(other));
  w.gBrowser.removeTab(other, { animate: false });
  assert((await capture.copy()) === false, "Closed tab retained its preview");
  report.races.tabClose = true;
  w.gBrowser.selectedTab = owner;
  assert(
    w.gZenPinnedTabManager.addToEssentials(owner),
    "Fixture favorite could not be created",
  );
  await settle();
  const space = w.gZenWorkspaces.activeWorkspace;
  const destination = w.gZenWorkspaces
    .getWorkspaces()
    .find((s) => s.uuid !== space && !s.containerTabId);
  assert(destination, "Need a second default-container Space");
  // Visit the favorite in both Spaces so their real remembered selections are
  // the same tab. Merely pinning it does not override a Space's prior selection.
  await w.gZenWorkspaces.changeWorkspaceWithID(destination.uuid);
  w.gBrowser.selectedTab = owner;
  await w.gZenWorkspaces.changeWorkspaceWithID(space);
  assert(w.gBrowser.selectedTab === owner, "Favorite was not restored");
  const shot = await raw.capture(owner.linkedBrowser);
  await capture.open(owner.linkedBrowser, anchor(owner));
  await w.gZenWorkspaces.changeWorkspaceWithID(destination.uuid);
  const retainedSelection = w.gBrowser.selectedTab === owner;
  await w.gZenWorkspaces.changeWorkspaceWithID(space);
  assert(
    !shot.valid() && (await shot.copy()) === false,
    "Space roundtrip revived the snapshot",
  );
  assert(
    (await capture.copy()) === false,
    "Space change left the preview active",
  );
  report.races.sharedFavoriteSpaceRoundtrip = {
    retainedSelection,
    invalidated: true,
  };
  assert(
    retainedSelection,
    "Shared-favorite case did not actually retain selection",
  );
  capture.destroy();
  assert(!panel(), "Destroyed capture panel remained in the document");
  report.destroyRemovedPanel = true;
} finally {
  w.Worker = originalWorker;
  capture.destroy();
  raw.destroy();
  for (const tab of tabs)
    if (tab.isConnected && !tab.closing)
      w.gBrowser.removeTab(tab, { animate: false });
  await w.gZenWorkspaces.changeWorkspaceWithID(original.space);
  if (original.tab.isConnected) w.gBrowser.selectedTab = original.tab;
  for (const { name, present, value } of saved) {
    if (!present) Services.prefs.clearUserPref(name);
    else if (typeof value === "number") Services.prefs.setIntPref(name, value);
    else Services.prefs.setBoolPref(name, value);
  }
}
if (w.captureEvidenceDir)
  await IOUtils.writeJSON(
    `${w.captureEvidenceDir}/portrait-runtime-validation.json`,
    report,
  );
return report;
