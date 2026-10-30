/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

// Exercise the real controller with deterministic browser events and frames.
const source = readFileSync(
  new URL("../../src/zen/urlbar/ZenUrlbarController.mjs", import.meta.url),
  "utf8",
)
  .replace(/^import .*UrlbarShared.*;$/m, "")
  .replace(
    "export class nsZenUrlbarController",
    "globalThis.Controller = class nsZenUrlbarController",
  );
function fixture(dismissed = false, modeEvents = false, little = {}) {
  const prefs = new Map([["zen.urlbar.search-info.dismissed", dismissed]]);
  const elements = [];
  const loadedModules = [];
  const windowEvents = new Map();
  let motionCalls = 0;
  const events = new Map(),
    frames = new Map(),
    timers = [];
  const attrs = new Map();
  let id = 0,
    listener,
    queries = 0,
    selections = 0;
  const view = {
    isOpen: true,
    visibleRowCount: 3,
    queryContext: { searchString: "" },
    index: -1,
    zenSelectDefaultResult() {
      this.selectedRowIndex = 0;
    },
    get selectedRowIndex() {
      return this.index;
    },
    set selectedRowIndex(value) {
      this.index = value;
      selections++;
    },
  };
  const element = () => {
    const handlers = new Map();
    const node = {
      append() {},
      setAttribute() {},
      contains: () => false,
      addEventListener(name, fn) {
        handlers.set(name, fn);
      },
      click() {
        handlers.get("click")?.();
      },
    };
    elements.push(node);
    return node;
  };
  const urlbar = {
    value: "",
    view,
    searchMode: null,
    style: { removeProperty() {}, setProperty() {} },
    inputField: { focus() {} },
    append() {},
    toggleAttribute(k, value) {
      if (value === undefined) value = !attrs.has(k);
      if (value) attrs.set(k, "");
      else attrs.delete(k);
    },
    controller: {
      addListener(l) {
        listener = l;
      },
    },
    _setPlaceholder() {},
    setPageProxyState() {},
    setAttribute(k, v) {
      attrs.set(k, v);
    },
    removeAttribute(k) {
      attrs.delete(k);
    },
    getAttribute(k) {
      return attrs.get(k);
    },
    hasAttribute(k) {
      return attrs.has(k);
    },
    addEventListener(k, f) {
      const list = events.get(k) || [];
      list.push(f);
      events.set(k, list);
    },
    startQuery() {
      queries++;
    },
  };
  const context = vm.createContext({
    Services: {
      prefs: {
        getBoolPref: (key, fallback) => prefs.get(key) ?? fallback,
        setBoolPref: (key, value) => prefs.set(key, value),
      },
    },
    UrlbarShared: { RESULT_SOURCE: { TABS: 4 } },
    gURLBar: urlbar,
    gBrowser: { selectedTab: { image: "https://fixture.invalid/favicon.ico", hasAttribute: () => false } },
    gReduceMotion: false,
    gZenUIManager: { motion: { animate() { motionCalls++; return Promise.resolve(); } } },
    gZenVerticalTabsManager: { _hasSetSingleToolbar: true },
    document: {
      documentElement: {
        hasAttribute: name => name === "zen-little-window" && !!little.attribute,
      },
      getElementById: () => ({ hidden: false, prepend() {}, addEventListener() {} }),
      createElementNS: element,
      l10n: {
        setAttributes(input) {
          input.placeholder = "Search or Enter URL…";
        },
      },
    },
    XPCOMUtils: { defineLazyPreferenceGetter() {} },
    ChromeUtils: {
      importESModule(uri) {
        loadedModules.push(uri);
        return {
          registerZenUrlbarProviders() {},
          nsZenSiteDataPanel: class {},
          ZenDeveloperMode: class { addressEditorAnchor() { return null; } },
        };
      },
    },
    window: {
      _zenLittleWindow: !!little.startup,
      _zenLittleWindowInput: !!little.input,
      addEventListener(name, callback) { windowEvents.set(name, callback); },
      requestAnimationFrame(fn) {
        frames.set(++id, fn);
        return id;
      },
      cancelAnimationFrame(i) {
        frames.delete(i);
      },
    },
    setTimeout(fn) {
      timers.push(fn);
    },
    console,
  });
  if (modeEvents) {
    let mode = null;
    Object.defineProperty(urlbar, "searchMode", {
      get() { return mode; },
      set(value) {
        mode = value;
        windowEvents.get("Zen:UrlbarSearchModeChanged")?.({ detail: { searchMode: value } });
      },
    });
    attrs.set("breakout-extend", "true");
  }
  vm.runInContext(source, context);
  const controller = new context.Controller();
  controller.init();
  const flushFrames = () => {
    const queue = [...frames.values()];
    frames.clear();
    queue.forEach((f) => f());
  };
  return {
    controller,
    window: context.window,
    loadedModules,
    prefs,
    elements,
    urlbar,
    view,
    frames,
    attrs,
    open() {
      controller.onUrlbarOpen();
      while (timers.length) timers.shift()();
    },
    input(value) {
      urlbar.value = value;
      (events.get("input") || []).forEach((f) => f({}));
    },
    blur() { (events.get("blur") || []).forEach(f => f({})); },
    key(key) {
      (events.get("keydown") || []).slice(0, 1).forEach((f) => f({ key }));
    },
    results(context = view.queryContext) {
      listener.onQueryResults(context);
      listener.onQueryFinished(context);
    },
    flushFrames,
    get motionCalls() { return motionCalls; },
    get queries() {
      return queries;
    },
    get selections() {
      return selections;
    },
  };
}

test("Little windows retain URL and site controls without loading the full Developer Mode toolbar", () => {
  for (const little of [{}, { startup: true }, { attribute: true }]) {
    const f = fixture(false, false, little);
    const expected = !little.startup && !little.attribute;
    assert.equal(!!f.window.gZenDeveloperMode, expected);
    assert.equal(f.loadedModules.some(uri => uri.endsWith("/ZenDeveloperMode.sys.mjs")), expected);
    assert.ok(f.window.gZenSiteDataPanel);
    f.open();
    assert.equal(f.queries, 1);
  }
});

test("empty opening queries once and coalesces selection into one frame", () => {
  const f = fixture();
  f.open();
  f.open();
  assert.equal(f.queries, 1);
  assert.equal(f.urlbar.searchMode.source, 4);
  f.view.isOpen = false;
  f.results();
  assert.equal(f.frames.size, 1);
  f.view.isOpen = true;
  f.flushFrames();
  assert.equal(f.view.selectedRowIndex, 0);
  assert.equal(f.selections, 1);
  f.results();
  f.flushFrames();
  assert.equal(f.selections, 1);
});
test("typing leaves the hidden tabs restriction before the native input query", () => {
  const f = fixture();
  f.open();
  f.view.isOpen = false;
  f.results();
  f.input("a web search");
  f.view.isOpen = true;
  f.flushFrames();
  assert.equal(f.urlbar.searchMode, null);
  assert.equal(f.selections, 0);
  assert.equal(f.attrs.has("zen-arc-open-tabs"), false);
  assert.equal(f.queries, 1, "no duplicate input query");
  f.input("");
  assert.equal(f.urlbar.searchMode.source, 4);
  assert.equal(f.queries, 1);
});
test("explicit engine/history/bookmark modes survive empty input and close", () => {
  for (const mode of [
    { engineName: "YouTube", isPreview: false },
    { source: 1, isPreview: false },
    { source: 2, isPreview: true },
  ]) {
    const f = fixture();
    f.urlbar.searchMode = mode;
    f.open();
    f.input("");
    f.controller.onUrlbarClose();
    assert.equal(f.urlbar.searchMode, mode);
    assert.equal(f.queries, 0);
  }
});
test("a site mode replacing the preview is never cleared by its old owner", () => {
  const f = fixture();
  f.open();
  const mode = { engineName: "YouTube", isPreview: false };
  f.urlbar.searchMode = mode;
  f.input("cats");
  assert.equal(f.urlbar.searchMode, mode);
});
test("arrow, Tab, Enter, and Escape cancel pending preselection", () => {
  for (const key of ["ArrowDown", "ArrowUp", "Tab", "Enter", "Escape"]) {
    const f = fixture();
    f.open();
    f.view.isOpen = false;
    f.results();
    f.key(key);
    f.view.isOpen = true;
    f.view.index = 1;
    f.flushFrames();
    f.results();
    f.flushFrames();
    assert.equal(f.view.index, 1, key);
    assert.equal(f.selections, 0, key);
  }
});
test("closing cancels pending work and reopening starts a fresh preview", () => {
  const f = fixture();
  f.open();
  f.view.isOpen = false;
  f.results();
  f.controller.onUrlbarClose();
  f.view.isOpen = false;
  f.flushFrames();
  assert.equal(f.urlbar.searchMode, null);
  assert.equal(f.selections, 0);
  f.open();
  assert.equal(f.queries, 1);
  f.view.isOpen = true;
  f.open();
  assert.equal(f.queries, 2);
});
test("stale query callbacks and empty/closed views cannot select a row", () => {
  const f = fixture();
  f.open();
  f.results({ searchString: "" });
  f.flushFrames();
  assert.equal(f.selections, 0);
  f.view.isOpen = false;
  f.results();
  f.flushFrames();
  assert.equal(f.selections, 0);
  f.view.isOpen = true;
  f.view.visibleRowCount = 0;
  f.results();
  f.flushFrames();
  assert.equal(f.selections, 0);
  f.view.visibleRowCount = 3;
  f.results();
  f.flushFrames();
  assert.equal(f.selections, 1);
});
test("an existing keyboard selection is not overwritten", () => {
  const f = fixture();
  f.open();
  f.view.index = 2;
  f.results();
  f.flushFrames();
  assert.equal(f.view.index, 2);
  assert.equal(f.selections, 0);
});

test("Firefox confirming a preview on query start does not lose ownership", () => {
  const f = fixture();
  f.open();
  f.urlbar.searchMode.isPreview = false;
  f.results();
  f.flushFrames();
  assert.equal(f.selections, 1);
  f.input("search the web");
  assert.equal(f.urlbar.searchMode, null);
});

test("a final result batch may rebuild the default selected row", () => {
  const f = fixture();
  f.open();
  f.results();
  f.flushFrames();
  f.view.index = -1;
  f.results();
  f.flushFrames();
  assert.equal(f.view.index, 0);
  f.key("ArrowDown");
  f.view.index = -1;
  f.results();
  f.flushFrames();
  assert.equal(f.view.index, -1);
});

test("dismissed search education does not allocate or expose its controls", () => {
  const f = fixture(true);
  f.open();
  assert.equal(f.attrs.has("zen-search-info-dismissed"), true);
  assert.equal(f.elements.length, 0);
  assert.equal(f.queries, 1);
});

test("Dismiss persists across reopen and a fresh controller", () => {
  const f = fixture();
  f.open();
  f.elements.find((x) => x.id === "zen-urlbar-search-info-dismiss").click();
  assert.equal(f.prefs.get("zen.urlbar.search-info.dismissed"), true);
  assert.equal(f.attrs.has("zen-search-info-dismissed"), true);
  const count = f.elements.length;
  f.controller.onUrlbarClose();
  f.open();
  assert.equal(f.elements.length, count);
  const restarted = fixture(f.prefs.get("zen.urlbar.search-info.dismissed"));
  restarted.open();
  assert.equal(restarted.elements.length, 0);
});


test("ordinary typing exits the automatic tabs preview without pulsing the panel", () => {
  const f = fixture(false, true);
  f.open();
  assert.equal(f.motionCalls, 0, "automatic preview entry is quiet");
  f.input("ordinary query");
  assert.equal(f.urlbar.searchMode, null);
  assert.equal(f.motionCalls, 0, "automatic preview exit is quiet");
  f.input("");
  f.input("second query");
  assert.equal(f.motionCalls, 0, "repeated empty/query transitions stay quiet");
});

test("a deliberate mode change after automatic preview cleanup still animates", async () => {
  const f = fixture(false, true);
  f.open();
  f.input("query");
  f.urlbar.searchMode = { source: 1, isPreview: false };
  assert.equal(f.motionCalls, 1);
  await Promise.resolve();
  f.urlbar.searchMode = null;
  assert.equal(f.motionCalls, 2, "deliberate mode exit retains its feedback");
});


test("Little empty search retains normal navigation sources rather than Tabs search mode", () => {
  const f = fixture(false, false, {startup:true, input:true});
  f.open();
  assert.equal(f.urlbar.searchMode, null);
  assert.equal(f.queries, 1);
  assert.equal(f.urlbar.hasAttribute("zen-arc-open-tabs"), true);
  assert.equal(f.urlbar.hasAttribute("zen-little-url-editor"), false);
});

test("loaded Little editor preserves its address while querying its preview", () => {
  const f = fixture(false, false, {startup:true});
  f.urlbar.value = "https://fixture.invalid/current";
  f.open();
  assert.equal(f.urlbar.value, "https://fixture.invalid/current");
  assert.equal(f.urlbar.hasAttribute("zen-little-url-editor"), true);
  assert.equal(f.urlbar.hasAttribute("zen-arc-url-editor"), false);
  assert.equal(f.queries, 1);
  assert.equal(f.urlbar.searchMode, null);
});

test("keyboard address preview preserves the selected URL and preselects a real result", () => {
  const f = fixture();
  f.urlbar.value = "https://fixture.invalid/current";
  f.attrs.set("pageproxystate", "valid");
  f.open();
  assert.equal(f.urlbar.value, "https://fixture.invalid/current");
  assert.equal(f.urlbar.hasAttribute("zen-arc-address-preview"), true);
  assert.equal(f.urlbar.hasAttribute("zen-arc-url-editor"), false, "centered geometry stays independent");
  assert.equal(f.urlbar.searchMode, null);
  assert.equal(f.queries, 1);
  f.results();
  assert.equal(f.view.selectedRowIndex, 0);
  f.input("changed query");
  assert.equal(f.urlbar.hasAttribute("zen-arc-address-preview"), false);
  assert.equal(f.urlbar.hasAttribute("zen-arc-open-tabs"), false);
  f.view.index = -1;
  f.results();
  assert.equal(f.view.selectedRowIndex, -1, "late preview results do not override a typed search");
});

test("typed URLs and explicit search modes never enter current-address preview", () => {
  for (const kind of ["typed", "search-mode", "new-tab"]) {
    const f = fixture();
    f.urlbar.value = "https://fixture.invalid/current";
    f.attrs.set("pageproxystate", "valid");
    if (kind === "typed") f.urlbar.valueIsTyped = true;
    if (kind === "search-mode") f.urlbar.searchMode = { engineName: "Chosen engine" };
    if (kind === "new-tab") f.attrs.set("zen-newtab", "true");
    f.open();
    assert.equal(f.urlbar.hasAttribute("zen-arc-address-preview"), false, kind);
  }
});

test("closing the address preview clears its mode before a blank new-tab query", () => {
  const f = fixture();
  f.urlbar.value = "https://fixture.invalid/current";
  f.attrs.set("pageproxystate", "valid");
  f.open();
  f.controller.onUrlbarClose();
  assert.equal(f.urlbar.hasAttribute("zen-arc-address-preview"), false);
  assert.equal(f.urlbar.hasAttribute("zen-arc-open-tabs"), false);
  f.attrs.set("zen-newtab", "true");
  f.urlbar.value = "";
  f.open();
  assert.equal(f.urlbar.searchMode.source, 4);
  assert.equal(f.urlbar.hasAttribute("zen-arc-address-preview"), false);
});

test("an address preview replaces cached startup-tab results even after external focus cleanup", () => {
  const f = fixture();
  delete f.window._zenLittleWindow;
  f.open();
  assert.equal(f.urlbar.hasAttribute("zen-little-url-editor"), false);
  assert.equal(f.queries, 1);
  f.urlbar.searchMode = null;
  f.urlbar.value = "https://fixture.invalid/current";
  f.attrs.set("pageproxystate", "valid");
  f.open();
  assert.equal(f.queries, 2, "address destinations get a fresh query");
  assert.equal(f.urlbar.hasAttribute("zen-arc-address-preview"), true);
  assert.equal(f.urlbar.hasAttribute("zen-little-url-editor"), false);
  f.results();
  assert.equal(f.view.selectedRowIndex, 0);
});

test("Escape and blur clear a prepared preview before its popover opens", () => {
  for (const cancel of [f => f.key("Escape"), f => f.blur()]) {
    const f = fixture(); f.view.isOpen = false;
    f.attrs.set("zen-arc-address-preview", ""); f.attrs.set("zen-arc-open-tabs", "");
    cancel(f);
    assert.ok(!f.attrs.has("zen-arc-address-preview"));
    assert.ok(!f.attrs.has("zen-arc-open-tabs"));
    assert.equal(f.view.isOpen, false);
  }
});
