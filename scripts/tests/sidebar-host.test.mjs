import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../../src/zen/urlbar/ZenUrlbarController.mjs", import.meta.url),
  "utf8",
)
  .replace(/^import .*;\n/m, "")
  .replace("export class", "class");

function fixture() {
  const state = {
    expanded: false,
    single: true,
    domain: true,
    parsed: 0,
    value: "example.com",
    uri: "http://www.example.com:8080/a%20b?q=%2F#part",
    proxy: "valid",
    typed: false,
    newtab: false,
    mode: null,
    writes: 0,
  };
  const parse = (spec) => {
    state.parsed++;
    const url = new URL(spec);
    return {
      schemeIs: (scheme) => url.protocol === scheme + ":",
      displayHost: url.hostname,
      displaySpec: url.href,
    };
  };
  const context = vm.createContext({
    gURLBar: {
      hasAttribute: (name) =>
        name === "zen-newtab"
          ? state.newtab
          : name === "breakout-extend" && state.expanded,
      getAttribute: () => state.proxy,
      get valueIsTyped() {
        return state.typed;
      },
      get searchMode() {
        return state.mode;
      },
      get value() {
        return state.value;
      },
      setValue(value) {
        state.value = value;
        state.writes++;
      },
      setSelectionRange(start, end) {
        state.selection = [start, end];
      },
    },
    gBrowser: {
      selectedBrowser: {
        get currentURI() {
          return state.uri;
        },
      },
    },
    gZenVerticalTabsManager: {
      get _hasSetSingleToolbar() {
        return state.single;
      },
    },
    XPCOMUtils: {
      defineLazyPreferenceGetter(target, key) {
        if (key === "showDomainOnly")
          Object.defineProperty(target, key, { get: () => state.domain });
      },
    },
    BrowserUIUtils: {
      removeSingleTrailingSlashFromURL: (value) => value.replace(/\/$/, ""),
      trimURL: (value) => "firefox:" + value,
    },
    Services: { io: { newURI: parse, createExposableURI: parse } },
    setTimeout() {},
  });
  vm.runInContext(
    source + "\nglobalThis.controller = new nsZenUrlbarController();",
    context,
  );
  return {
    state,
    trim: (value) => context.controller.trimURL(value),
    open: () => context.controller.onUrlbarOpen(),
  };
}

test("HTTP and HTTPS sidebar labels omit path, query, port and credentials", () => {
  const { trim } = fixture();
  for (const scheme of ["http", "https"]) {
    assert.equal(
      trim(`${scheme}://www.example.com:8080/a/b?query=long#part`),
      "example.com",
    );
    assert.equal(
      trim(`${scheme}://fixture:synthetic@example.com:8080/a`),
      "example.com",
    );
    assert.equal(trim(`${scheme}://127.0.0.1:8080/a?query=long`), "127.0.0.1");
    assert.equal(
      trim(`${scheme}://notwww.example.com/a`),
      "notwww.example.com",
    );
  }
});

test("expanded editor preserves every address byte without parsing", () => {
  const { state, trim } = fixture();
  state.expanded = true;
  const value = "http://www.example.com:8080/a%20b?q=%2F#part";
  assert.equal(trim(value), value);
  assert.equal(state.parsed, 0);
});

test("other layouts and domain-only opt-out retain the Firefox formatter", () => {
  const { state, trim } = fixture();
  state.single = false;
  assert.equal(trim("http://example.com/a"), "firefox:http://example.com/a");
  state.single = true;
  state.domain = false;
  assert.equal(trim("http://example.com/a"), "firefox:http://example.com/a");
  assert.equal(state.parsed, 0);
});

test("non-web schemes and malformed input retain their existing display", () => {
  const { trim } = fixture();
  for (const value of [
    "about:preferences",
    "file:///tmp/fixture.html",
    "data:text/plain,fixture",
    "not a URL",
    "http://[",
  ]) {
    assert.equal(trim(value), value);
  }
});

test("opening the editor synchronously restores and selects the full page address", () => {
  const { state, open } = fixture();
  open();
  assert.equal(state.value, state.uri);
  assert.deepEqual(state.selection, [0, state.uri.length]);
  assert.equal(state.writes, 1);
});

test("opening preserves typed queries, new-tab pickers, modes and invalid-page input", () => {
  for (const override of [
    { typed: true },
    { newtab: true },
    { mode: { engineName: "fixture" } },
    { proxy: "invalid" },
    { single: false },
    { domain: false },
  ]) {
    const { state, open } = fixture();
    Object.assign(state, override, { value: "unfinished search" });
    open();
    assert.equal(state.value, "unfinished search");
    assert.equal(state.writes, 0);
    assert.equal(state.parsed, 0);
  }
});

test("opening leaves non-web pages and unavailable page URIs intact", () => {
  for (const uri of [
    "about:preferences",
    "file:///tmp/fixture.html",
    "not a URI",
  ]) {
    const { state, open } = fixture();
    state.uri = uri;
    open();
    assert.equal(state.value, "example.com");
    assert.equal(state.writes, 0);
  }
});
