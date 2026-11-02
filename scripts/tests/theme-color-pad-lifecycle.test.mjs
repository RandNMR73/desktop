import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import * as colors from "../../src/zen/spaces/ZenThemeColorPad.mjs";

const source = readFileSync(new URL("../../src/zen/spaces/ZenGradientGenerator.mjs", import.meta.url), "utf8");
const methods = source.slice(source.indexOf("  async initializeColorPad("), source.indexOf("  calculateInitialPosition("));

function fixture() {
  let resolve;
  const loading = new Promise(r => { resolve = r; });
  const Picker = vm.runInNewContext(`(class nsZenThemePicker {
    static MAX_DOTS = 3;
    ${methods}
  })`, { ...colors, nativeSpaceColorPad: () => loading,
    window: { windowUtils: { getBoundsWithoutFlushing: () => ({ width: 360, height: 360 }) } } });
  const picker = new Picker();
  picker.updateTextureControl = enabled => { picker.textureControlEnabled = enabled; };
  picker.updateIntensityControl = (value, enabled) => { picker.intensityControl = { value, enabled }; };
  const attributes = new Map(), properties = new Map();
  Object.assign(picker, { colorPadGeneration: 0, colorPad: null, updated: false,
    workspaceBeingEdited: { uuid: "space", theme: { gradientColors: [{ c: [255, 0, 0], isPrimary: true }] } },
    panel: { state: "open", querySelector: () => ({}) },
    dots: [{ element: { style: { setProperty: (k, v) => properties.set(k, v) },
      setAttribute: (k, v) => attributes.set(k, v), removeAttribute: k => attributes.delete(k) } }],
    getJSONPos: (x, y) => JSON.stringify({ x, y }),
  });
  return { picker, attributes, properties, resolve: () => resolve({ version: 1,
    colors: [{ space: "display-p3", rgb: [.8, .2, .2] }], wheel: "analogous" }) };
}

test("original imported colors set visible coordinates without mutating the saved theme", async () => {
  const f = fixture(), before = JSON.stringify(f.picker.workspaceBeingEdited);
  const opening = f.picker.initializeColorPad(); f.resolve(); await opening;
  assert.equal(JSON.stringify(f.picker.workspaceBeingEdited), before);
  assert.equal(f.picker.updated, false);
  assert.equal(f.picker.textureControlEnabled, true);
  assert.ok(Math.abs(f.picker.dots[0].position.x - 269.1) < 1e-8);
  assert.equal(f.picker.dots[0].position.y, 180);
  assert.equal(f.properties.get("--zen-theme-picker-dot-color"), "color(display-p3 0.8 0.2 0.2)");
});

test("a delayed native color result cannot repopulate a closed, switched, edited, or reopened picker", async () => {
  for (const change of [
    f => { f.picker.panel.state = "closed"; },
    f => { f.picker.workspaceBeingEdited = structuredClone(f.picker.workspaceBeingEdited); },
    f => { f.picker.updated = true; },
    f => { f.picker.workspaceBeingEdited.theme.texture = .75; },
    f => { f.picker.colorPadGeneration++; },
  ]) {
    const f = fixture();
    const opening = f.picker.initializeColorPad(); change(f); f.resolve(); await opening;
    assert.equal(f.picker.colorPad, null);
    assert.equal(f.picker.textureControlEnabled, undefined);
    assert.equal(f.attributes.size, 0);
    assert.equal(f.properties.size, 0);
  }
});

test("empty themes synchronously seed Arc's full P3 range without saving on open", async () => {
  const f = fixture();
  f.picker.workspaceBeingEdited.theme = { gradientColors: [], opacity: .35, texture: .7 };
  const before = JSON.stringify(f.picker.workspaceBeingEdited);
  const opening = f.picker.initializeColorPad();
  assert.deepEqual(Array.from(f.picker.colorPad.range), [.01, .97]);
  assert.equal(f.picker.colorPad.saturation, 1);
  assert.equal(f.picker.currentOpacity, .8);
  assert.equal(f.picker.currentTexture, 0);
  assert.equal(f.picker.colorPad.texture, "grain");
  assert.equal(f.picker.useAlgo, "complementary");
  assert.equal(f.picker.textureControlEnabled, false);
  assert.deepEqual(f.picker.intensityControl, { value: .8, enabled: false });
  assert.equal(JSON.stringify(f.picker.workspaceBeingEdited), before);
  assert.equal(f.picker.updated, false);
  await opening; // It must not wait for the unresolved native resource request.
  const p3 = f.picker.colorPadAtPosition(269.1, 180);
  const hsl = colors.colorPadHSL(p3);
  assert.ok(Math.abs(hsl[1] - 1) < 1e-10);
  assert.ok(Math.abs(hsl[2] - .49) < 1e-10);
});
