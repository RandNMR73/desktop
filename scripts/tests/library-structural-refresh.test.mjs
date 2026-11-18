import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/zen/library/sections/ZenLibrarySpacesSection.mjs", import.meta.url), "utf8");
function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
}
function fixture() {
  const spaces = new Map(["a", "b"].map(id => [id, { tabsContainer: {} }]));
  const Section = vm.runInNewContext(`(class {
    #pendingTabs = new Set();
    #pendingSpaces = new Set();
    #tabCopies = new WeakMap();
    armed = 0;
    #armStripsRefresh() { this.armed++; }
    contains(node) { return !!node.inSection; }
    ${between("  #onStripEvent =", "  #refreshTimer =")}
    ${between("  #scheduleStripsRefresh(uuid)", "  #armStripsRefresh()")}
    dispatch(type, target, changed) { this.#onStripEvent({ type, target, detail: { changed } }); }
    remember(tab, copy) { this.#tabCopies.set(tab, { copy }); }
    get pending() { return this.#pendingSpaces === null ? null : Array.from(this.#pendingSpaces); }
    get tabs() { return Array.from(this.#pendingTabs); }
  })`, {
    SHOWN_ATTRIBUTES: ["label", "image", "pending", "muted", "soundplaying"],
    gBrowser: { isTab: node => node.localName === "tab" },
    gZenWorkspaces: { workspaceElement: id => spaces.get(id) },
  });
  const section = new Section();
  const tab = (id = "a", extra = {}) => {
    const attrs = new Map(id ? [["zen-workspace-id", id]] : []);
    return { localName: "tab", parentElement: spaces.get(id)?.tabsContainer,
      getAttribute: name => attrs.get(name) ?? null,
      hasAttribute: name => attrs.has(name), attrs, ...extra };
  };
  const copy = (id, extra = {}) => ({ isConnected: true, inSection: true,
    closest: () => ({ dataset: { uuid: id } }), ...extra });
  return { section, spaces, tab, copy };
}

test("ordinary open/close events target only their known normal Space", () => {
  for (const type of ["TabOpen", "TabClose"]) {
    const f = fixture(), tab = f.tab("b", { closing: type === "TabClose" });
    f.section.remember(tab, f.copy("b"));
    f.section.dispatch(type, tab);
    assert.deepEqual([...f.section.pending], ["b"]);
  }
});

test("assignment must agree with a connected normal container", () => {
  for (const kind of ["unassigned", "unknown", "wrong-parent", "detached", "nested"]) {
    const f = fixture();
    const tab = f.tab(kind === "unassigned" ? null : kind === "unknown" ? "missing" : "a");
    if (kind === "wrong-parent") tab.parentElement = f.spaces.get("b").tabsContainer;
    if (kind === "detached") tab.parentElement = null;
    if (kind === "nested") tab.parentElement = {};
    f.section.dispatch("TabOpen", tab);
    assert.equal(f.section.pending, null, kind);
  }
});

test("a connected copy in a previous Space retains global invalidation", () => {
  const f = fixture(), tab = f.tab("b");
  f.section.remember(tab, f.copy("a"));
  f.section.dispatch("TabClose", tab);
  assert.equal(f.section.pending, null);
});

test("detached or foreign copies do not force unrelated cards to rebuild", () => {
  for (const extra of [{ isConnected: false }, { inSection: false }]) {
    const f = fixture(), tab = f.tab("b");
    f.section.remember(tab, f.copy("a", extra));
    f.section.dispatch("TabOpen", tab);
    assert.deepEqual([...f.section.pending], ["b"]);
  }
});

test("pins, groups, Essentials, Glance and non-tab targets keep global fallback", () => {
  for (const kind of ["pinned", "group", "zen-essential", "zen-glance-tab", "non-tab"]) {
    for (const type of ["TabOpen", "TabClose"]) {
      const f = fixture(), tab = f.tab();
      if (kind === "pinned") tab.pinned = true;
      else if (kind === "group") tab.group = {};
      else if (kind === "non-tab") tab.localName = "tab-group";
      else tab.attrs.set(kind, "true");
      f.section.dispatch(type, tab);
      assert.equal(f.section.pending, null, `${type}: ${kind}`);
    }
  }
});

test("moves and structural group/pin/visibility notifications remain global", () => {
  for (const type of ["TabMove", "TabPinned", "TabUnpinned", "TabHide", "TabShow",
    "TabGrouped", "TabUngrouped", "TabGroupCreate", "TabGroupRemoved", "TabGroupRemovedFromDOM", "TabGroupMoved"]) {
    const f = fixture();
    f.section.dispatch(type, f.tab());
    assert.equal(f.section.pending, null, type);
  }
});

test("ordinary events in two Spaces accumulate both and keep pending attributes", () => {
  const f = fixture(), a = f.tab("a"), b = f.tab("b");
  f.section.dispatch("TabAttrModified", a, ["label"]);
  f.section.dispatch("TabOpen", a);
  f.section.dispatch("TabClose", b);
  assert.deepEqual([...f.section.pending], ["a", "b"]);
  assert.deepEqual([...f.section.tabs], [a]);
});

test("a global event dominates ordinary events in either order", () => {
  for (const types of [["TabMove", "TabOpen"], ["TabOpen", "TabMove", "TabClose"]]) {
    const f = fixture(), tab = f.tab();
    for (const type of types) f.section.dispatch(type, tab);
    assert.equal(f.section.pending, null);
  }
});

test("pre-assignment open followed by assignment cannot narrow a queued global refresh", () => {
  const f = fixture(), tab = f.tab(null);
  f.section.dispatch("TabOpen", tab);
  tab.attrs.set("zen-workspace-id", "b");
  tab.parentElement = f.spaces.get("b").tabsContainer;
  f.section.dispatch("TabOpen", tab);
  assert.equal(f.section.pending, null);
});

test("moves between open and flush retain global invalidation", () => {
  const f = fixture(), tab = f.tab("a");
  f.section.dispatch("TabOpen", tab);
  tab.attrs.set("zen-workspace-id", "b");
  tab.parentElement = f.spaces.get("b").tabsContainer;
  f.section.dispatch("TabMove", tab);
  assert.equal(f.section.pending, null);
});

test("copied events and irrelevant attributes do not schedule refreshes", () => {
  const f = fixture();
  f.section.dispatch("TabOpen", f.tab("a", { inSection: true }));
  f.section.dispatch("TabAttrModified", f.tab(), ["busy"]);
  assert.equal(f.section.armed, 0);
  assert.deepEqual([...f.section.pending], []);
});
