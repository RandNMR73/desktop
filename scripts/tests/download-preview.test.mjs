import assert from "node:assert/strict";
import test from "node:test";
import { downloadDate, recentDownloads, relativeDownloadDate, ZenDownloadPreview, ZenDownloadListPresentation }
  from "../../src/zen/library/ZenDownloadPreview.sys.mjs";

const file = (path, time, extra = {}) => ({
  target: { path, exists: true }, startTime: new Date(time), endTime: time,
  succeeded: true, stopped: true, totalBytes: 100, ...extra,
});

test("Media queries use a separate native capability and preserve type metadata", async () => {
  const requests = [], released = [];
  const files = [{ path: "/owned/image.raw", kind: "image", modified: 100, size: 42, cloud: true }];
  const preview = new ZenDownloadPreview({}, {
    media: true, start(input) { requests.push(input); return 1; },
    result: () => ({ files }), release: token => released.push(token),
  });
  assert.equal(await preview.mediaFiles(["downloads", "screenshots"], "/owned/hidden.json"), files);
  assert.deepEqual(requests, [{ operation: "media", path: "/", folders: ["downloads", "screenshots"],
    excludedPathsFile: "/owned/hidden.json" }]);
  assert.deepEqual(released, [1]);
  preview.destroy();
  await assert.rejects(preview.mediaFiles([]), /Media folder query failed/);
  const old = new ZenDownloadPreview({}, { sources: true, start() { assert.fail("old native ABI"); } });
  assert.equal(await old.mediaFiles(["downloads"]), null);
});

test("a timed-out Media query releases its native request and rejects instead of selecting fallback", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
  let poll;
  const released = [];
  const preview = new ZenDownloadPreview({ setTimeout(callback) { poll = callback; return 1; } }, {
    media: true, start: () => 7, result: () => 0, release: id => released.push(id),
  });
  const request = preview.mediaFiles(["downloads"]);
  const rejected = assert.rejects(request, /Media folder query failed/);
  t.mock.timers.tick(10001);
  poll();
  await rejected;
  assert.deepEqual(released, [7]);
  preview.destroy();
  assert.deepEqual(released, [7]);
});

test("native Media failure and malformed results differ from a successful empty folder", async () => {
  for (const result of [-1, null, {}, { files: "invalid" }, { files: [] }]) {
    let released = 0;
    const preview = new ZenDownloadPreview({}, {
      media: true, start: () => 1, result: () => result, release() { released++; },
    });
    if (Array.isArray(result?.files)) assert.deepEqual(await preview.mediaFiles([]), []);
    else await assert.rejects(preview.mediaFiles([]), /Media folder query failed/);
    assert.equal(released, 1);
    preview.destroy();
  }
  const unavailable = new ZenDownloadPreview({}, { media: true, start: () => 0 });
  await assert.rejects(unavailable.mediaFiles([]), /Media folder query failed/);
});

test("preview scan failures never masquerade as successful empty folders", async () => {
  for (const value of [null, -1, {}, { error: "folder-unavailable" }, { files: "invalid" }, { files: [] }]) {
    const released = [];
    const preview = new ZenDownloadPreview({}, {
      sources: true, start: () => 1, result: () => value, release: id => released.push(id),
    });
    for (const query of [() => preview.files("/owned"),
      () => preview.sourceFiles("/owned", { download: true })]) {
      if (Array.isArray(value?.files)) assert.deepEqual(await query(), []);
      else await assert.rejects(query(), /Preview folder query failed/);
    }
    assert.deepEqual(released, [1, 1]);
    preview.destroy();
  }
  const busy = new ZenDownloadPreview({}, { sources: true, start: () => 0 });
  await assert.rejects(busy.sourceFiles("/owned", { download: true }), /Preview folder query failed/);
  assert.deepEqual(await busy.sourceFiles("/owned", {}), []);
  busy.destroy();
});

test("a preview timeout rejects so the widget can keep its previously loaded files", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
  let poll;
  const released = [];
  const preview = new ZenDownloadPreview({ setTimeout(callback) { poll = callback; return 1; } }, {
    sources: true, start: () => 11, result: () => 0, release: id => released.push(id),
  });
  const rejected = assert.rejects(preview.sourceFiles("/owned", { download: true }),
    /Preview folder query failed/);
  t.mock.timers.tick(10001);
  poll();
  await rejected;
  preview.destroy();
  assert.deepEqual(released, [11]);
});

test("folder files use modification time for both recency and the visible date", async () => {
  const original = globalThis.PathUtils;
  globalThis.PathUtils = { toFileURI: path => `file://${path}` };
  const now = Date.UTC(2026, 9, 31);
  const modified = now - 5 * 86400000;
  const preview = new ZenDownloadPreview({}, {
    start: () => 1, release() {},
    result: () => ({ files: [{ path: "/owned/copied.json", created: now,
      modified, size: 123, cloud: false }] }),
  });
  try {
    const [copied] = await preview.files("/owned");
    assert.equal(downloadDate(copied), modified);
    assert.equal(relativeDownloadDate(downloadDate(copied), now, "en-US"), "5 days ago");
    assert.deepEqual(recentDownloads([file("/owned/new.pdf", now - 1000)], [copied])
      .map(item => item.target.path), ["/owned/copied.json", "/owned/new.pdf"]);
  } finally {
    preview.destroy();
    if (original === undefined) delete globalThis.PathUtils;
    else globalThis.PathUtils = original;
  }
});

test("four most recent items use timestamps across disk and persisted download order", () => {
  const disk = [file("a", 1), file("b", 2), file("c", 3), file("d", 4)];
  const live = file("d", 5, { stopped: false, succeeded: false });
  assert.deepEqual(recentDownloads([file("f", 7), file("e", 6), live], disk)
    .map(x => x.target.path), ["c", "d", "e", "f"]);
  assert.equal(recentDownloads([live], disk)[3], live);
});

test("removed or moved downloads cannot reappear through a stale directory result", () => {
  const a = file("a", 1), b = file("b", 2);
  assert.deepEqual(recentDownloads([{ ...a, deleted: true },
    { ...b, target: { path: "b", exists: false } }], [a, b]), []);
  assert.equal(recentDownloads([a], []).length, 1);
});

test("relative fallback shows elapsed units instead of size, host, or a calendar date", () => {
  const now = Date.UTC(2026, 9, 30);
  assert.equal(relativeDownloadDate(now - 5 * 86400000, now, "en-US"), "5 days ago");
  assert.equal(relativeDownloadDate(now - 21 * 3600000, now, "en-US"), "21 hours ago");
  assert.equal(relativeDownloadDate(now + 10, now, "en-US"), "0 seconds ago");
});

test("thumbnail work is reused, excludes cloud placeholders, and is cancelled on teardown", async () => {
  let calls = 0, released = [], callbacks = new Map(), timer = 0;
  const api = { start() { return ++calls; }, result() { return 0; },
    release(id) { released.push(id); }, date() { return "5 days ago"; } };
  const window = { devicePixelRatio: 2,
    setTimeout(fn) { callbacks.set(++timer, fn); return timer; },
    clearTimeout(id) { callbacks.delete(id); } };
  const preview = new ZenDownloadPreview(window, api), download = file("test.pdf", 1);
  const first = preview.thumbnail(download);
  assert.equal(preview.thumbnail(download), first);
  assert.equal(await preview.thumbnail({ ...download, _zenCloudFile: true }), null);
  assert.equal(calls, 1);
  preview.destroy();
  assert.equal(await first, null);
  assert.deepEqual(released, [1]);
  assert.equal(callbacks.size, 0);
  assert.equal(await preview.thumbnail(download), null);
});

test("failed native jobs release ownership and keep Gecko fallback usable", async () => {
  let released = 0;
  const preview = new ZenDownloadPreview({ devicePixelRatio: 2 }, {
    start: () => 1, result: () => -1, release() { released++; }, date: () => "",
  });
  assert.equal(await preview.thumbnail(file("gone.pdf", 1)), null);
  assert.equal(released, 1);
  assert.equal(new ZenDownloadPreview({}, null).date(0, 86400000), "1 day ago");
});

test("file metadata is shared until the file changes and actions use the bounded native bridge", async () => {
  const requests = [], released = [];
  const preview = new ZenDownloadPreview({}, {
    actions: true, start(input) { requests.push(input); return requests.length; },
    result: () => ({ succeeded: true, kind: "pdf", application: "Preview" }),
    release: id => released.push(id),
  });
  const download = file("/owned/example.pdf", 1);
  const first = preview.fileInfo(download);
  assert.equal(preview.fileInfo(download), first);
  assert.equal((await first).application, "Preview");
  await preview.fileInfo({ ...download, endTime: 2 });
  assert.equal(requests.length, 2);
  assert.equal(await preview.fileAction(download, "delete"), null);
  assert.equal((await preview.fileAction(download, "trash")).succeeded, true);
  assert.deepEqual(requests.at(-1), { operation: "trash", path: download.target.path });
  assert.deepEqual(released, [1, 2, 3]);
  preview.destroy();
  assert.equal(await preview.fileAction(download, "copy"), null);
  assert.equal(requests.length, 3);
});

test("an older native bundle never receives unsupported file operations", async () => {
  const preview = new ZenDownloadPreview({}, { actions: false, start() { assert.fail("unsupported request"); } });
  const download = file("/owned/example.pdf", 1);
  assert.equal(await preview.fileInfo(download), null);
  assert.equal(await preview.fileAction(download, "copy"), null);
  preview.destroy();
});

test("selected folder sources form one bounded media-aware query", async () => {
  const original = globalThis.PathUtils;
  globalThis.PathUtils = { isAbsolute: path => path.startsWith("/"), toFileURI: path => `file://${path}` };
  const requests = [];
  const api = { sources: true,
    start(input) { requests.push(input); return requests.length; }, release() {},
    result() { return { files: [{ path: "/owned/documents/image.png", modified: 100, size: 42, media: true }] }; },
  };
  const preview = new ZenDownloadPreview({}, api);
  try {
    const files = await preview.sourceFiles("/owned/downloads",
      { documents: true, desktop: false, screenshot: true, download: false }, "/owned/hidden.json");
    assert.deepEqual(requests, [{
      operation: "sources", path: "/owned/downloads", excludedPathsFile: "/owned/hidden.json",
      sources: { download: false, documents: true, desktop: false, screenshot: true },
    }]);
    assert.equal(files[0].target.path, "/owned/documents/image.png");
    assert.equal(files[0]._zenMediaFile, true);
    assert.equal(downloadDate(files[0]), 100);
    requests.length = 0;
    assert.deepEqual(await preview.sourceFiles("/owned/downloads", { capture: true }), []);
    assert.deepEqual(requests, []);
    await preview.sourceFiles("/owned/downloads", { download: true });
    assert.deepEqual(requests, [{ operation: "sources", path: "/owned/downloads",
      sources: { download: true, documents: false, desktop: false, screenshot: false }, excludedPathsFile: undefined }]);
  } finally {
    preview.destroy();
    if (original === undefined) delete globalThis.PathUtils;
    else globalThis.PathUtils = original;
  }
});

test("source compatibility never reads disabled Downloads on an older native bundle", async () => {
  const requests = [];
  const preview = new ZenDownloadPreview({}, {
    start(input) { requests.push(input); return 1; }, result: () => ({ files: [] }), release() {},
  });
  assert.deepEqual(await preview.sourceFiles("/owned", { documents: true }), []);
  assert.equal(requests.length, 0);
  await preview.sourceFiles("/owned", { download: true, documents: true }, "/hidden");
  assert.deepEqual(requests, [{ operation: "list", path: "/owned", excludedPathsFile: "/hidden" }]);
  preview.destroy();
});

test("teardown cancels a pending source query", async () => {
  const requests = [], callbacks = new Map();
  const preview = new ZenDownloadPreview({ setTimeout(fn) { callbacks.set(1, fn); return 1; },
    clearTimeout(id) { callbacks.delete(id); } }, {
    sources: true, start(input) { requests.push(input); return 1; }, result: () => 0, release() {},
  });
  const files = preview.sourceFiles("/owned", { documents: true, download: true });
  preview.destroy();
  await assert.rejects(files, /Preview folder query failed/);
  assert.equal(requests.length, 1);
  assert.equal(callbacks.size, 0);
});


test("Library thumbnails use their own native size and cache entry", async () => {
  const requests = [];
  const preview = new ZenDownloadPreview({ devicePixelRatio: 2 }, {
    start(input) { requests.push(input); return requests.length; },
    result: () => ({ url: "data:image/png;base64,owned", downloadKind: "pdf" }),
    release() {},
  });
  const download = file("/owned/report.pdf", 1);
  const hover = preview.thumbnail(download);
  const library = preview.thumbnail(download, 24);
  assert.equal(preview.thumbnail(download, 24), library);
  assert.notEqual(hover, library);
  assert.deepEqual(requests.map(({ size }) => size), [40, 24]);
  assert.equal((await library).downloadKind, "pdf");
  preview.destroy();
});

test("Library limits thumbnail concurrency and abandons work removed by a search", async () => {
  const pending = [], started = []; let changed = 0, destroyed = false;
  const presentation = new ZenDownloadListPresentation({
    thumbnail(download, size) {
      assert.equal(size, 24); started.push(download);
      return new Promise(resolve => pending.push(resolve));
    }, destroy() { destroyed = true; },
  }, () => changed++);
  const downloads = Array.from({ length: 100 }, (_, i) => file(`/owned/${i}.json`, i));
  presentation.update(downloads);
  assert.equal(started.length, 3);
  const replacement = file("/owned/search.pdf", 1000);
  presentation.update([replacement]);
  pending.shift()({ url: "data:old", downloadKind: "download" });
  await new Promise(setImmediate);
  assert.deepEqual(started, [...downloads.slice(0, 3), replacement]);
  assert.equal(changed, 1);
  presentation.destroy();
  assert.equal(destroyed, true);
  for (const resolve of pending) resolve({ url: "data:late" });
  await new Promise(setImmediate);
  assert.equal(changed, 1, "teardown prevents late repaints");
  assert.equal(started.length, 4, "old queued files never run");
});

test("Library presentation invalidates changed and missing files without accepting stale results", async () => {
  const pending = []; let changed = 0;
  const presentation = new ZenDownloadListPresentation({
    thumbnail() { return new Promise(resolve => pending.push(resolve)); }, destroy() {},
  }, () => changed++);
  const download = file("/owned/replaced.pdf", 1);
  presentation.update([download]);
  download.endTime = 2;
  presentation.update([download]);
  pending[0]({ url: "data:old" });
  await new Promise(setImmediate);
  assert.equal(presentation.get(download), null);
  assert.equal(changed, 0);
  pending[1]({ url: "data:new", downloadKind: "pdf" });
  await new Promise(setImmediate);
  assert.equal(presentation.get(download).url, "data:new");
  presentation.update([download]);
  assert.equal(pending.length, 2, "ready results are reused");
  download.target.exists = false;
  presentation.update([download]);
  assert.equal(presentation.get(download), null);
  assert.equal(pending.length, 2, "missing files do not request thumbnails");
  presentation.destroy();
});


test("failed Library thumbnails retry after a delay, without a repaint retry loop", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
  let calls = 0;
  const preview = new ZenDownloadPreview({ devicePixelRatio: 2 }, {
    start: () => ++calls,
    result: () => calls === 1 ? null : { url: "data:recovered", downloadKind: "pdf" },
    release() {},
  });
  const presentation = new ZenDownloadListPresentation(preview, () => {});
  const download = file("/owned/report.pdf", 1);
  presentation.update([download]);
  await new Promise(setImmediate);
  presentation.update([download]);
  assert.equal(calls, 1);
  t.mock.timers.tick(5001);
  presentation.update([download]);
  await new Promise(setImmediate);
  assert.equal(calls, 2);
  assert.equal(presentation.get(download).url, "data:recovered");
  presentation.destroy();
});
