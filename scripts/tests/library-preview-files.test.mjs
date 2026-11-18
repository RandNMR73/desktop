import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { comparePreviewPaths, mergePreviewSourceFiles, PreviewSourceFiles }
  from "../../src/zen/library/ZenLibraryPreviewSources.sys.mjs";
import { recentDownloads, ZenDownloadPreview }
  from "../../src/zen/library/ZenDownloadPreview.sys.mjs";

const file = (path, time, media = false) => ({
  target: { path, exists: true }, _zenModified: time, _zenMediaFile: media,
  _zenDiskFile: true, startTime: time, endTime: time, stopped: true, succeeded: true,
});
const paths = files => files.map(item => item.target.path);
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(sources = { download: true, documents: true, desktop: true, screenshot: true }) {
  const pending = [], changes = [], errors = [];
  const model = new PreviewSourceFiles((source, current) => new Promise((resolve, reject) => {
    pending.push({ source, current, resolve, reject });
  }), () => changes.push(paths(model.files())), error => errors.push(error));
  model.configure(sources);
  return { model, pending, changes, errors };
}

test("path ties match all 8100 independently recorded Foundation comparisons", () => {
  const reference = JSON.parse(fs.readFileSync(new URL("./fixtures/download-path-order.json", import.meta.url)));
  const ranks = new Map(reference.equalGroupsInAscendingOrder.flatMap((group, rank) => group.map(i => [i, rank])));
  assert.equal(reference.paths.length ** 2, reference.comparisonCount);
  for (const [i, left] of reference.paths.entries()) {
    for (const [j, right] of reference.paths.entries()) {
      assert.equal(Math.sign(comparePreviewPaths(left, right)) || 0,
        Math.sign(ranks.get(i) - ranks.get(j)) || 0, `${i},${j}`);
    }
  }
  const a = file("/owned/é", 100), b = file("/owned/e\u0301", 100);
  assert.deepEqual(mergePreviewSourceFiles([[a, b]]), [a, b], "equal native ties stay stable");
});

test("top four are selected before display order; hidden and duplicate media paths precede the cap", () => {
  const a = Object.freeze(file("/a", 100)), b = Object.freeze(file("/b", 100));
  const media = Object.freeze(file("/a", 100, true));
  const input = [[a, b, file("/c", 100), file("/d", 100)], [media, file("/e", 100), file("/f", 100)]];
  const top = mergePreviewSourceFiles(input);
  assert.deepEqual(paths(top), ["/a", "/b", "/c", "/d"]);
  assert.equal(top[0]._zenMediaFile, true);
  assert.equal(a._zenMediaFile, false, "snapshot input is never mutated");
  const visible = mergePreviewSourceFiles(input, item => item.target.path !== "/b" &&
    (item._zenMediaFile || item.target.path !== "/a"));
  assert.deepEqual(paths(visible), ["/a", "/c", "/d", "/e"]);
  assert.deepEqual(paths(recentDownloads([], top)), ["/a", "/b", "/c", "/d"]);
});

test("per-source four preserve the global four across overlap and timestamp ties", () => {
  // Independent full-directory selection, including media-only overlapping roots.
  for (let seed = 0; seed < 128; seed++) {
    const folders = Array.from({ length: 4 }, (_, source) => Array.from({ length: 12 }, (_, i) =>
      file(`/owned/${String((i * 5 + source * 3 + seed) % 21).padStart(2, "0")}`,
        ((i * 5 + source * 3 + seed) % 21) % 7, source !== 0)));
    const all = new Map();
    for (const item of folders.flat()) {
      const prior = all.get(item.target.path);
      all.set(item.target.path, { ...item, _zenMediaFile: item._zenMediaFile || !!prior?._zenMediaFile });
    }
    const order = (a, b) => b._zenModified - a._zenModified ||
      (a.target.path < b.target.path ? -1 : a.target.path > b.target.path ? 1 : 0);
    const expected = [...all.values()].sort(order).slice(0, 4);
    const actual = mergePreviewSourceFiles(folders.map(items => items.sort(order).slice(0, 4)));
    assert.deepEqual(actual, expected, `seed ${seed}`);
  }
});

test("available sources publish before a blocked sibling and errors do not erase them", async () => {
  const f = fixture();
  const complete = f.model.refresh();
  assert.deepEqual(f.pending.map(job => job.source), ["download", "documents", "desktop", "screenshot"]);
  f.pending[0].resolve([file("/download", 1)]); await flush();
  assert.deepEqual(f.changes, [["/download"]], "first-start preview need not await Documents");
  f.pending[2].resolve([file("/desktop", 3, true)]); await flush();
  assert.deepEqual(paths(f.model.files()), ["/desktop", "/download"]);
  f.pending[3].reject(new Error("permission denied")); await flush();
  assert.equal(f.errors.length, 1);
  assert.deepEqual(paths(f.model.files()), ["/desktop", "/download"]);
  f.pending[1].reject(new Error("query timed out")); await complete;
  assert.equal(f.errors.length, 2);
});

test("failed refresh retains that source, successful empty clears only that source", async () => {
  const f = fixture({ download: true, documents: true });
  let complete = f.model.refresh();
  f.pending[0].resolve([file("/download", 1)]); f.pending[1].resolve([file("/media", 2, true)]);
  await complete;
  complete = f.model.refresh();
  f.pending[2].reject(new Error("unavailable")); f.pending[3].resolve([]); await complete;
  assert.deepEqual(paths(f.model.files()), ["/download"]);
  complete = f.model.refresh();
  f.pending[4].resolve([]); f.pending[5].reject(new Error("unavailable")); await complete;
  assert.deepEqual(f.model.files(), []);
});

test("all sources failing on first start yields no invented rows or automatic retry loop", async () => {
  const f = fixture(); const complete = f.model.refresh();
  for (const job of f.pending) job.reject(new Error("unavailable"));
  await complete; await flush();
  assert.deepEqual(f.model.files(), []); assert.equal(f.pending.length, 4);
  assert.equal(f.changes.length, 0); assert.equal(f.errors.length, 4);
});

test("source changes remove disabled snapshots and invalidate old responses before reenable", async () => {
  const f = fixture({ download: true, desktop: true });
  let complete = f.model.refresh();
  f.pending[0].resolve([file("/download", 1)]); f.pending[1].resolve([file("/desktop", 2, true)]);
  await complete;
  complete = f.model.refresh();
  f.model.configure({ desktop: true });
  assert.deepEqual(paths(f.model.files()), ["/desktop"]);
  f.model.refresh();
  f.pending[2].resolve([file("/stale-download", 3)]); f.pending[3].resolve([file("/stale-desktop", 4, true)]);
  await flush();
  assert.deepEqual(paths(f.model.files()), ["/desktop"]);
  assert.equal(f.pending[4].source, "desktop");
  f.pending[4].resolve([file("/new-desktop", 5, true)]); await complete;
  f.model.configure({ download: true, desktop: true });
  assert.deepEqual(paths(f.model.files()), ["/new-desktop"], "disabled snapshot cannot reappear on reenable");
  f.model.destroy();
});

test("hidden state invalidates pending native results and filters cached rows immediately", async () => {
  const f = fixture({ download: true });
  let complete = f.model.refresh();
  f.pending[0].resolve([file("/a", 4), file("/b", 3), file("/c", 2), file("/d", 1)]); await complete;
  complete = f.model.refresh(); f.model.invalidate(); f.model.refresh();
  assert.deepEqual(paths(f.model.files(item => item.target.path !== "/a")), ["/b", "/c", "/d"]);
  const before = f.changes.length;
  f.pending[1].resolve([file("/stale", 5)]); await flush();
  assert.equal(f.changes.length, before);
  f.pending[2].resolve([file("/b", 3), file("/c", 2), file("/d", 1), file("/replacement", 0)]);
  await complete;
  assert.deepEqual(paths(f.model.files()), ["/b", "/c", "/d", "/replacement"]);
});

test("hover bursts coalesce to one follow-up pass with at most four pending requests", async () => {
  const f = fixture(); const complete = f.model.refresh();
  for (let i = 0; i < 20; i++) f.model.refresh();
  assert.equal(f.pending.length, 4);
  for (const job of f.pending) job.resolve([]);
  await flush();
  assert.equal(f.pending.length, 8);
  for (const job of f.pending.slice(4)) job.resolve([]);
  await complete; assert.equal(f.pending.length, 8);
});

test("teardown discards pending and queued updates, including rejected requests", async () => {
  const f = fixture(); const complete = f.model.refresh(); f.model.refresh();
  f.model.destroy();
  f.pending[0].resolve([file("/late", 10)]);
  for (const job of f.pending.slice(1)) job.reject(new Error("shutdown"));
  await complete; await f.model.refresh();
  assert.deepEqual(f.model.files(), []); assert.deepEqual(f.changes, []); assert.deepEqual(f.errors, []);
  assert.equal(f.pending.length, 4);
});

test("live arrivals retain identity/priority and deletions, captures and source masks still merge", async () => {
  const f = fixture({ download: true, capture: true }); const complete = f.model.refresh();
  const disk = [file("/a", 1), file("/b", 2), file("/c", 3), file("/d", 4)];
  f.pending[0].resolve(disk); await complete;
  const live = { ...file("/b", 6), stopped: false, succeeded: false };
  const deleted = { ...file("/a", 7), deleted: true };
  const capture = file("/capture", 5, true);
  const shown = recentDownloads([live, deleted], [...f.model.files(), capture]);
  assert.deepEqual(paths(shown), ["/c", "/d", "/capture", "/b"]);
  assert.equal(shown[3], live);
  f.model.configure({ capture: true }); await f.model.refresh();
  assert.equal(f.pending.length, 1, "capture is never a folder request");
  assert.deepEqual(recentDownloads([live], [capture]), [capture, live]);
});

test("real native polling adapter isolates errors and preserves the existing older-ABI fallback", async () => {
  const previous = globalThis.PathUtils;
  globalThis.PathUtils = { toFileURI: path => `file://${path}` };
  try {
    for (const sourcesABI of [true, false]) {
      let next = 0; const inputs = new Map(), released = [];
      const backend = { sources: sourcesABI,
        start(input) { const id = ++next; inputs.set(id, input); return id; },
        result(id) {
          const input = inputs.get(id);
          return input.operation === "list" || input.sources.download ?
            { files: [{ path: "/a", modified: 4, media: false, cloud: true, size: 10 }] } :
            { error: "folder-unavailable" };
        }, release(id) { released.push(id); },
      };
      const preview = new ZenDownloadPreview({}, backend), errors = [];
      const model = new PreviewSourceFiles(source => preview.sourceFiles(source === "download" ? "/owned" : "/",
        { [source]: true }, "/owned/hidden.json"), () => {}, error => errors.push(error));
      model.configure({ download: true, documents: true, desktop: true, screenshot: true });
      await model.refresh();
      assert.deepEqual(paths(model.files()), ["/a"]);
      assert.equal(model.files()[0]._zenCloudFile, true);
      assert.equal(inputs.size, sourcesABI ? 4 : 1);
      assert.equal(errors.length, sourcesABI ? 3 : 0);
      assert.equal(released.length, inputs.size);
      model.destroy(); preview.destroy();
    }
  } finally { globalThis.PathUtils = previous; }
});

test("a healthy source refreshes again while its sibling stays blocked, with no duplicate sibling job", async () => {
  const f = fixture({ download: true, documents: true });
  const first = f.model.refresh();
  f.pending[0].resolve([file("/first", 1)]); await flush();
  assert.deepEqual(paths(f.model.files()), ["/first"]);
  const second = f.model.refresh();
  assert.deepEqual(f.pending.map(job => job.source), ["download", "documents", "download"]);
  f.pending[2].resolve([file("/second", 2)]); await flush();
  assert.deepEqual(paths(f.model.files()), ["/second"], "second Downloads result arrives before Documents settles");
  assert.equal(f.pending.filter(job => job.source === "documents").length, 1);
  f.model.destroy(); f.pending[1].reject(new Error("blocked source ended"));
  await Promise.all([first, second]);
});

test("disable/re-enable during a pending request rejects its response and coalesces one replacement", async () => {
  const f = fixture({ download: true, desktop: true });
  const first = f.model.refresh();
  f.pending[1].resolve([file("/desktop", 1, true)]); await flush();
  f.model.configure({ desktop: true });
  f.model.configure({ download: true, desktop: true });
  const second = f.model.refresh();
  assert.deepEqual(f.pending.map(job => job.source), ["download", "desktop", "desktop"]);
  const before = f.changes.length;
  f.pending[0].resolve([file("/obsolete", 3)]); await flush();
  assert.equal(f.changes.length, before);
  assert.deepEqual(f.pending.map(job => job.source), ["download", "desktop", "desktop", "download"]);
  f.pending[2].resolve([file("/desktop", 1, true)]);
  f.pending[3].resolve([file("/fresh", 4)]);
  await Promise.all([first, second]);
  assert.deepEqual(paths(f.model.files()), ["/fresh", "/desktop"]);
});

test("changing the Downloads folder clears only its former files even if the new folder fails", async () => {
  const f = fixture({ download: true, desktop: true });
  let complete = f.model.refresh();
  f.pending[0].resolve([file("/former-folder/file", 2)]);
  f.pending[1].resolve([file("/desktop/image", 1, true)]);
  await complete;
  complete = f.model.refresh();
  f.model.reset("download");
  assert.deepEqual(paths(f.model.files()), ["/desktop/image"]);
  assert.equal(f.pending[2].current(), false, "old-folder query is invalidated");
  assert.equal(f.pending[3].current(), true, "unrelated media query remains current");
  const retry = f.model.refresh();
  f.pending[2].resolve([file("/former-folder/late-file", 5)]);
  f.pending[3].resolve([file("/desktop/new-image", 3, true)]);
  await flush();
  assert.deepEqual(paths(f.model.files()), ["/desktop/new-image"]);
  assert.equal(f.pending[4].source, "download");
  f.pending[4].reject(new Error("new download folder unavailable"));
  f.pending[5].resolve([file("/desktop/new-image", 3, true)]);
  await Promise.all([complete, retry]);
  assert.deepEqual(paths(f.model.files()), ["/desktop/new-image"]);
  assert.equal(f.errors.length, 1);
});
