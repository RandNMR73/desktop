import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/zen/library/ZenLittleArchive.sys.mjs", import.meta.url), "utf8")
  .replace("export const ZenLittleArchive", "const ZenLittleArchive");
function fixture() {
  const globals = new Map(), observers = new Map(), windows = new Set();
  let nextId = 0, failRestore = false;
  const services = { startup: { shuttingDown: false },
    uuid: { generateUUID: () => ({ toString: () => `little-${++nextId}` }) },
    wm: { getEnumerator: () => windows },
    obs: { addObserver: (fn, topic) => observers.set(topic, fn), notifyObservers() {} },
  };
  const session = {
    getCustomGlobalValue: key => globals.get(key),
    setCustomGlobalValue: (key, value) => globals.set(key, value),
    getTabState: tab => JSON.stringify(tab.state),
    setTabState: (tab, state) => { if (failRestore) throw new Error("restore rejected"); tab.state = state; },
  };
  const deps = { SessionStore: session,
    PrivateBrowsingUtils: { isWindowPrivate: win => win.private },
    TabState: { copyFromCache: (key, state) => { if (key.final) Object.assign(state, key.final); } },
    TabStateFlusher: { flushWindow: win => win.flush.promise },
  };
  const context = vm.createContext({ Services: services, structuredClone, console,
    ChromeUtils: { defineESModuleGetters: target => Object.assign(target, deps) } });
  const archive = vm.runInContext(source + "\nZenLittleArchive", context);
  function window(privateWindow = false, url = "https://fixture.invalid/initial") {
    let resolve;
    const win = { private: privateWindow, closed: false,
      flush: { promise: new Promise(r => { resolve = r; }), resolve: () => resolve() },
      gZenWorkspaces: { activeWorkspace: "main" } };
    const tab = { state: { entries: [{ url, title: "Fixture" }], index: 1,
      zenArchiveReason: "manual", zenSyncId: "old-id" }, label: "Fixture",
      linkedBrowser: { permanentKey: {} }, hasAttribute: () => false };
    win.gBrowser = { tabs: [tab], getIcon: () => "", selectedTab: tab,
      addTrustedTab: () => { const created = {}; win.gBrowser.tabs.push(created); return created; },
      removeTab: removed => { win.gBrowser.tabs = win.gBrowser.tabs.filter(item => item !== removed); },
    };
    windows.add(win);
    return win;
  }
  return { archive, window, globals, observers, services,
    setFailRestore: value => { failRestore = value; } };
}

test("Little archive publishes immediately and updates final navigation without duplicating the record", async () => {
  const f = fixture(), win = f.window();
  const pending = f.archive.capture(win);
  const first = f.archive.getRecords(win)[0];
  assert.equal(first.state.zenArchiveLocation, "little");
  assert.equal(f.archive.getRecords(win).length, 1);
  win.gBrowser.tabs[0].linkedBrowser.permanentKey.final = {
    entries: [{ url: "https://fixture.invalid/final", title: "Final title" }], index: 1,
  };
  win.flush.resolve(); await pending;
  assert.equal(f.archive.getRecords(win).length, 1);
  assert.equal(f.archive.getRecords(win)[0].littleArchiveId, first.littleArchiveId);
  assert.equal(f.archive.getRecords(win)[0].title, "Final title");
});

test("clear and restore cancel pending final updates so removed records cannot reappear", async () => {
  for (const action of ["clear", "restore"]) {
    const f = fixture(), win = f.window();
    const pending = f.archive.capture(win), id = f.archive.getRecords(win)[0].littleArchiveId;
    if (action === "clear") f.archive.clear(win);
    else {
      const restored = f.archive.restore(win, id);
      assert.equal(restored.state.zenWorkspace, "main");
      assert.equal(restored.state.zenSyncId, undefined);
    }
    win.flush.resolve(); await pending;
    assert.equal(f.archive.getRecords(win).length, 0);
  }
});

test("private Little records stay out of persistent state and vanish with the last private context", async () => {
  const f = fixture(), normal = f.window(), privateWindow = f.window(true);
  const pending = f.archive.capture(privateWindow);
  assert.equal(f.archive.getRecords(privateWindow).length, 1);
  assert.equal(f.archive.getRecords(normal).length, 0);
  assert.equal(f.globals.size, 0);
  privateWindow.closed = true;
  f.observers.get("last-pb-context-exited")();
  privateWindow.flush.resolve(); await pending;
  assert.equal(f.archive.getRecords(privateWindow).length, 0);
  assert.equal(f.globals.size, 0);
});

test("failed restoration preserves the archive and removes its incomplete tab", async () => {
  const f = fixture(), win = f.window();
  const pending = f.archive.capture(win), id = f.archive.getRecords(win)[0].littleArchiveId;
  f.setFailRestore(true);
  assert.throws(() => f.archive.restore(win, id), /restore rejected/);
  assert.equal(f.archive.getRecords(win).length, 1);
  assert.equal(win.gBrowser.tabs.length, 1);
  win.flush.resolve(); await pending;
});

test("shutdown and empty Little windows do not create archive entries", async () => {
  const f = fixture(), normal = f.window();
  f.services.startup.shuttingDown = true;
  assert.equal(f.archive.capture(normal), undefined);
  assert.equal(f.archive.getRecords(normal).length, 0);
  f.services.startup.shuttingDown = false;
  const blank = f.window(false, "about:blank"), pending = f.archive.capture(blank);
  blank.flush.resolve(); await pending;
  assert.equal(f.archive.getRecords(blank).length, 0);
});
