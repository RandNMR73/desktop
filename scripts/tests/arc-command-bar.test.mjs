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
function fixture() {
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
  const urlbar = {
    value: "",
    view,
    searchMode: null,
    inputField: {},
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
    UrlbarShared: { RESULT_SOURCE: { TABS: 4 } },
    gURLBar: urlbar,
    document: {
      l10n: {
        setAttributes(input) {
          input.placeholder = "Search or Enter URL...";
        },
      },
    },
    XPCOMUtils: { defineLazyPreferenceGetter() {} },
    ChromeUtils: {
      importESModule() {
        return {
          registerZenUrlbarProviders() {},
          nsZenSiteDataPanel: class {},
        };
      },
    },
    window: {
      addEventListener() {},
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
    key(key) {
      (events.get("keydown") || []).slice(0, 1).forEach((f) => f({ key }));
    },
    results(context = view.queryContext) {
      listener.onQueryResults(context);
      listener.onQueryFinished(context);
    },
    flushFrames,
    get queries() {
      return queries;
    },
    get selections() {
      return selections;
    },
  };
}

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
