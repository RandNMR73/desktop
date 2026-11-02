import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../../src/zen/spaces/ZenGradientGenerator.mjs", import.meta.url), "utf8");
const section = (a, b) => source.slice(source.indexOf(a), source.indexOf(b));
const Picker = vm.runInNewContext(`(class nsZenThemePicker {
  static MAX_DOTS = 3;
  ${section("  get colorHarmonies()", "  initContextMenu()")}
  ${section("  calculateCompliments(", "  handleColorPositions(")}
  ${section("  onThemePickerClick(", "  themedColors(")}
})`, { window: { windowUtils: { getBoundsWithoutFlushing: () => ({ left: 20, top: 30, width: 360, height: 360 }) } } });

function element(control = false) {
  const classes = new Set();
  return { style: {}, classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
    closest: () => control ? { id: "unrelated-button" } : null, getAnimations: () => [] };
}
function fixture(count = 3) {
  const p = new Picker(), pad = element();
  Object.assign(p, { useAlgo: "analogous", colorPad: {}, dots: [], saves: 0, panel: { querySelector: () => pad } });
  p.spawnDot = (pos, primary) => p.dots.push({ ID: p.dots.length, position: { ...pos }, element: element() });
  p.spawnDot({ x: 270, y: 180 }, true);
  while (p.dots.length < count) {
    const positions = p.calculateCompliments(p.dots, "add");
    p.spawnDot(positions.at(-1).position);
  }
  p.handleColorPositions = positions => positions.forEach(d => Object.assign(p.dots.find(dot => dot.ID === d.ID), { position: d.position }));
  p.updateCurrentWorkspace = () => p.saves++;
  return { p, pad };
}
function event(target, x, y, button = 0, buttons = 1) {
  return { target, clientX: x + 20, clientY: y + 30, button, buttons, preventDefault() {}, stopPropagation() {} };
}
function point(actual, x, y) {
  assert.ok(Math.abs(actual.x - x) < 1e-8, `${actual.x} != ${x}`);
  assert.ok(Math.abs(actual.y - y) < 1e-8, `${actual.y} != ${y}`);
}

test("off-center grabs preserve the offset and the post-drag click cannot move the handle again", () => {
  const { p } = fixture(), target = p.dots[0].element;
  p.onDotMouseDown(event(target, 281, 174));
  point(p.dots[0].position, 270, 180);
  p.onDotMouseMove(event(target, 291, 194));
  point(p.dots[0].position, 280, 200);
  p.onDotMouseUp(event(target, 291, 194, 0, 0));
  const saved = p.saves;
  p.onThemePickerClick(event(target, 291, 194, 0, 0));
  point(p.dots[0].position, 280, 200);
  assert.equal(p.saves, saved);
  assert.equal(p.dragging, false);
});

test("each secondary supplies the new primary color while identities and harmony remain stable", () => {
  for (const index of [1, 2]) {
    const { p } = fixture(), original = p.dots.map(d => d.element);
    const { x, y } = p.dots[index].position;
    p.onDotMouseDown(event(original[index], x + 5, y - 3));
    point(p.dots[0].position, x, y);
    p.onDotMouseMove(event(original[index], x + 15, y + 17));
    point(p.dots[0].position, x + 10, y + 20);
    p.dots.forEach((d, i) => { assert.equal(d.ID, i); assert.equal(d.element, original[i]); });
    const angles = p.dots.map(d => Math.atan2(d.position.y - 180, d.position.x - 180) * 180 / Math.PI);
    assert.deepEqual(angles.map(a => Math.round((a - angles[0] + 360) % 360)), [0, 40, 320]);
    assert.ok(p.saves > 0);
  }
});

test("dragging the pad background edits continuously and clamps the center to the color range", () => {
  const { p, pad } = fixture();
  p.onDotMouseDown(event(pad, 150, 170));
  point(p.dots[0].position, 150, 170);
  p.onDotMouseMove(event(pad, 200, 210));
  point(p.dots[0].position, 200, 210);
  p.onDotMouseMove(event(pad, 900, 180));
  point(p.dots[0].position, 358.2, 180);
  assert.equal(pad.classList.contains("dragging"), true);
  p.onDotMouseUp(event(pad, 900, 180, 0, 0));
  assert.equal(pad.classList.contains("dragging"), false);
});

test("a background gesture creates exactly one primary in an empty pad", () => {
  const { p, pad } = fixture(); p.dots = [];
  p.onDotMouseDown(event(pad, 130, 120));
  p.onDotMouseMove(event(pad, 140, 140));
  p.onDotMouseUp(event(pad, 140, 140, 0, 0));
  p.onThemePickerClick(event(pad, 140, 140, 0, 0));
  assert.equal(p.dots.length, 1);
  point(p.dots[0].position, 140, 140);
});

test("controls and non-left buttons do not mutate colors or remove handles", () => {
  const { p } = fixture(), before = JSON.stringify(p.dots);
  for (const button of [1, 2]) {
    p.onDotMouseDown(event(p.dots[0].element, 270, 180, button));
    p.onDotMouseUp(event(p.dots[0].element, 270, 180, button, 0));
  }
  p.onDotMouseDown(event(element(true), 270, 180));
  assert.equal(JSON.stringify(p.dots), before);
  assert.equal(p.saves, 0);
});

test("closing, blurring, or observing a released button ends the drag without a stuck cursor", () => {
  for (const stop of [p => p.endColorPadDrag(), p => p.onDotMouseMove(event(p.dots[0].element, 250, 150, 0, 0))]) {
    const { p, pad } = fixture();
    p.onDotMouseDown(event(p.dots[0].element, 270, 180));
    stop(p);
    const saved = p.saves;
    p.onDotMouseMove(event(pad, 90, 100));
    assert.equal(p.saves, saved);
    assert.equal(p.dragging, false);
    assert.equal(p.dragStartPosition, null);
    assert.equal(p.dragStartDotPosition, null);
    assert.equal(pad.classList.contains("dragging"), false);
  }
});
