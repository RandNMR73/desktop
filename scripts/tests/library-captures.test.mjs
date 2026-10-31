import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rename, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { LibraryCaptures, capturePreviewItem } from "../../src/zen/library/ZenLibraryCaptures.sys.mjs";
import { recentDownloads } from "../../src/zen/library/ZenDownloadPreview.sys.mjs";

const png = () => Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1kAAAAASUVORK5CYII=", "base64"));
const capture = (id = randomUUID(), createdDate = 1234) => ({
  id, url: "https://example.invalid/original", createdDate, text: "Captured text",
  captureType: "partialPage", captureLayoutInfo: {
    webContentSize: { width: 1200, height: 4000 },
    webContentOffset: { x: 0, y: 900 },
    frameRelativeToViewport: { x: 10, y: 20, width: 320, height: 200 },
  },
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "zen-capture-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manifest = join(directory, "captures.json");
  let notifications = 0, writes = 0;
  const state = { failMetadata: false, failImages: false, failRemoval: false };
  const atomic = async (path, bytes) => {
    await writeFile(path + ".tmp", bytes);
    await rename(path + ".tmp", path);
  };
  const io = {
    newID: randomUUID,
    imagePath: name => join(directory, name),
    async read() {
      try { return JSON.parse(await readFile(manifest, "utf8")); }
      catch (error) {
        if (error.code === "ENOENT") return { version: 1, captures: [], garbage: [] };
        throw error;
      }
    },
    async write(data) {
      writes++;
      if (state.failMetadata) throw new Error("metadata unavailable");
      await atomic(manifest, JSON.stringify(data));
    },
    async writeImage(name, bytes) {
      if (state.failImages) throw new Error("image unavailable");
      await atomic(join(directory, name), bytes);
    },
    async removeImage(name) {
      if (state.failRemoval) throw new Error("image is busy");
      await rm(join(directory, name), { force: true });
      await rm(join(directory, name) + ".tmp", { force: true });
    },
    notify() { notifications++; },
  };
  return { io, state, directory, manifest,
    get notifications() { return notifications; }, get writes() { return writes; } };
}

test("captures persist their original source, layout, text and pixels across reopening", async t => {
  const f = await fixture(t), store = new LibraryCaptures(f.io), data = capture(), bytes = png();
  const expected = bytes.slice();
  const pending = store.save(data, bytes);
  data.url = "https://example.invalid/navigated";
  data.captureLayoutInfo.webContentOffset.y = 1800;
  bytes.fill(0);
  const item = await pending;
  assert.equal(item.url, "https://example.invalid/original");
  assert.equal(item.captureLayoutInfo.webContentOffset.y, 900);
  assert.equal(item.text, "Captured text");
  assert.ok(Object.isFrozen(item.captureLayoutInfo.frameRelativeToViewport));
  assert.deepEqual(new Uint8Array(await readFile(store.imagePath(item))), expected);
  const reopened = new LibraryCaptures(f.io); await reopened.ready;
  assert.deepEqual(reopened.items, [item]);
  assert.equal(f.notifications, 1);
  const later = await reopened.save(capture(undefined, 4567), png());
  assert.deepEqual(reopened.items.map(x => x.id), [later.id, item.id]);
});

test("updating one capture keeps its identity and publishes only the replacement image", async t => {
  const f = await fixture(t), store = new LibraryCaptures(f.io), data = capture();
  const first = await store.save(data, png());
  const path = store.imagePath(first);
  const changed = await store.save({ ...data, text: "Updated selection" }, png());
  assert.equal(changed.id, first.id); assert.equal(changed.createdDate, first.createdDate);
  assert.notEqual(changed.image, first.image);
  assert.equal(store.items.length, 1);
  assert.throws(() => store.imagePath(first), /no longer current/);
  await assert.rejects(readFile(path), { code: "ENOENT" });
  assert.deepEqual((await f.io.read()).garbage, []);
  assert.equal(f.notifications, 2);
});

test("preview titles preserve empty captions, fall back to the full source URL, and merge by creation date", async t => {
  const f = await fixture(t), store = new LibraryCaptures(f.io);
  const records = [];
  for (const [index, text] of [null, "", "A caption"].entries()) {
    const item = await store.save({ ...capture(undefined, 200 + index * 100), text }, png());
    const record = capturePreviewItem(store, item);
    assert.equal(record.title, text ?? item.url);
    assert.equal(record._zenLibraryCapture, item);
    assert.equal(record.target.path, store.imagePath(item));
    records.push(record);
  }
  const disk = time => ({ target: { path: `/owned/file-${time}.png` }, startTime: time });
  const result = recentDownloads([disk(500)], [disk(100), ...records]);
  assert.deepEqual(result.map(item => item.startTime), [200, 300, 400, 500]);
  assert.equal(result[0].source.url, "https://example.invalid/original");
  await store.remove(records[0]._zenLibraryCapture.id);
  assert.throws(() => capturePreviewItem(store, records[0]._zenLibraryCapture), /no longer current/);
});

test("a queued menu deletion cannot delete a newer revision of the same capture", async t => {
  const f = await fixture(t), store = new LibraryCaptures(f.io), data = capture();
  const previous = await store.save(data, png());
  const replacement = store.save({ ...data, text: "Revised in another window" }, png());
  const deletion = store.remove(data.id, previous);
  await assert.rejects(deletion, /no longer current/);
  const current = await replacement;
  assert.equal(store.get(data.id), current);
  assert.equal(await store.remove(data.id, current), true);
});

test("capture bytes can originate in another browser-window realm", async t => {
  const f = await fixture(t), store = new LibraryCaptures(f.io);
  const bytes = runInNewContext("new Uint8Array(bytes)", { bytes: [...png()] });
  assert.equal(bytes instanceof Uint8Array, false);
  const item = await store.save(capture(), bytes);
  assert.deepEqual(new Uint8Array(await readFile(store.imagePath(item))), png());
  await assert.rejects(store.save(capture(), new DataView(png().buffer)), TypeError);
});

test("failed image or metadata writes preserve the existing capture and allow retry", async t => {
  const f = await fixture(t), store = new LibraryCaptures(f.io), data = capture();
  const first = await store.save(data, png()), path = store.imagePath(first);
  for (const key of ["failImages", "failMetadata"]) {
    f.state[key] = true;
    await assert.rejects(store.save({ ...data, text: "Must not publish" }, png()), /unavailable/);
    assert.equal(store.get(data.id), first);
    assert.equal(f.notifications, 1);
    assert.ok((await readFile(path)).length > 0);
    assert.deepEqual((await readdir(f.directory)).filter(x => x.endsWith(".png")), [first.image]);
    f.state[key] = false;
  }
  const next = await store.save({ ...data, text: "Retry succeeded" }, png());
  assert.equal(store.get(data.id), next);
});

test("queued writes and deletion cannot resurrect a removed capture", async t => {
  const f = await fixture(t), store = new LibraryCaptures(f.io), data = capture();
  const operations = [store.save(data, png()), store.save({ ...data, text: "new" }, png()), store.remove(data.id)];
  const [, , removed] = await Promise.all(operations);
  assert.equal(removed, true); assert.deepEqual(store.items, []);
  assert.deepEqual(await readdir(f.directory), ["captures.json"]);
  const reopened = new LibraryCaptures(f.io); await reopened.ready;
  assert.deepEqual(reopened.items, []);
  assert.equal(await reopened.remove(data.id), false);
});

test("failed deletion metadata keeps the capture, while interrupted byte cleanup is retryable", async t => {
  const f = await fixture(t), store = new LibraryCaptures(f.io), data = capture();
  const item = await store.save(data, png()), path = store.imagePath(item);
  f.state.failMetadata = true;
  await assert.rejects(store.remove(item.id), /metadata/);
  assert.equal(store.get(item.id), item); assert.ok((await readFile(path)).length);
  f.state.failMetadata = false; f.state.failRemoval = true;
  assert.equal(await store.remove(item.id), true);
  assert.deepEqual(store.items, []);
  assert.deepEqual((await f.io.read()).garbage, [item.image]);
  const reopened = new LibraryCaptures(f.io); await reopened.ready;
  assert.deepEqual(reopened.items, [], "pending image cleanup cannot restore the record");
  f.state.failRemoval = false;
  const next = await reopened.save(capture(), png());
  await assert.rejects(readFile(path), { code: "ENOENT" });
  assert.ok((await readFile(reopened.imagePath(next))).length);
  assert.deepEqual((await f.io.read()).garbage, []);
});

test("invalid stores do not expose partial records or overwrite existing metadata", async t => {
  const f = await fixture(t), valid = { ...capture(), image: randomUUID() + ".png", bytes: png().length };
  const cases = [
    { version: 99, captures: [], garbage: [] },
    { version: 1, captures: [valid, { ...valid, id: randomUUID(), image: "../outside.png" }], garbage: [] },
    { version: 1, captures: [valid, valid], garbage: [] },
    { version: 1, captures: [valid, { ...valid, id: randomUUID() }], garbage: [] },
    { version: 1, captures: [valid], garbage: [valid.image] },
    { version: 1, captures: [], garbage: ["../outside.png"] },
  ];
  for (const data of cases) {
    await writeFile(f.manifest, JSON.stringify(data));
    const store = new LibraryCaptures(f.io);
    await assert.rejects(store.ready);
    assert.deepEqual(store.items, []);
    await assert.rejects(store.save(capture(), png()));
    assert.deepEqual(await f.io.read(), data);
  }
  assert.equal(f.writes, 0);
});

test("invalid capture inputs and reused image IDs never replace a live file", async t => {
  const f = await fixture(t), store = new LibraryCaptures(f.io), data = capture();
  for (const invalid of [
    { ...data, id: "../outside" }, { ...data, createdDate: NaN },
    { ...data, captureType: "unknown" }, { ...data, captureLayoutInfo: null },
    { ...data, text: {} }, { ...data, url: null },
  ]) await assert.rejects(store.save(invalid, png()), TypeError);
  await assert.rejects(store.save(data, new Uint8Array([1, 2, 3])), TypeError);
  assert.equal(f.writes, 0);
  const first = await store.save(data, png());
  f.io.newID = () => first.image.slice(0, -4);
  await assert.rejects(store.save(capture(), png()), /reused/);
  assert.deepEqual(store.items, [first]);
  assert.deepEqual(new Uint8Array(await readFile(store.imagePath(first))), png());
});

test("recent captures are bounded by creation date and clearing preserves a failed commit", async t => {
  const f = await fixture(t), store = new LibraryCaptures(f.io);
  for (const date of [6, 2, 7, 1, 4, 5, 3]) await store.save(capture(undefined, date), png());
  assert.deepEqual(store.recent().map(item => item.createdDate), [7, 6, 5, 4]);
  assert.deepEqual(store.recent(2).map(item => item.createdDate), [7, 6]);
  assert.deepEqual(store.recent(0), []);
  assert.throws(() => store.recent(-1), RangeError);
  f.state.failMetadata = true;
  await assert.rejects(store.clear(), /metadata/);
  assert.equal(store.items.length, 7);
  assert.equal((await readdir(f.directory)).filter(name => name.endsWith(".png")).length, 7);
  f.state.failMetadata = false;
  assert.equal(await store.clear(), 7);
  assert.equal(await store.clear(), 0);
  assert.deepEqual(await readdir(f.directory), ["captures.json"]);
  assert.deepEqual((await f.io.read()).captures, []);
  assert.equal(f.notifications, 8);
});
