import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { colorPadP3, colorPadSRGB, colorPadHSL, colorPadRGB,
  colorPadRange, colorPadPosition, colorPadColor } from "../../src/zen/spaces/ZenThemeColorPad.mjs";

const reference = JSON.parse(readFileSync(new URL("fixtures/theme-color-pad-appkit.json", import.meta.url)));
const near = (actual, expected, tolerance = 1e-5) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < tolerance,
    `${v} differs from ${expected[i]} by ${Math.abs(v - expected[i])}`));
};

test("five original Space colors agree with AppKit P3 conversion and hue/lightness coordinates", () => {
  for (const row of reference) {
    const p3 = colorPadP3(row.input);
    near(p3, row.p3, 3e-4);
    const hsl = colorPadHSL(p3);
    near(hsl, row.hsl, 3e-4);
    const range = colorPadRange(hsl[2]);
    near(range, row.range, 3e-4);
    const position = colorPadPosition(p3, range);
    near([position.x, position.y], [row.position.x, row.position.y], 3e-4);
  }
});

test("dragging preserves saturation and round trips arbitrary hue/lightness combinations", () => {
  for (const hue of [0, .1, .3, .55, .9]) for (const saturation of [.01, .3, 1]) {
    for (const lightness of [.02, .1, .4, .7, .96]) {
      const p3 = colorPadRGB([hue, saturation, lightness]);
      const range = colorPadRange(lightness);
      const position = colorPadPosition(p3, range);
      near(colorPadColor(position, saturation, range), p3);
      near(colorPadP3(colorPadSRGB(p3)), p3, 1e-6);
    }
  }
});

test("radial motion changes lightness while angle selects hue", () => {
  const range = [.25, .75];
  near(colorPadHSL(colorPadColor({ x: .495, y: 0 }, .6, range)), [0, .6, .5]);
  near(colorPadHSL(colorPadColor({ x: 0, y: .495 }, .6, range)), [.25, .6, .5]);
  near(colorPadHSL(colorPadColor({ x: 4, y: 0 }, .6, range)), [0, .6, .75]);
  near(colorPadHSL(colorPadColor({ x: 0, y: 0 }, .6, range)), [0, .6, .25]);
});

test("initial appearance ranges retain outlying colors without inventing a global browser range", () => {
  assert.deepEqual(colorPadRange(.5), [.25, .75]);
  assert.deepEqual(colorPadRange(.2, "dark"), [.01, .425]);
  assert.deepEqual(colorPadRange(.8, "light"), [.575, .97]);
  assert.deepEqual(colorPadRange(.8, "dark"), [.01, .8]);
  assert.deepEqual(colorPadRange(.2, "light"), [.2, .97]);
  assert.deepEqual(colorPadRange(0), [.01, .25]);
  assert.deepEqual(colorPadRange(1), [.75, .97]);
});

test("invalid input cannot produce nonfinite saved coordinates or colors", () => {
  for (const rgb of [null, [], [0, 1], [NaN, 0, 0], [Infinity, 0, 0]]) {
    assert.equal(colorPadP3(rgb), null);
    assert.equal(colorPadPosition(rgb, [.2, .8]), null);
  }
  assert.equal(colorPadP3([0, 1, 0], "unknown"), null);
  for (const range of [[], [1, 0], [NaN, .8], [-1, 1]]) {
    assert.equal(colorPadPosition([1, 0, 0], range), null);
    assert.equal(colorPadColor({ x: 0, y: 0 }, 1, range), null);
  }
  assert.equal(colorPadColor({ x: Infinity, y: 0 }, 1, [0, 1]), null);
  assert.deepEqual(colorPadPosition([.5, .5, .5], [.5, .5]), { x: 0, y: 0 });
});
