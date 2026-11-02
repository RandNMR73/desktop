import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import * as colors from "../../src/zen/spaces/ZenThemeColorPad.mjs";

const pages = colors.COLOR_PAD_PRESET_PAGES;
const source = readFileSync(new URL("../../src/zen/spaces/ZenGradientGenerator.mjs", import.meta.url), "utf8");
const select = source.slice(source.indexOf("  selectColorPreset("), source.indexOf("  initColorPages("));
const Picker = vm.runInNewContext(`(class {
  #currentLightness = 50;
  ${select}
})`, { ...colors, EXPLICIT_LIGHTNESS_TYPE: "explicit-lightness",
  window: { windowUtils: { getBoundsWithoutFlushing: () => ({ width: 360, height: 360 }) } } });
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(appearance = "automatic") {
  const picker = new Picker();
  Object.assign(picker, { dots: [], colorPadGeneration: 0,
    workspaceBeingEdited: { uuid: "fixture-space", theme: { gradientColors: [{ p3: [.2, .4, .6], c: [0, 0, 0], isPrimary: true }], opacity: .63, texture: .27 } },
    panel: { querySelector: () => ({}) },
    colorPad: { range: [.01, .425], appearance, texture: "sand" },
    endColorPadDrag() { this.ended = true; },
    customColorList: { replaceChildren() {} },
    spawnDot(position, primary) { this.dots.push({ ID: this.dots.length, element: { remove() {} }, position, primary }); },
    handleColorPositions(positions) {
      for (const position of positions) {
        if (!this.dots[position.ID]) this.spawnDot(position.position, false);
        this.dots[position.ID].position = position.position;
      }
    },
    paintColorPadDot(element, p3) { element.p3 = p3; },
    updateCurrentWorkspace() { this.saves = (this.saves ?? 0) + 1; },
  });
  return picker;
}

test("Arc's catalog has five ordered pages of nine, including both Brand variants", () => {
  assert.equal(pages.length, 5);
  assert.deepEqual(pages.map(page => [page[0].group, page[0].count, page.length]), [
    ["Brand", 1, 9], ["Brand", 3, 9], ["Pastel", 1, 9], ["Drab", 1, 9], ["Greyscale", 1, 9],
  ]);
  assert.equal(new Set(pages.flat().map(p => p.id)).size, 45);
  assert.deepEqual(pages[0].map(p => p.p3), pages[1].map(p => p.p3));
  // Offline AppKit asset resolutions from Arc 1.171.0, in Display P3.
  assert.deepEqual(pages[0][0].p3, [.9444217085838318, .9190871715545654, .8967581987380981]);
  assert.deepEqual(pages[2][0].p3, [.9940000176429749, .984000027179718, .9810000061988831]);
  assert.deepEqual(pages[3][0].p3, [.2939999997615814, .23100000619888306, .3449999988079071]);
  assert.deepEqual(pages[4].map(p => +p.p3[0].toFixed(2)), [1, .9, .8, .7, .5, .4, .2, .1, 0]);
});

test("gradient presets use the asset primary with +40/-40 degree companions", () => {
  for (const preset of pages[1]) {
    const result = colors.colorPadPresetColors(preset);
    const hsl = result.map(colors.colorPadHSL);
    assert.deepEqual(result[0], preset.p3);
    assert.deepEqual(hsl.map(([h]) => Math.round(((h - hsl[0][0]) * 360 + 360) % 360)), [0, 40, 320]);
    for (const [, s, l] of hsl) {
      assert.ok(Math.abs(s - hsl[0][1]) < 1e-10);
      assert.ok(Math.abs(l - hsl[0][2]) < 1e-10);
    }
  }
});

test("all 45 selections preserve exact P3 colors, reset counts and keep texture/intensity", () => {
  const p = fixture();
  for (const preset of [...pages[1], ...pages.flat()]) {
    const before = plain(p.workspaceBeingEdited.theme);
    p.selectColorPreset(preset);
    assert.equal(p.dots.length, preset.count);
    assert.deepEqual(plain(p.dots[0].element.p3), preset.p3);
    assert.ok(p.dots[0].primary);
    assert.equal(p.useAlgo, preset.wheel);
    assert.equal(p.colorPad.texture, "sand");
    assert.equal(p.colorPad.workspace, "fixture-space");
    assert.deepEqual(plain(p.colorPad.range), colors.colorPadRange(colors.colorPadHSL(preset.p3)[2]));
    assert.equal(p.workspaceBeingEdited.theme.opacity, before.opacity);
    assert.equal(p.workspaceBeingEdited.theme.texture, before.texture);
    assert.ok(p.ended);
  }
  assert.equal(p.colorPadGeneration, 54);
  assert.equal(p.saves, 54);
});

test("forced lightness bounds survive a preset outside the range without clipping its asset", () => {
  for (const mode of ["dark", "light"]) {
    const p = fixture(mode), range = p.colorPad.range;
    for (const preset of pages[4]) {
      p.selectColorPreset(preset);
      assert.equal(p.colorPad.range, range);
      assert.equal(p.colorPad.appearance, mode);
      assert.equal(p.colorPad.saturation, .01);
      assert.deepEqual(plain(p.dots[0].element.p3), preset.p3);
    }
  }
});

test("selecting before native metadata resolves still creates a complete P3 pad", () => {
  const p = fixture(); p.colorPad = null;
  p.workspaceBeingEdited.theme.colorPadTexture = "denim";
  p.selectColorPreset(pages[1][4]);
  assert.equal(p.colorPadGeneration, 1);
  assert.equal(p.colorPad.texture, "denim");
  assert.equal(p.colorPad.appearance, "automatic");
  assert.equal(p.dots.length, 3);
  assert.deepEqual(plain(p.dots[0].element.p3), pages[0][4].p3);
});
