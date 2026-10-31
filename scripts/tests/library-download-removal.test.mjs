import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/zen/library/ZenLibraryFileMenu.sys.mjs", import.meta.url), "utf8")
  .replace(/^import .*;$/gm, "").replaceAll("export ", "");
function fixture({ privateWindow = false, persistenceFails = false } = {}) {
  const events = [], window = { privateWindow };
  const dependencies = {
    PlacesUtils: { history: {
      TRANSITIONS: { DOWNLOAD: 7 },
      canAddURI: uri => /^https?:/.test(uri.spec),
      removeVisitsByFilter: async filter => events.push(["visits", JSON.parse(JSON.stringify(filter))]),
    } },
    PrivateBrowsingUtils: { isWindowPrivate: win => win.privateWindow },
    Downloads: { ALL: "all", getList: async kind => {
      assert.equal(kind, "all"); return { remove: async item => events.push(["remove", item]) };
    } },
  };
  const context = vm.createContext({ console,
    ChromeUtils: { defineESModuleGetters: target => Object.assign(target, dependencies) },
    URL: { parse: value => { try { return { URI: { spec: new URL(value).href } }; } catch { return null; } } },
    libraryHiddenFiles: () => ({ hide: async (...args) => {
      if (persistenceFails) throw new Error("owned write failure");
      events.push(["hidden", ...args]);
    } }),
  });
  const { hideLibraryDownload: hide, removeLibraryDownloadHistory: removeHistory } = vm.runInContext(
    source + "\n({hideLibraryDownload,removeLibraryDownloadHistory})", context);
  const item = { source: { url: "https://cdn.example.invalid/final", originalUrl: "https://example.invalid/original" },
    target: { path: "/owned/report.json" }, finalize: async partial => events.push(["finalize", partial]) };
  return { events, item, window, hide, removeHistory };
}

test("hiding a redirected download targets only the original download visit and suppresses its disk fallback", async () => {
  const f = fixture(); await f.hide(f.window, f.item);
  assert.deepEqual(f.events, [
    ["hidden", "/owned/report.json", true],
    ["visits", { url: "https://example.invalid/original", transition: 7 }],
    ["remove", f.item], ["finalize", true],
  ]);
});

test("private hiding leaves persistent paths and history untouched", async () => {
  for (const privateWindow of [true, false]) {
    const f = fixture({ privateWindow }); f.item.source.isPrivate = true;
    await f.hide(f.window, f.item);
    assert.deepEqual(f.events, [["remove", f.item], ["finalize", true]]);
  }
});

test("discovered files update only their hidden-file store, with no browser download finalization", async () => {
  const f = fixture(); f.item._zenDiskFile = true;
  await f.hide(f.window, f.item);
  assert.deepEqual(f.events, [["hidden", "/owned/report.json", false]]);
});

test("blocked downloads retain their security cleanup before finalization", async () => {
  for (const blockedData of [true, false]) {
    const f = fixture(); f.item.hasBlockedData = blockedData;
    f.item.error = { becauseBlockedByContentAnalysis: true };
    f.item.confirmBlock = async () => f.events.push(["confirm block"]);
    f.item.respondToContentAnalysisWarnWithBlock = async () => f.events.push(["respond block"]);
    await f.hide(f.window, f.item);
    assert.deepEqual(f.events.slice(-2), [[blockedData ? "confirm block" : "respond block"], ["finalize", true]]);
  }
});

test("failed hidden-file persistence leaves the browser record and visits unchanged", async () => {
  const f = fixture({ persistenceFails: true });
  await assert.rejects(f.hide(f.window, f.item), /owned write failure/);
  assert.deepEqual(f.events, []);
});

test("history removal supports ordinary URLs and skips private, cleared, invalid and non-history sources", async () => {
  const f = fixture(); delete f.item.source.originalUrl;
  await f.removeHistory(f.item);
  assert.deepEqual(f.events, [["visits", { url: "https://cdn.example.invalid/final", transition: 7 }]]);
  for (const source of [{ url: "https://example.invalid/private", isPrivate: true },
    { url: "data:text/plain,owned" }, { url: "blob:https://example.invalid/id" }, {}, { url: "invalid URL" }]) {
    f.events.length = 0; await f.removeHistory({ source }); assert.deepEqual(f.events, []);
  }
});
