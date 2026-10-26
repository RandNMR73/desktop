/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL(
    "../../src/zen/sessionstore/ZenLittleWindow.sys.mjs",
    import.meta.url,
  ),
  "utf8",
)
  .replace(/^import .*;$/gm, "")
  .replace("export const ZenLittleWindow =", "globalThis.Little =");
function fixture() {
  const rows = [],
    handlers = new Map(),
    observers = new Map(),
    loads = [];
  const tracker = { getOrderedWindows: () => [] };
  let mutations = 0,
    created = 0;
  class Element {
    constructor(id) {
      this.id = id;
      this.attrs = new Map();
      this.hidden = false;
      this.disabled = false;
      this.listeners = new Map();
    }
    setAttribute(k, v) {
      this.attrs.set(k, String(v));
      if (k === "label") this.label = v;
    }
    removeAttribute(k) {
      this.attrs.delete(k);
    }
    addEventListener(k, fn) {
      this.listeners.set(k, fn);
    }
    get nextElementSibling() {
      return rows[rows.indexOf(this) + 1];
    }
    before(...nodes) {
      for (const node of nodes) {
        const i = rows.indexOf(node);
        if (i >= 0) rows.splice(i, 1);
      }
      rows.splice(rows.indexOf(this), 0, ...nodes);
      mutations++;
    }
  }
  for (const id of [
    "context-openlinkintab",
    "context-openlinkincontainertab",
    "context-openlinkinusercontext-menu",
    "context-openlink",
    "context-openlinkprivate",
    "context-zenOpenLinkInGlance",
    "context-zenSplitLink",
    "context-sep-open",
    "context-openlinkinsplitview",
  ])
    rows.push(new Element(id));
  const doc = {
    getElementById: (id) => rows.find((e) => e.id === id),
    createXULElement: () => {
      created++;
      return new Element();
    },
    documentElement: { setAttribute: (k, v) => handlers.set(k, v) },
  };
  const window = {
    document: doc,
    private: false,
    gZenViewSplitter: { canOpenLinkInSplitView: () => true },
    addEventListener: (name, fn) => handlers.set(name, fn),
    openLinkIn: (...args) => loads.push(args),
  };
  const prefs = new Map([["zen.little-window.enabled", true]]);
  const scope = {
    Services: {
      obs: {
        addObserver: (fn, topic) => observers.set(topic, fn),
        removeObserver: (fn, topic) => {
          assert.equal(observers.get(topic), fn);
          assert.ok(observers.delete(topic), "observer removed once");
        },
      },
    },
    XPCOMUtils: {
      defineLazyPreferenceGetter: (target, key, pref, def) =>
        Object.defineProperty(target, key, {
          get: () => prefs.get(pref) ?? def,
        }),
    },
    ChromeUtils: {
      defineESModuleGetters: (target) =>
        Object.assign(target, {
          PrivateBrowsingUtils: {
            enabled: true,
            isWindowPrivate: (w) => w.private,
          },
          ZenLittleWindowToolbar: class {},
          BrowserWindowTracker: tracker,
        }),
    },
  };
  vm.runInNewContext(source, scope);
  const context = {
    document: doc,
    window,
    onLink: true,
    linkURL: "https://example.invalid/a",
    linkURI: { schemeIs: (s) => s === "https" },
    contentData: { userContextId: 2 },
    showItem: (id, show) => {
      const e = typeof id === "string" ? doc.getElementById(id) : id;
      if (e) e.hidden = !show;
    },
    _getGlobalHistoryOptions: () => ({ globalHistoryOptions: { test: true } }),
    _openLinkInParameters: (extra) => ({
      triggeringPrincipal: "source-principal",
      referrerInfo: "source-referrer",
      ...extra,
    }),
  };
  window.gContextMenu = context;
  return {
    little: scope.Little,
    tracker,
    context,
    window,
    doc,
    rows,
    loads,
    prefs,
    observers,
    handlers,
    counts: () => ({ mutations, created }),
  };
}
test("opening group follows Arc order and reuses nodes without reparenting", () => {
  const f = fixture();
  f.little.updateLinkContextMenu(f.context);
  const first = f.counts();
  assert.deepEqual(
    f.rows
      .filter((e) => !e.hidden)
      .slice(0, 5)
      .map((e) => e.id),
    [
      "context-openlinkintab",
      "context-openlink",
      "context-zenSplitLink",
      "context-zenOpenLinkInLittleWindow",
      "context-openlinkprivate",
    ],
  );
  for (let i = 0; i < 20; i++) f.little.updateLinkContextMenu(f.context);
  assert.deepEqual(f.counts(), first);
  assert.equal(first.created, 1);
  assert.equal(
    f.doc
      .getElementById("context-openlinkintab")
      .attrs.get("data-usercontextid"),
    "2",
  );
});
test("menu activation reads the current context instead of retaining a stale link", () => {
  const f = fixture();
  f.little.updateLinkContextMenu(f.context);
  f.window.gContextMenu = {
    ...f.context,
    linkURL: "https://example.invalid/new",
  };
  f.doc
    .getElementById("context-zenOpenLinkInLittleWindow")
    .listeners.get("command")();
  assert.equal(f.loads[0][0], "https://example.invalid/new");
  assert.equal(f.loads[0][1], "window");
  assert.equal(f.loads[0][2].triggeringPrincipal, "source-principal");
  assert.equal(f.loads[0][2].referrerInfo, "source-referrer");
  assert.equal(f.loads[0][2].userContextId, 2);
});
test("unsupported schemes are visible but cannot open Little or Split previews", () => {
  for (const scheme of ["mailto", "tel", "javascript", "data"]) {
    const f = fixture();
    f.context.linkURI = { schemeIs: (s) => s === scheme };
    f.little.updateLinkContextMenu(f.context);
    for (const id of [
      "context-zenSplitLink",
      "context-zenOpenLinkInLittleWindow",
    ]) {
      assert.equal(f.doc.getElementById(id).hidden, false);
      assert.equal(f.doc.getElementById(id).disabled, true);
    }
    assert.equal(f.little.openContextLink(f.context), false);
    assert.equal(f.loads.length, 0);
  }
});
test("disabled feature and private windows reject Little actions", () => {
  const f = fixture();
  f.prefs.set("zen.little-window.enabled", false);
  f.little.updateLinkContextMenu(f.context);
  assert.equal(
    f.doc.getElementById("context-zenOpenLinkInLittleWindow").disabled,
    true,
  );
  assert.equal(f.little.openContextLink(f.context), false);
  f.prefs.set("zen.little-window.enabled", true);
  f.window.private = true;
  f.little.updateLinkContextMenu(f.context);
  assert.equal(f.doc.getElementById("context-openlink").hidden, false);
  assert.equal(f.doc.getElementById("context-openlinkprivate").disabled, true);
  assert.equal(
    f.doc.getElementById("context-zenOpenLinkInLittleWindow").disabled,
    true,
  );
  assert.equal(f.little.openContextLink(f.context), false);
  assert.equal(f.loads.length, 0);
});
test("Little startup role precedes display and observers clean up on early or normal close", () => {
  for (const early of [false, true]) {
    const f = fixture();
    f.little.prepareWindow(f.window);
    assert.equal(f.window._zenStartupSyncFlag, "unsynced");
    assert.equal(f.window._zenLittleWindow, true);
    assert.equal(f.observers.size, 2);
    assert.equal(
      f.handlers.has("unload"),
      false,
      "initial about:blank unload must not cancel window preparation",
    );
    if (!early) {
      const observer = f.observers.get("browser-window-before-show");
      observer({}, "browser-window-before-show");
      assert.equal(f.observers.size, 2);
      observer(f.window, "browser-window-before-show");
      assert.equal(f.handlers.get("zen-little-window"), "true");
    } else {
      f.observers.get("domwindowclosed")(f.window, "domwindowclosed");
      assert.equal(f.handlers.has("zen-little-window"), false);
    }
    assert.equal(f.observers.size, 0);
  }
});

test("Split opening preserves native load metadata and refuses unsupported links or a full split", () => {
  const splitter = readFileSync(
    new URL("../../src/zen/split-view/ZenViewSplitter.mjs", import.meta.url),
    "utf8",
  );
  const method = splitter.slice(
    splitter.indexOf("  splitLinkInNewTab() {"),
    splitter.indexOf("  contextShareSplitView() {"),
  );
  for (const [scheme, capacity] of [
    ["https", true],
    ["http", true],
    ["mailto", true],
    ["javascript", true],
    ["https", false],
  ]) {
    const f = fixture();
    const sourceTab = {},
      destinationTab = {};
    f.window.gBrowser = { selectedTab: sourceTab };
    f.context.linkURI = { schemeIs: (s) => s === scheme };
    const handler = vm.runInNewContext(`({${method}})`, {
      window: f.window,
      gZenGlanceManager: { getTabOrGlanceParent: (t) => t },
    });
    let opened = 0,
      split = 0;
    handler.canOpenLinkInSplitView = () => capacity;
    handler.openAndSwitchToTab = (url, options) => {
      opened++;
      assert.equal(url, f.context.linkURL);
      assert.equal(options.userContextId, 2);
      assert.equal(options.referrerInfo, "source-referrer");
      assert.equal(options.triggeringPrincipal, "source-principal");
      assert.equal(options.skipRoute, true);
      return destinationTab;
    };
    handler.splitTabs = (tabs) => {
      split++;
      assert.equal(tabs[0], sourceTab);
      assert.equal(tabs[1], destinationTab);
    };
    handler.splitLinkInNewTab();
    const eligible = capacity && ["http", "https"].includes(scheme);
    assert.equal(opened, Number(eligible));
    assert.equal(split, Number(eligible));
  }
});

test("Little promotion adopts once, selects the requested Space, and releases the in-flight guard", async () => {
  const f = fixture();
  const calls = [];
  const source = { isConnected: true };
  f.window.gBrowser = { selectedTab: source };
  f.window.close = () => {
    f.window.closed = true;
    calls.push("close");
  };
  let release;
  const target = {
    document: { documentElement: { hasAttribute: () => false } },
    gZenWorkspaces: {
      promiseInitialized: new Promise((resolve) => {
        release = resolve;
      }),
      activeWorkspace: "main",
      getWorkspaceFromId: (id) => id === "apt",
      async changeWorkspaceWithID(id) {
        calls.push(id);
        this.activeWorkspace = id;
      },
      moveTabToWorkspace(tab, id) {
        assert.equal(tab, source);
        calls.push("move:" + id);
      },
    },
    gBrowser: {
      adoptTab(tab, options) {
        assert.equal(tab, source);
        assert.equal(options.selectTab, true);
        calls.push("adopt");
        return tab;
      },
    },
    focus() {
      calls.push("focus");
    },
  };
  f.tracker.getOrderedWindows = () => [
    f.window,
    { ...target, closed: true },
    { ...target, _zenLittleWindow: true },
    target,
  ];
  const first = f.little.moveToMainWindow(f.window, "apt");
  assert.equal(f.little.moveToMainWindow(f.window, "apt"), first);
  release();
  assert.equal(await first, true);
  assert.deepEqual(calls, ["apt", "adopt", "move:apt", "focus", "close"]);
  assert.equal(f.window._zenLittleMovePromise, undefined);
});

test("Little promotion creates a synced main window and removes both startup observers on cancellation", async () => {
  const f = fixture();
  f.window.gBrowser = { selectedTab: { isConnected: true } };
  const target = { closed: false };
  f.tracker.openWindow = (options) => {
    assert.equal(options.zenSyncedWindow, true);
    return target;
  };
  const pending = f.little.moveToMainWindow(f.window, "apt");
  assert.equal(target._zenStartupSyncFlag, "synced");
  assert.equal(f.observers.size, 2);
  target.closed = true;
  f.observers.get("domwindowclosed")(target, "domwindowclosed");
  assert.equal(await pending, false);
  assert.equal(f.observers.size, 0);
  assert.equal(f.window._zenLittleMovePromise, undefined);
});

test("Little startup readiness ignores other windows and removes observers after startup", async () => {
  const f = fixture();
  const pending = f.little.waitForStartup(f.window);
  f.observers.get("browser-delayed-startup-finished")(
    {},
    "browser-delayed-startup-finished",
  );
  assert.equal(f.observers.size, 2);
  f.observers.get("browser-delayed-startup-finished")(
    f.window,
    "browser-delayed-startup-finished",
  );
  assert.equal(await pending, true);
  assert.equal(f.observers.size, 0);
  assert.equal(await f.little.waitForStartup({ closed: true }), false);
  assert.equal(
    await f.little.waitForStartup({
      gBrowserInit: { delayedStartupFinished: true },
    }),
    true,
  );
});
