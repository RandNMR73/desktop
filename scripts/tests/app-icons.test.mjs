import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../../src/zen/common/sys/ZenAppIcons.sys.mjs", import.meta.url), "utf8").replaceAll("export ", "");
function fixture() {
  const rows = [{ slug: "neon", label: "Neon" }, { slug: "original", label: "The Original Arc" }];
  const calls = [], events = [];
  let selected = null, reads = 0;
  const api = { selected: () => selected, restore: () => calls.push("restore"),
    apply: slug => { calls.push(slug); selected = slug; return 0; } };
  const context = vm.createContext({ Services: { appinfo: { OS: "Darwin" },
    dirsvc: { get: () => ({ parent: { parent: { path: "/owned/Zen.app/Contents" } } }) },
    obs: { notifyObservers: (...args) => events.push(args) } }, Ci: { nsIFile: {} },
    PathUtils: { join: (...parts) => parts.join("/"), toFileURI: path => "file://" + path },
    IOUtils: { readJSON: async () => { ++reads; return rows; } },
  });
  context.injected = api;
  const result = vm.runInContext(source + "\nbackend = injected; ({ZenAppIcons, validateIconCatalog})", context);
  return { ...result, api, calls, events, rows, context, reads: () => reads };
}


test("catalog rejects traversal, duplicates and invalid labels before constructing file URLs", () => {
  const f = fixture();
  for (const rows of [null, [], [{slug:"../icon",label:"Icon"}], [{slug:"neon",label:""}],
    [{slug:"neon",label:"One"},{slug:"neon",label:"Two"}]]) {
    assert.throws(() => f.validateIconCatalog(rows), /Invalid/);
  }
});

test("listing icons is cached, immutable, and never chooses an icon", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.ZenAppIcons.list(), f.ZenAppIcons.list()]);
  assert.equal(a, b); assert.equal(f.reads(), 1);
  assert.equal(Object.isFrozen(a[0]), true);
  assert.equal(a[0].preview, "file:///owned/Zen.app/Contents/Resources/zen-app-icons/arc-neon-preview.png");
  assert.equal(f.ZenAppIcons.selected, null);
  assert.equal(f.calls.length, 0);
});

test("failed catalog reads can recover on the next request", async () => {
  const f = fixture(); let fail = true;
  f.context.IOUtils.readJSON = async () => { if (fail) throw new Error("unavailable"); return f.rows; };
  await assert.rejects(f.ZenAppIcons.list(), /unavailable/);
  fail = false;
  assert.equal((await f.ZenAppIcons.list()).length, 2);
});

test("only catalog choices and explicit default restoration reach the native writer", async () => {
  const f = fixture();
  await assert.rejects(f.ZenAppIcons.choose("../arbitrary"), /Unknown/);
  assert.equal(f.calls.length, 0);
  await f.ZenAppIcons.choose("neon");
  assert.equal(f.ZenAppIcons.selected, "neon");
  assert.equal(f.events[0][2], "neon");
  await f.ZenAppIcons.choose("");
  assert.equal(f.ZenAppIcons.selected, "");
});

test("native failure preserves the current selection and never announces success", async () => {
  const f = fixture();
  await f.ZenAppIcons.choose("neon");
  f.api.apply = () => 3;
  await assert.rejects(f.ZenAppIcons.choose("original"), /macOS could not/);
  assert.equal(f.ZenAppIcons.selected, "neon"); assert.equal(f.events.length, 1);
});

test("opening multiple browser windows restores the running icon only once", () => {
  const f = fixture(); f.ZenAppIcons.restore(); f.ZenAppIcons.restore();
  assert.deepEqual(f.calls, ["restore"]);
});
