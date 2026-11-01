import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/zen/common/sys/ZenCustomizableUI.sys.mjs", import.meta.url), "utf8");
const start = source.indexOf("  #initSidebarResizer(");
const method = source.slice(start, source.indexOf("\n  /**", start)).replaceAll("#", "");
const Resizer = vm.runInNewContext(`class Resizer { ${method} }; Resizer`, { kCollapseSidebarWidth: 60 });

function fixture({ compact = true, right = false, padding = [10, 10] } = {}) {
  const listeners = new Map(), frames = new Map(), captured = new Set();
  const values = new Map([["--zen-sidebar-width", "230px"], ["--zen-toolbox-min-width", "169px"]]);
  const attributes = new Map([["width", "230px"]]);
  let notifications = 0, nextFrame = 0;
  const toolbox = {
    style: { width: "230px", maxWidth: "500px", getPropertyValue: n => values.get(n) ?? "",
      setProperty: (n, v) => values.set(n, v) },
    setAttribute: (n, v) => attributes.set(n, v),
    getBoundingClientRect: () => ({ width: parseFloat(toolbox.style.width) + (compact ? padding[0] + padding[1] : 0) }),
  };
  const splitter = {
    addEventListener: (n, fn) => listeners.set(n, fn), setAttribute() {}, removeAttribute() {},
    hasPointerCapture: id => captured.has(id), setPointerCapture: id => captured.add(id),
    releasePointerCapture: id => captured.delete(id),
  };
  const window = {
    gZenCompactModeManager: { get preference() { return compact; } },
    getComputedStyle: () => ({ paddingLeft: `${padding[0]}px`, paddingRight: `${padding[1]}px` }),
    windowUtils: { getBoundsWithoutFlushing: () => toolbox.getBoundingClientRect() },
    document: { documentElement: { hasAttribute: () => right } },
    requestAnimationFrame: fn => { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id), setCursor() {},
  };
  const resizer = new Resizer();
  resizer.dispatchResizeEvent = () => { ++notifications; };
  resizer.toggleCompactMode = () => { compact = !compact; };
  resizer.collapseSidebarIntoCompactMode = () => { compact = true; };
  resizer.initSidebarResizer(window, splitter, toolbox, "230px");
  const emit = (type, clientX = 0) => listeners.get(type)({ button: 0, pointerId: 1, clientX, preventDefault() {} });
  return {
    toolbox, values, attributes, frames, captured, emit,
    get notifications() { return notifications; },
    flush() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); },
    drag(delta) { emit("pointerdown", 200); emit("pointermove", 200 + delta); this.flush(); emit("pointerup", 200 + delta); },
  };
}

for (const padding of [[8, 8], [10, 10], [7, 13]]) {
  test(`floating drag uses actual ${padding.join("/")}px padding without adding width on release`, () => {
    const f = fixture({ padding });
    f.drag(60);
    assert.equal(f.toolbox.style.width, "290px");
    assert.equal(f.values.get("--zen-sidebar-width"), "290px");
    assert.equal(f.attributes.get("width"), "290px");
    assert.equal(f.captured.size, 0);
    f.drag(-60);
    assert.equal(f.toolbox.style.width, "230px", "repeated drags do not accumulate padding");
  });
}

test("right sidebar reverses drag direction while retaining floating content width", () => {
  const f = fixture({ right: true }); f.drag(-60);
  assert.equal(f.toolbox.style.width, "290px");
});

test("floating width limits apply to the visible sidebar, excluding outer padding", () => {
  const f = fixture(); f.drag(-1000);
  assert.equal(f.toolbox.style.width, "169px");
  f.drag(1000); assert.equal(f.toolbox.style.width, "500px");
});

test("a native popup with a stale measured frame does not overwrite the final width", () => {
  const f = fixture();
  f.toolbox.getBoundingClientRect = () => ({ width: 250 });
  f.drag(60); assert.equal(f.toolbox.style.width, "290px");
});

test("pinned sidebar keeps its measured width without subtracting compact padding", () => {
  const f = fixture({ compact: false }); f.drag(60);
  assert.equal(f.toolbox.style.width, "290px");
});

test("multiple pointer moves coalesce and settle to the last rendered width", () => {
  const f = fixture(); f.emit("pointerdown", 200);
  for (let x = 201; x <= 260; ++x) f.emit("pointermove", x);
  assert.equal(f.frames.size, 1); assert.equal(f.notifications, 0);
  f.flush(); assert.equal(f.notifications, 1);
  f.emit("pointerup", 260); assert.equal(f.frames.size, 0);
  assert.equal(f.toolbox.style.width, "290px");
});

test("releasing before the next animation frame commits the final pointer position", () => {
  for (const compact of [false, true]) {
    const f = fixture({ compact }); f.emit("pointerdown", 200);
    f.emit("pointermove", 260); f.emit("pointerup", 260);
    assert.equal(f.toolbox.style.width, "290px");
    assert.equal(f.frames.size, 0);
    assert.equal(f.captured.size, 0);
    f.flush(); assert.equal(f.toolbox.style.width, "290px");
  }
});

test("double click resets stored and floating widths together and notifies layout", () => {
  const f = fixture(); f.drag(60);
  const before = f.notifications; f.emit("dblclick");
  assert.equal(f.toolbox.style.width, "230px");
  assert.equal(f.values.get("--zen-sidebar-width"), "230px");
  assert.equal(f.attributes.get("width"), "230px");
  assert.equal(f.notifications, before + 1);
});
