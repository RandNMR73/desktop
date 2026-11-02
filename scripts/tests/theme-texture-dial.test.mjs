import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { textureDialValue, textureDialValueAt, textureDialGeometry,
  nextTextureDialState, textureDialCrossesHaptic } from "../../src/zen/spaces/ZenThemeColorPad.mjs";
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("dial endpoints clamp, 5% detents round upward, rotation remains continuous", () => {
  for (const gesture of ["slider", "dialClick", "scrollWheel", "drag"]) {
    for (const [input, expected] of [[-1, 0], [0, 0], [.0249, 0], [.025, .05], [.125, .15], [.9999, 1], [1, 1], [2, 1]]) {
      assert.equal(textureDialValue(input, gesture), expected);
    }
  }
  assert.equal(textureDialValue(.123456, "rotation"), .123456);
  assert.equal(textureDialValue(NaN), null); assert.equal(textureDialValue(Infinity), null);
  for (const [x, y, expected] of [[40, 8, 0], [72, 40, .25], [40, 72, .5], [8, 40, .75], [39.9, 8, 1]]) {
    near(textureDialValueAt(x, y), expected);
  }
  assert.equal(textureDialValueAt(0, 0, 0), null);
});

test("reference dial has 19 five-point dots on a 32-point radius and a continuous progress mask", () => {
  const g = textureDialGeometry(.25);
  near(g.x, 72); near(g.y, 40); near(g.angle, 90);
  assert.equal(g.dots.length, 19);
  for (const dot of g.dots) near(Math.hypot(dot.x - 40, dot.y - 40), 32);
  assert.ok(!g.dots.some(dot => Math.abs(dot.x - 40) < .001 && dot.y > 40));
  near(g.dots[9].x, 40); near(g.dots[9].y, 8);
  assert.equal(textureDialGeometry(0).mask, "");
  assert.equal(textureDialGeometry(1).mask, "M 40 8 A 32 32 0 1 1 40 72 A 32 32 0 1 1 40 8");
  assert.match(g.mask, /^M 40 8 A 32 32 0 0 1 72 40$/);
});

test("center cycles four textures, then off, then re-enables at 80%", () => {
  let state = { noise: .35, texture: "grain" };
  for (const [noise, texture] of [[.35, "sand"], [.35, "denim"], [.35, "tweed"], [0, "grain"], [.8, "grain"]]) {
    state = nextTextureDialState(state.noise, state.texture);
    assert.deepEqual(state, { noise, texture });
  }
});

test("drag haptics happen at crossed tenths, including endpoints, rather than every twentieth", () => {
  assert.ok(textureDialCrossesHaptic(.05, .1));
  assert.ok(textureDialCrossesHaptic(.1, .15));
  assert.ok(textureDialCrossesHaptic(.95, 1));
  assert.ok(textureDialCrossesHaptic(.1, 0));
  assert.equal(textureDialCrossesHaptic(.11, .15), false);
  assert.equal(textureDialCrossesHaptic(.5, .5), false);
});

const source = readFileSync(new URL("../../src/zen/spaces/ZenGradientGenerator.mjs", import.meta.url), "utf8");
const methods = source.slice(source.indexOf("  initTextureInput("), source.indexOf("  initThemePicker("));
function fixture() {
  const target = () => ({ handlers: new Map(), attributes: new Map(), style: {}, children: [],
    addEventListener(n, f) { this.handlers.set(n, f); }, removeEventListener(n, f) { if (this.handlers.get(n) === f) this.handlers.delete(n); },
    setAttribute(n, v) { this.attributes.set(n, String(v)); }, removeAttribute(n) { this.attributes.delete(n); },
    toggleAttribute(n, flag) { if (flag) this.setAttribute(n, ""); else this.removeAttribute(n); },
    appendChild(el) { this.children.push(el); }, append(...els) { this.children.push(...els); },
    contains(el) { return el === this; }, focus() { this.focused = true; },
  });
  const wrapper = target(), document = target(), window = target();
  document.getElementById = () => wrapper; document.createElement = document.createElementNS = target;
  window.windowUtils = { getBoundsWithoutFlushing: () => ({ x: 100, y: 200, width: 80, height: 80 }) };
  let time = 0, timerID = 0, haptics = 0;
  const timers = new Map();
  const Picker = vm.runInNewContext(`(class { ${methods} })`, { document, window,
    textureDialValue, textureDialValueAt, textureDialGeometry, nextTextureDialState, textureDialCrossesHaptic,
    ThemeControlHoverMotion: class { set() {} reset() {} clear() {} },
    Services: { zen: { playHapticFeedback() { haptics++; } } }, performance: { now: () => time },
    setTimeout(f, delay) { timers.set(++timerID, { f, at: time + delay }); return timerID; }, clearTimeout(id) { timers.delete(id); } });
  const picker = new Picker(); Object.assign(picker, { currentTexture: .5, colorPad: { texture: "grain" }, saves: 0,
    updateCurrentWorkspace() { this.saves++; this.updateTextureControl(true); } });
  picker.initTextureInput(); picker.updateTextureControl(true);
  const fire = (target, type, extra = {}) => target.handlers.get(type)?.({ target, type, clientX: 172, clientY: 240, button: 0, buttons: type === "mouseup" ? 0 : 1, preventDefault() {}, stopPropagation() {}, ...extra });
  const tick = ms => { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.f(); } };
  return { picker, wrapper, document, window, fire, tick, haptics: () => haptics };
}

test("click waits for release, drag starts at ten points, release/blur/close remove listeners", () => {
  const f = fixture();
  f.fire(f.wrapper, "mousedown"); assert.equal(f.picker.currentTexture, .5);
  f.fire(f.document, "mouseup"); near(f.picker.currentTexture, .25);
  f.fire(f.wrapper, "mousedown"); f.fire(f.document, "mousemove", { clientX: 171, clientY: 249 });
  assert.equal(f.picker._textureDrag.moved, false);
  f.fire(f.document, "mousemove", { clientX: 140, clientY: 272 }); near(f.picker.currentTexture, .5);
  assert.ok(f.wrapper.attributes.has("dragging"));
  for (const end of [() => f.fire(f.document, "mouseup"), () => f.fire(f.window, "blur"), () => f.picker.endTextureDrag()]) {
    f.fire(f.wrapper, "mousedown"); end();
    const saved = f.picker.saves; f.fire(f.document, "mousemove", { clientX: 140, clientY: 272 });
    assert.equal(f.picker.saves, saved); assert.equal(f.picker._textureDrag, null);
    assert.equal(f.document.handlers.has("mousemove"), false); assert.equal(f.window.handlers.has("blur"), false);
  }
});

test("center drag suppresses its click, ordinary center click cycles, disabled/right/corner presses do not edit", () => {
  const f = fixture(), center = f.picker._textureCenter;
  f.fire(f.wrapper, "mousedown", { target: center, clientX: 140 });
  f.fire(f.document, "mousemove", { clientX: 140, clientY: 272 });
  f.fire(f.document, "mouseup"); f.fire(center, "click");
  assert.equal(f.picker.colorPad.texture, "grain");
  f.tick(0); f.fire(center, "click"); assert.equal(f.picker.colorPad.texture, "sand");
  const saved = f.picker.saves;
  f.fire(f.wrapper, "mousedown", { button: 2 }); assert.equal(f.picker._textureDrag, null);
  f.fire(f.wrapper, "mousedown", { clientX: 100, clientY: 200 }); assert.equal(f.picker._textureDrag, null);
  f.picker.updateTextureControl(false); f.fire(center, "click"); f.fire(f.wrapper, "mousedown");
  assert.equal(f.picker.saves, saved); assert.equal(f.picker._textureInput.disabled, true);
});

test("wheel updates use the latest direction per 200ms and cancel pending work on leave/close", () => {
  const f = fixture(), center = f.picker._textureCenter;
  f.fire(center, "wheel", { deltaY: -1 }); near(f.picker.currentTexture, .65);
  f.fire(center, "wheel", { deltaY: -10 }); f.fire(center, "wheel", { deltaY: 2 });
  f.tick(199); near(f.picker.currentTexture, .65);
  f.tick(1); near(f.picker.currentTexture, .55);
  f.fire(center, "wheel", { deltaY: -2 }); f.fire(center, "mouseleave");
  f.tick(200); near(f.picker.currentTexture, .55);
  f.fire(center, "wheel", { deltaY: 0 }); near(f.picker.currentTexture, .55);
  f.fire(center, "wheel", { deltaY: -1 }); near(f.picker.currentTexture, .7);
  f.fire(center, "wheel", { deltaY: -1 }); f.picker.endTextureDrag();
  f.tick(200); near(f.picker.currentTexture, .7);
  f.fire(center, "wheel", { deltaY: -1 }); near(f.picker.currentTexture, .85);
  f.fire(center, "wheel", { deltaY: -1 }); f.fire(f.window, "blur");
  f.tick(200); near(f.picker.currentTexture, .85);
  assert.equal(f.window.handlers.has("blur"), false);
  assert.equal(f.haptics(), 0);
});

test("trackpad rotation accumulates incremental degrees, waits for one degree and stays continuous", () => {
  const f = fixture();
  f.fire(f.picker._textureCenter, "MozRotateGestureStart", { delta: .4 });
  f.fire(f.document, "MozRotateGestureUpdate", { delta: .5 });
  near(f.picker.currentTexture, .5); assert.equal(f.picker._textureRotation.recognized, false);
  f.fire(f.document, "MozRotateGestureUpdate", { delta: .1 });
  near(f.picker.currentTexture, .5 + 1 / 720);
  assert.ok(f.wrapper.attributes.has("rotating"));
  f.fire(f.document, "MozRotateGestureUpdate", { delta: 1 });
  near(f.picker.currentTexture, .5 + 3 / 720);
  // The end event already contains the total rotation. It must not be applied again.
  f.fire(f.document, "MozRotateGesture", { delta: 2 });
  near(f.picker.currentTexture, .5 + 3 / 720);
  assert.equal(f.picker._textureRotation, null);
  assert.equal(f.document.handlers.has("MozRotateGestureUpdate"), false);
  assert.equal(f.window.handlers.has("blur"), false);
});

test("rotation clamps endpoints and cleans up on blur, closure, disabling or a pointer drag", () => {
  const f = fixture(), center = f.picker._textureCenter;
  f.fire(center, "MozRotateGestureStart", { delta: -1000 }); near(f.picker.currentTexture, 0);
  f.fire(f.document, "MozRotateGestureUpdate", { delta: 3000 }); near(f.picker.currentTexture, 1);
  for (const end of [() => f.fire(f.window, "blur"), () => f.picker.endTextureRotation(),
    () => f.picker.updateTextureControl(false), () => f.fire(f.wrapper, "mousedown")]) {
    f.picker.updateTextureControl(true);
    f.fire(center, "MozRotateGestureStart", { delta: -2 }); end();
    const saved = f.picker.saves;
    f.fire(f.document, "MozRotateGestureUpdate", { delta: -20 });
    assert.equal(f.picker.saves, saved); assert.equal(f.picker._textureRotation, null);
    assert.equal(f.wrapper.attributes.has("rotating"), false);
    f.picker.endTextureDrag();
  }
  f.picker.updateTextureControl(false);
  f.fire(center, "MozRotateGestureStart", { delta: 10 }); assert.equal(f.picker._textureRotation, null);
  f.picker.updateTextureControl(true);
  f.fire(center, "MozRotateGestureStart", { delta: NaN }); assert.equal(f.picker._textureRotation, null);
});

test("continuous rotation survives control updates while keyboard movement retains detents", () => {
  const f = fixture(), input = f.picker._textureInput;
  assert.equal(input.step, "any");
  f.picker.setTextureValue(.5041666666666667, "rotation");
  near(+input.value, .5041666666666667);
  const key = key => f.fire(input, "keydown", { key });
  key("ArrowRight"); near(f.picker.currentTexture, .55);
  key("ArrowLeft"); near(f.picker.currentTexture, .5);
  key("PageUp"); near(f.picker.currentTexture, .6);
  key("PageDown"); near(f.picker.currentTexture, .5);
  key("End"); near(f.picker.currentTexture, 1);
  key("Home"); near(f.picker.currentTexture, 0);
  f.picker.updateTextureControl(false); key("ArrowRight"); near(f.picker.currentTexture, 0);
});
