import assert from "node:assert/strict";
import test from "node:test";
import { recentDownloads, relativeDownloadDate, ZenDownloadPreview }
  from "../../src/zen/library/ZenDownloadPreview.sys.mjs";

const file = (path, time, extra = {}) => ({
  target: { path, exists: true }, startTime: new Date(time), endTime: time,
  succeeded: true, stopped: true, totalBytes: 100, ...extra,
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
