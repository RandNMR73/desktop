import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../../src/zen/spaces/ZenSpaceManager.mjs", import.meta.url),
  "utf8",
);
const method = source.slice(
  source.indexOf("  updateShouldHideSeparator("),
  source.indexOf("  onPinnedTabsResize("),
);
const Manager = vm.runInNewContext(`(class {
  get allStoredTabs() { throw new Error("Separator layout must not enumerate tabs"); }
  ${method}
})`);

function element(attributes = {}, properties = {}) {
  const attrs = new Map(Object.entries(attributes));
  return {
    hasAttribute: name => attrs.has(name),
    setAttribute: (name, value) => attrs.set(name, value),
    removeAttribute: name => attrs.delete(name),
    ...properties,
  };
}

const newTabButton = () => element();
const tab = (attributes = {}, properties = {}) => element(attributes, properties);

test("Today separator follows visible normal tabs without querying closability", () => {
  const manager = new Manager();
  const pinned = element({ "hide-separator": "true" });
  const cases = [
    { name: "empty Space", children: [newTabButton()], visible: false },
    { name: "one tab", children: [tab(), newTabButton()], visible: true },
    { name: "selected tab", children: [tab({ selected: "true" }), newTabButton()], visible: true },
    { name: "playing tab", children: [tab({ soundplaying: "true" }), newTabButton()], visible: true },
    { name: "hidden tab", children: [tab({ hidden: "true" }), newTabButton()], visible: false },
    { name: "closing tab", children: [tab({}, { closing: true }), newTabButton()], visible: false },
    { name: "empty placeholder", children: [tab({ "zen-empty-tab": "true" }), newTabButton()], visible: false },
    { name: "mixed children", children: [tab({ hidden: "true" }), tab(), tab({}, { closing: true }), newTabButton()], visible: true },
  ];
  for (const scenario of cases) {
    manager.updateShouldHideSeparator({ children: scenario.children }, pinned);
    assert.equal(!pinned.hasAttribute("hide-separator"), scenario.visible, scenario.name);
  }
});

test("selection-only updates preserve either separator state without examining children", () => {
  const manager = new Manager();
  const scrollbox = {
    get children() { throw new Error("Selection does not change tab structure"); },
  };
  for (const hidden of [false, true]) {
    const pinned = element(hidden ? { "hide-separator": "true" } : {});
    manager.updateShouldHideSeparator(scrollbox, pinned, true);
    assert.equal(pinned.hasAttribute("hide-separator"), hidden);
  }
});

test("visible separator keeps the existing bounded child scan", () => {
  const children = [newTabButton(), tab(), {
    hasAttribute() { throw new Error("Already found enough visible children"); },
  }];
  const pinned = element({ "hide-separator": "true" });
  new Manager().updateShouldHideSeparator({ children }, pinned);
  assert.equal(pinned.hasAttribute("hide-separator"), false);
});
