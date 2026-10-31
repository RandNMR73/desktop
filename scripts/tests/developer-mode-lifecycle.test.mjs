import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { ZenDeveloperSidebar } from "../../src/zen/urlbar/ZenDeveloperSidebar.sys.mjs";
import {
  developerSite,
  DeveloperModeSettings,
  DeveloperNavigation,
} from "../../src/zen/urlbar/ZenDeveloperModeState.mjs";

test("controller teardown releases sheets and window observers before recreation", () => {
  const observers = new Map();
  const events = new Map();
  const progress = new Set();
  const sheets = new Set();
  const browser = {
    currentURI: { spec: "about:blank" },
    isConnected: true,
    getAttribute: () => "0",
  };
  const tab = { linkedBrowser: browser, isConnected: true };
  const eventTarget = {
    addEventListener(type, listener) {
      if (!events.has(type)) events.set(type, new Set());
      events.get(type).add(listener);
    },
    removeEventListener: (type, listener) => events.get(type)?.delete(listener),
  };
  const window = {
    ...eventTarget,
    document: eventTarget,
    gBrowser: {
      selectedTab: tab,
      tabContainer: eventTarget,
      addTabsProgressListener: (listener) => progress.add(listener),
      removeTabsProgressListener: (listener) => progress.delete(listener),
    },
    windowUtils: {
      AUTHOR_SHEET: 1,
      loadSheetUsingURIString(uri) {
        if (sheets.has(uri)) throw new Error("duplicate sheet");
        sheets.add(uri);
      },
      removeSheetUsingURIString(uri) {
        sheets.delete(uri);
      },
    },
  };
  const source = fs
    .readFileSync(
      new URL("../../src/zen/urlbar/ZenDeveloperMode.sys.mjs", import.meta.url),
      "utf8",
    )
    .replace(/^import[\s\S]*?;\n/gm, "")
    .replace("export class", "class");
  const Controller = vm.runInNewContext(`${source}; ZenDeveloperMode`, {
    developerSite,
    DeveloperModeSettings,
    DeveloperNavigation,
    ZenDeveloperSidebar,
    PrivateBrowsingUtils: { isWindowPrivate: () => false },
    Services: {
      prefs: { getStringPref: () => "[]", addObserver() {} },
      obs: {
        addObserver(listener, topic) {
          if (!observers.has(topic)) observers.set(topic, new Set());
          observers.get(topic).add(listener);
        },
        removeObserver(listener, topic) {
          observers.get(topic).delete(listener);
        },
      },
    },
  });
  for (let i = 0; i < 3; i++) {
    const controller = new Controller(window);
    assert.equal(sheets.size, 1);
    assert.equal(progress.size, 1);
    assert.equal(observers.get("zen-developer-mode-changed").size, 1);
    controller.handleEvent({ type: "unload" });
    controller.destroy(); // Teardown is idempotent.
    assert.equal(sheets.size, 0);
    assert.equal(progress.size, 0);
    assert.ok([...events.values()].every((listeners) => listeners.size === 0));
    assert.equal(observers.get("zen-developer-mode-changed").size, 0);
  }
});
