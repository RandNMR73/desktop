import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/zen/split-view/ZenViewSplitter.mjs", import.meta.url), "utf8");
const method = source.slice(source.indexOf("  setAccessiblePanels(owner, panels) {"), source.indexOf("  #applyGridLayout(splitNode) {"));
function fixture(platform = "macosx", initial = null) {
  let value = initial, writes = 0;
  const host = {
    getAttribute: () => value,
    setAttribute(name, next) { assert.equal(name, "aria-owns"); value = next; writes++; },
    removeAttribute(name) { assert.equal(name, "aria-owns"); value = null; writes++; },
  };
  const handler = vm.runInNewContext(`new (class { #accessiblePanelOwners = new Map(); ${method} })()`, {
    AppConstants: { platform }, document: { getElementById: () => host },
  });
  return { set: (owner, ...ids) => handler.setAccessiblePanels(owner, ids.map(id => ({ id }))), get value() { return value; }, get writes() { return writes; } };
}

test("Peek and split can independently release a shared pane in either order", () => {
  for (const first of ["peek", "split"]) {
    const f = fixture();
    f.set("split", "source", "preview");
    f.set("peek", "preview");
    assert.equal(f.value, "source preview");
    f.set(first);
    assert.equal(f.value, first === "peek" ? "source preview" : "preview");
    f.set(first === "peek" ? "split" : "peek");
    assert.equal(f.value, null);
  }
});

test("repeated focus and resize requests do not mutate accessibility ownership", () => {
  const f = fixture();
  f.set("split", "first", "second");
  for (let i = 0; i < 100; i++) f.set("split", "first", "second");
  f.set("peek");
  assert.equal(f.writes, 1);
});

test("reordering and removing a pane changes the owned order without stale IDs", () => {
  const f = fixture();
  f.set("split", "first", "second", "third");
  f.set("split", "third", "first");
  assert.equal(f.value, "third first");
  f.set("split");
  assert.equal(f.value, null);
});

test("foreign accessibility ownership survives split and Peek lifecycles", () => {
  const f = fixture("macosx", "unrelated");
  f.set("split", "first", "second");
  f.set("peek", "preview");
  f.set("split");
  assert.equal(f.value, "unrelated preview");
  f.set("peek");
  assert.equal(f.value, "unrelated");
});

test("empty and duplicate panel IDs cannot create invalid ownership tokens", () => {
  const f = fixture();
  f.set("split", "first", "", undefined, "first", "second");
  assert.equal(f.value, "first second");
});

test("other platforms retain their existing accessible tree", () => {
  for (const platform of ["linux", "win"]) {
    const f = fixture(platform, "unrelated");
    f.set("split", "first", "second");
    f.set("peek", "preview");
    assert.equal(f.value, "unrelated");
    assert.equal(f.writes, 0);
  }
});
