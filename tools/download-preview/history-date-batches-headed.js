const done = arguments[arguments.length - 1];
(async () => {
  if (!PathUtils.profileDir.includes("zen-region-colors-native-")) throw new Error("Owned disposable profile required");
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const { ZenDownloadCreationDates } = ChromeUtils.importESModule("moz-src:///zen/library/ZenDownloadPreview.sys.mjs");
  const now = Date.now();
  const fixtures = Array.from({ length: 205 }, (_, index) => ({
    source: { url: new URL(`https://example.invalid/owned-history-date-batch/${index}?label=quote'check`).href },
    placesNode: { time: now * 1000 }, start: now - (index + 1) * 60000,
  }));
  let checks = 0, changes = 0; const failures = [];
  const check = (value, label) => { checks++; if (!value) failures.push(label); };
  const dates = new ZenDownloadCreationDates(() => changes++);
  const settle = async () => {
    for (let i = 0; i < 300; i++) {
      if (!dates.update(fixtures)) return true;
      await new Promise(resolve => w.setTimeout(resolve, 20));
    }
    return false;
  };
  try {
    await PlacesUtils.history.insertMany(fixtures.map(f => ({ url: f.source.url, visits: [
      { date: new Date(f.start), transition: PlacesUtils.history.TRANSITIONS.DOWNLOAD },
      { date: new Date(now), transition: PlacesUtils.history.TRANSITIONS.LINK },
    ] })));
    const started = w.performance.now();
    check(await settle(), "205 history records resolve across the 200-URL query boundary");
    const firstReadMilliseconds = w.performance.now() - started;
    check(fixtures.every(f => dates.get(f) === f.start), "every batch uses download time rather than a later ordinary visit");
    check(changes === 1 && !dates.update(fixtures), "cached repaints do not start another read");
    const updated = now - 1000;
    await PlacesUtils.history.insert({ url: fixtures[0].source.url, visits: [
      { date: new Date(updated), transition: PlacesUtils.history.TRANSITIONS.DOWNLOAD },
    ] });
    dates.invalidate(); check(await settle(), "reopening refreshes persisted visit changes");
    check(dates.get(fixtures[0]) === updated && fixtures.slice(1).every(f => dates.get(f) === f.start), "latest download visit updates only its own date");
    check(fixtures.every(f => f.startTime === undefined), "lookup leaves download objects unchanged");
    return { checks, failures, firstReadMilliseconds, records: fixtures.length, productionProfileUsed: false };
  } finally {
    dates.destroy();
    await PlacesUtils.history.remove(fixtures.map(f => f.source.url));
  }
})().then(done, error => done({ error: String(error), stack: error.stack }));
