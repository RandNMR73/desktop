import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/zen/library/ZenLibraryFileMenu.sys.mjs", import.meta.url), "utf8")
  .replace(/^import .*;$/gm, "").replaceAll("export ", "");
function fixture() {
  const capture = { id: "owned-capture", url: "https://example.invalid/source", image: "owned.png" };
  const events = [], store = { ready: Promise.resolve(), current: capture,
    get() { return this.current; }, async remove(id, expected) { events.push(["delete", id, expected]); } };
  const context = vm.createContext({
    console, libraryCaptures: () => store,
    ChromeUtils: { defineESModuleGetters() {} },
    ZenDownloadPreview: class { async fileAction(item, action) {
      events.push([action, item.target.path]); return { succeeded: true };
    } destroy() {} },
    Cc: { "@mozilla.org/widget/clipboardhelper;1": { getService: () => ({ copyString: text => events.push(["copy-source", text]) }) } },
    Ci: { nsIClipboardHelper: {} },
  });
  const { ZenLibraryFileMenu: Menu, fileMenuOrder } = vm.runInContext(source + "\n({ZenLibraryFileMenu,fileMenuOrder})", context);
  const menu = new Menu({ openWebLinkIn: (...args) => events.push(["navigate", ...args]) },
    { onChange: (_item, action) => events.push(["changed", action]) });
  const item = { _zenLibraryCapture: capture, target: { path: "/owned/capture.png" } };
  return { menu, item, events, store, fileMenuOrder };
}

test("capture hover and preview expose their distinct Arc menu orders", () => {
  const f = fixture();
  assert.deepEqual(Array.from(f.fileMenuOrder({ completed: true, capture: true })),
    ["copy", "separator", "message", "airdrop", "separator", "open-source", "copy-source", "separator", "delete-capture"]);
  assert.deepEqual(Array.from(f.fileMenuOrder({ completed: true, capture: true, presentation: "preview" })),
    ["copy", "copy-source", "open-source", "separator", "message", "airdrop", "separator", "delete-capture"]);
  assert.deepEqual(Array.from(f.fileMenuOrder({ completed: true, presentation: "media" })),
    ["copy", "separator", "message", "airdrop", "separator", "show", "separator", "hide"]);
});

test("capture commands use source URLs and owned image bytes; deletion retains revision identity", async () => {
  const f = fixture();
  for (const action of ["copy", "message", "airdrop", "open-source", "copy-source", "delete-capture"])
    await f.menu.execute(action, f.item);
  assert.deepEqual(f.events.filter(([name]) => name !== "changed"), [
    ["copy", "/owned/capture.png"], ["message", "/owned/capture.png"], ["airdrop", "/owned/capture.png"],
    ["navigate", f.item._zenLibraryCapture.url, "tab"], ["copy-source", f.item._zenLibraryCapture.url],
    ["delete", f.item._zenLibraryCapture.id, f.item._zenLibraryCapture],
  ]);
  for (const action of ["hide", "trash", "show", "open"]) await assert.rejects(f.menu.execute(action, f.item), /Invalid capture/);
});

test("stale capture menus and failed removals publish no successful action", async () => {
  const f = fixture(); f.store.current = { ...f.item._zenLibraryCapture };
  await assert.rejects(f.menu.execute("copy", f.item), /no longer current/);
  assert.deepEqual(f.events, []);
  f.store.current = f.item._zenLibraryCapture;
  f.store.remove = async () => { throw new Error("write failed"); };
  await assert.rejects(f.menu.execute("delete-capture", f.item), /write failed/);
  assert.deepEqual(f.events, []);
});
