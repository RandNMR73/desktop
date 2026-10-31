import assert from "node:assert/strict";
import test from "node:test";
import { LibraryHiddenFiles } from "../../src/zen/library/ZenLibraryHiddenFiles.sys.mjs";

function fixture(initial = { version: 1, paths: [] }) {
  let saved = initial, notifications = 0, fail = false;
  const options = { path: "/owned/hidden.json", read: async () => saved,
    write: async value => { if (fail) throw new Error("disk full"); saved = structuredClone(value); },
    notify: () => notifications++ };
  return { store: new LibraryHiddenFiles(options), reload: () => new LibraryHiddenFiles(options),
    get saved() { return saved; }, get notifications() { return notifications; },
    set fail(value) { fail = value; } };
}

test("concurrent hides persist without losing paths and survive relaunch", async () => {
  const f = fixture();
  await Promise.all([f.store.hide("/owned/a"), f.store.hide("/owned/b"), f.store.hide("/owned/a")]);
  assert.deepEqual(f.saved.paths, ["/owned/a", "/owned/b"]);
  assert.equal(f.notifications, 2);
  const reloaded = f.reload(); await reloaded.ready;
  assert.ok(reloaded.has("/owned/a") && reloaded.has("/owned/b"));
});

test("removing a browser record suppresses its hover fallback without hiding Media", async () => {
  const f = fixture(); await f.store.hide("/owned/a", true);
  assert.equal(f.store.has("/owned/a"), false);
  assert.equal(f.store.hasDownload("/owned/a"), true);
  const reloaded = f.reload(); await reloaded.ready;
  assert.equal(reloaded.hasDownload("/owned/a"), true);
  await reloaded.hide("/owned/a");
  assert.equal(reloaded.has("/owned/a"), true);
});

test("a failed write leaves the file visible, emits nothing and permits retry", async () => {
  const f = fixture(); f.fail = true;
  await assert.rejects(f.store.hide("/owned/a"), /disk full/);
  assert.equal(f.store.has("/owned/a"), false);
  assert.equal(f.notifications, 0);
  f.fail = false; await f.store.hide("/owned/a");
  assert.equal(f.store.has("/owned/a"), true);
  assert.equal(f.notifications, 1);
});

test("malformed persistent metadata is never replaced with an empty store", async () => {
  for (const data of [{ version: 2, paths: [] }, { version: 1, paths: [null] },
    { version: 1, paths: [], downloadPaths: false }]) {
    const f = fixture(data);
    await assert.rejects(f.store.ready);
    await assert.rejects(f.store.hide("/owned/a"));
    assert.equal(f.saved, data);
    assert.equal(f.notifications, 0);
  }
});
