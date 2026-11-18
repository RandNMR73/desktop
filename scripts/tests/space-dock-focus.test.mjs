import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/zen/spaces/ZenSpaceIcons.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "");

function fixture() {
  const document = { activeElement: null };
  let Collection;
  class Element {
    isConnected = true;
    visible = true;
    acceptsFocus = true;
    attributes = new Map();
    rect = { left: 20, top: 700, right: 220, bottom: 732, width: 200, height: 32 };
    checkVisibility(options) {
      assert.equal(options.checkVisibilityCSS, true);
      assert.equal(options.checkOpacity, true);
      return this.visible;
    }
    getBoundingClientRect() { return this.rect; }
    hasAttribute(name) { return this.attributes.has(name); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    focus() { if (this.acceptsFocus) document.activeElement = this; }
  }
  vm.runInNewContext(source, {
    MozXULElement: Element, document, window: { innerWidth: 1000, innerHeight: 800 },
    customElements: { define(name, value) { assert.equal(name, "zen-workspace-icons"); Collection = value; } },
  });
  const dock = new Collection();
  return { dock, document };
}

test("focuses the collection without introducing a sequential Tab stop", () => {
  const { dock, document } = fixture();
  assert.equal(dock.focusCollection(), true);
  assert.equal(document.activeElement, dock);
  assert.deepEqual([...dock.attributes], [["tabindex", "-1"]]);
});

test("retains existing focus policy and reports a rejected focus", () => {
  const { dock, document } = fixture();
  dock.setAttribute("tabindex", "-1");
  dock.acceptsFocus = false;
  assert.equal(dock.focusCollection(), false);
  assert.equal(document.activeElement, null);
  assert.deepEqual([...dock.attributes], [["tabindex", "-1"]]);
});

test("disconnected, hidden and transparent docks do not become focus targets", () => {
  for (const field of ["isConnected", "visible"]) {
    const { dock, document } = fixture();
    dock[field] = false;
    assert.equal(dock.focusCollection(), false);
    assert.equal(document.activeElement, null);
    assert.equal(dock.attributes.size, 0);
  }
});

test("zero-sized and fully offscreen compact docks do not receive focus", () => {
  for (const bounds of [
    { width: 0 }, { height: 0 }, { left: -200, right: 0 },
    { top: -32, bottom: 0 }, { left: 1000, right: 1200 },
    { top: 800, bottom: 832 },
  ]) {
    const { dock, document } = fixture();
    Object.assign(dock.rect, bounds);
    assert.equal(dock.focusCollection(), false);
    assert.equal(document.activeElement, null);
    assert.equal(dock.attributes.size, 0);
  }
});

test("a partially visible dock remains eligible without changing its geometry", () => {
  const { dock, document } = fixture();
  dock.rect.left = -10;
  dock.rect.right = 190;
  const before = { ...dock.rect };
  assert.equal(dock.focusCollection(), true);
  assert.equal(document.activeElement, dock);
  assert.deepEqual(dock.rect, before);
});
