import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/zen/tabs/ZenTabRenamer.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\n/m, "");
function fixture() {
  let current = { uuid: "target", name: "Original", icon: "old", theme: "old" };
  let privateWindow = false, finish, bag, opens = 0, writes = 0, failLocalization = false;
  let signal;
  const ready = new Promise(resolve => { signal = resolve; });
  const manager = {
    activeWorkspace: "target",
    get privateWindowOrDisabled() { return privateWindow; },
    getWorkspaceFromId(id) { return current?.uuid === id ? current : null; },
    getWorkspaceDisplayName(space) { return space.name || "Space 1"; },
    saveWorkspace(space) { current = space; writes++; },
  };
  const window = { closed: false, gDialogBox: { open(url, args) {
    assert.equal(url, "chrome://browser/content/zen-dialogs/favorite-rename.html");
    opens++; bag = args; signal(); return new Promise(resolve => { finish = resolve; });
  } } };
  const context = vm.createContext({
    window, gZenWorkspaces: manager,
    document: { l10n: { async formatValues(requests) {
      if (failLocalization) throw new Error("fixture localization failure");
      return [`Rename “${requests[0].args.name}”`, "Rename", "Cancel"];
    } } },
    Ci: { nsIPrompt: { MODAL_TYPE_WINDOW: 1 } },
    ChromeUtils: { importESModule() { return { PromptUtils: {
      objectToPropBag: args => ({ ...args }),
      propBagToObject: (from, to) => Object.assign(to, from),
    } }; } },
    nsZenDOMOperatedFeature: class {},
  });
  vm.runInContext(source, context);
  return {
    renamer: window.gZenTabRenamer, window, manager, ready,
    get current() { return current; }, get opens() { return opens; },
    get writes() { return writes; }, get bag() { return bag; },
    replace(value) { current = value; },
    private(value) { privateWindow = value; },
    failLocalization(value) { failLocalization = value; },
    finish(ok, value = bag.value) { Object.assign(bag, { ok, value }); finish(); },
  };
}

test("Space cancel leaves the stored name untouched", async () => {
  const f = fixture(), pending = f.renamer.renameWorkspace(); await f.ready;
  assert.equal(f.bag.title, "Rename “Original”"); assert.equal(f.bag.value, "Original");
  f.finish(false, "Discarded"); assert.equal(await pending, false);
  assert.equal(f.current.name, "Original"); assert.equal(f.writes, 0);
});
test("rename trims boundaries and preserves internal whitespace", async () => {
  const f = fixture(), pending = f.renamer.renameWorkspace(); await f.ready;
  f.finish(true, "  A   B  "); assert.equal(await pending, true);
  assert.equal(f.current.name, "A   B");
});
test("an empty name remains empty in storage", async () => {
  const f = fixture(), pending = f.renamer.renameWorkspace(); await f.ready;
  f.finish(true, " \t "); await pending; assert.equal(f.current.name, "");
});
test("an unnamed Space prefills its generated display name", async () => {
  const f = fixture(); f.replace({ uuid: "target", name: "" });
  const pending = f.renamer.renameWorkspace(); await f.ready;
  assert.equal(f.bag.value, "Space 1"); f.finish(false); await pending;
  assert.equal(f.current.name, "");
});
test("unchanged long names are not abbreviated or rewritten", async () => {
  const f = fixture(), name = "1234567890".repeat(10); f.replace({ uuid: "target", name });
  const pending = f.renamer.renameWorkspace(); await f.ready;
  assert.equal(f.bag.value, name); f.finish(true); await pending;
  assert.equal(f.current.name, name); assert.equal(f.writes, 0);
});
test("another modal rename cannot replace the active sheet", async () => {
  const f = fixture(), pending = f.renamer.renameWorkspace(); await f.ready;
  assert.equal(await f.renamer.renameWorkspace(), false); assert.equal(f.opens, 1);
  f.finish(false); await pending;
});
test("accept re-reads the model and retains concurrent edits", async () => {
  const f = fixture(), pending = f.renamer.renameWorkspace(); await f.ready;
  f.replace({ uuid: "target", name: "Other window", icon: "new", theme: "new" });
  f.manager.activeWorkspace = "unrelated"; f.finish(true, "Renamed"); await pending;
  assert.equal(f.current.name, "Renamed"); assert.equal(f.current.icon, "new");
  assert.equal(f.current.theme, "new");
});
test("accept never recreates a deleted Space", async () => {
  const f = fixture(), pending = f.renamer.renameWorkspace(); await f.ready;
  f.replace(null); f.finish(true, "Lost target"); assert.equal(await pending, false);
  assert.equal(f.current, null); assert.equal(f.writes, 0);
});
test("missing and private-window Spaces cannot open a sheet", async () => {
  const f = fixture(); assert.equal(await f.renamer.renameWorkspace("missing"), false);
  f.private(true); assert.equal(await f.renamer.renameWorkspace(), false);
  assert.equal(f.opens, 0);
});
test("failed localization releases the modal guard", async () => {
  const f = fixture(); f.failLocalization(true);
  await assert.rejects(f.renamer.renameWorkspace(), /fixture localization failure/);
  f.failLocalization(false); const pending = f.renamer.renameWorkspace(); await f.ready;
  f.finish(false); assert.equal(await pending, false); assert.equal(f.opens, 1);
});
test("closing the owner during localization cannot show a stale sheet", async () => {
  const f = fixture(); const pending = f.renamer.renameWorkspace(); f.window.closed = true;
  assert.equal(await pending, false); assert.equal(f.opens, 0);
});
