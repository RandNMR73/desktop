import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { intensitySliderGeometry, intensitySliderValueAt } from "../../src/zen/spaces/ZenThemeColorPad.mjs";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
test("intensity drawing follows the reference frame, thumb and one-point sampling", () => {
  for (const [value, amplitude, width, height, x] of [[0, 0, 12, 44, 8], [.5, 7.5, 19.5, 51.5, 112], [1, 15, 27, 59, 216]]) {
    const g = intensitySliderGeometry(value);
    assert.deepEqual([g.amplitude, g.thumbWidth, g.thumbHeight, g.thumbX], [amplitude, width, height, x]);
    near(g.progressWidth, x - width / 2);
    const points = [...g.path.matchAll(/L (\S+) (\S+)/g)].map(([, x, y]) => [+x, +y]);
    assert.equal(points.length, 209);
    assert.equal(points[0][0], 8); assert.equal(points.at(-1)[0], 216);
    assert.ok(points.every((p, i) => p[0] === i + 8 && Math.abs(p[1] - 22) <= amplitude + 1e-9));
  }
  // Arc's denominator is 0x401821fb54442d18 (6.033185307179586),
  // not 2*pi. These samples distinguish it from the former Bezier artwork.
  const path = intensitySliderGeometry(1).path;
  const values = [...path.matchAll(/L (\S+) (\S+)/g)].map(([, , y]) => +y);
  near(values[38], 21.770332482573174);
  near(values[104], 36.98753674439386);
});

test("pointer mapping clamps at the eight-point insets without quantizing", () => {
  for (const [x, value] of [[-100, 0], [8, 0], [60, .25], [112, .5], [164, .75], [216, 1], [1000, 1]]) near(intensitySliderValueAt(x), value);
  near(intensitySliderValueAt(112.1), .5004807692307692);
  assert.equal(intensitySliderValueAt(NaN), null);
  assert.equal(intensitySliderValueAt(12, 16), null);
  for (const value of [-1, NaN, Infinity]) assert.equal(intensitySliderGeometry(value).value, 0);
  assert.equal(intensitySliderGeometry(2).value, 1);
});

const source = readFileSync(new URL("../../src/zen/spaces/ZenGradientGenerator.mjs", import.meta.url), "utf8");
const methods = source.slice(source.indexOf("  initIntensityInput("), source.indexOf("  getToolbarModifiedBaseRaw("));
function fixture() {
  const target = () => ({ handlers: new Map(), attributes: new Map(), style: {},
    addEventListener(n, f) { this.handlers.set(n, f); },
    removeEventListener(n, f) { if (this.handlers.get(n) === f) this.handlers.delete(n); },
    setAttribute(n, v) { this.attributes.set(n, String(v)); },
    removeAttribute(n) { this.attributes.delete(n); },
    toggleAttribute(n, flag) { if (flag) this.setAttribute(n, ""); else this.removeAttribute(n); },
    focus() { this.focused = true; },
  });
  const wrapper = target(), input = target(), thumb = target(), paths = [target(), target()], clip = target();
  wrapper.querySelectorAll = () => paths; wrapper.querySelector = () => clip;
  const document = target(), window = target();
  document.getElementById = id => id.endsWith("opacity-wrapper") ? wrapper : id.endsWith("intensity-thumb") ? thumb : input;
  window.windowUtils = { getBoundsWithoutFlushing: () => ({ x: 100, width: 224 }) };
  const Picker = vm.runInNewContext(`(class { ${methods} })`, { document, window, intensitySliderGeometry, intensitySliderValueAt, lazy: { MIN_OPACITY: .3, MAX_OPACITY: .8 } });
  const picker = new Picker();
  picker.setControlHover = () => {};
  Object.assign(picker, { currentOpacity: .55, saves: 0, updateCurrentWorkspace() { this.saves++; this.updateIntensityControl(this.currentOpacity, true); } });
  picker.initIntensityInput(); picker.updateIntensityControl(.55, true);
  const fire = (target, name, x = 212, button = 0) => target.handlers.get(name)?.({ clientX: x, button, target, preventDefault() {}, stopPropagation() {} });
  return { picker, wrapper, input, thumb, paths, clip, document, window, fire };
}

test("track presses move immediately, use the reference deadband and preserve saved opacity encoding", () => {
  const f = fixture();
  f.fire(f.wrapper, "mousedown", 160);
  near(f.picker.currentOpacity, .425); near(+f.input.value, .25);
  assert.ok(f.input.focused); assert.ok(f.wrapper.attributes.has("dragging"));
  const count = f.picker.saves;
  f.fire(f.document, "mousemove", 160.1); assert.equal(f.picker.saves, count);
  f.fire(f.document, "mousemove", 160.5); assert.equal(f.picker.saves, count + 1);
  f.fire(f.document, "mousemove", 500); near(f.picker.currentOpacity, .8);
  f.fire(f.document, "mousemove", 0); near(f.picker.currentOpacity, .3);
  f.fire(f.document, "mouseup");
  assert.equal(f.document.handlers.has("mousemove"), false);
  assert.equal(f.window.handlers.has("blur"), false);
  assert.equal(f.wrapper.attributes.has("dragging"), false);
});

test("disabled controls and right clicks do not edit; blur and closure cleanup stop drags", () => {
  const f = fixture();
  f.picker.updateIntensityControl(.55, false); f.fire(f.wrapper, "mousedown", 300);
  assert.equal(f.picker.saves, 0);
  f.picker.updateIntensityControl(.55, true); f.fire(f.wrapper, "mousedown", 300, 2);
  assert.equal(f.picker.saves, 0);
  for (const end of [() => f.fire(f.window, "blur"), () => f.picker.endIntensityDrag()]) {
    f.fire(f.wrapper, "mousedown", 200); end();
    const count = f.picker.saves; f.fire(f.document, "mousemove", 250);
    assert.equal(f.picker.saves, count); assert.equal(f.picker._intensityDrag, null);
  }
});

test("keyboard/accessibility input shares normalized intensity and enables drawing without rebuilding unchanged paths", () => {
  const f = fixture();
  f.input.value = "0.75"; f.fire(f.input, "input");
  near(f.picker.currentOpacity, .675);
  assert.equal(f.input.attributes.get("aria-valuetext"), "75%");
  near(parseFloat(f.thumb.style.left), 164);
  const oldPath = f.paths[0].attributes.get("d");
  f.paths[0].setAttribute = () => { throw Error("Unchanged wave rebuilt"); };
  f.picker.updateIntensityControl(.675, false);
  assert.ok(f.input.disabled); assert.equal(f.paths[0].attributes.get("d"), oldPath);
  f.picker.updateIntensityControl(.675, true); assert.equal(f.input.disabled, false);
});

test("continuous slider values retain small keyboard steps and endpoint navigation", () => {
  const f = fixture();
  const key = (key, extra = {}) => f.input.handlers.get("keydown")({ key,
    preventDefault() {}, stopPropagation() {}, ...extra });
  key("ArrowRight"); near(+f.input.value, .51);
  key("ArrowLeft"); near(+f.input.value, .5);
  key("ArrowUp"); near(+f.input.value, .51);
  key("ArrowDown"); near(+f.input.value, .5);
  key("PageUp"); near(+f.input.value, .6);
  key("PageDown"); near(+f.input.value, .5);
  f.input.value = ".513456";
  key("ArrowRight"); near(+f.input.value, .523456);
  key("End"); near(+f.input.value, 1);
  key("ArrowRight"); near(+f.input.value, 1);
  key("Home"); near(+f.input.value, 0);
  key("ArrowLeft"); near(+f.input.value, 0);
  const count = f.picker.saves;
  key("Tab"); key("ArrowRight", { metaKey: true });
  f.input.disabled = true; key("ArrowRight");
  assert.equal(f.picker.saves, count);
});
