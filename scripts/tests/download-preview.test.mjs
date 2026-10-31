import assert from "node:assert/strict";
import test from "node:test";
import { downloadDate, recentDownloads, relativeDownloadDate, ZenDownloadPreview }
  from "../../src/zen/library/ZenDownloadPreview.sys.mjs";

const file = (path, time, extra = {}) => ({
  target: { path, exists: true }, startTime: new Date(time), endTime: time,
  succeeded: true, stopped: true, totalBytes: 100, ...extra,
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
    result() { return { files: [{ path: "/owned/documents/image.png", modified: 100, size: 42 }] }; },
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
  assert.deepEqual(await files, []);
  assert.equal(requests.length, 1);
  assert.equal(callbacks.size, 0);
});
