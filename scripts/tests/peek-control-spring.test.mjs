import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ThemeControlSpring } from "../../src/zen/spaces/ZenThemeColorPad.mjs";
import { peekControlForeground, paletteColorCSS, spacePaletteProperties } from "../../src/zen/spaces/ZenSpacePalette.mjs";

// Independent samples from SwiftUI.Animation.spring, including native merge
// decisions and settling. No browser input or live window was used to record it.
const reference = JSON.parse(readFileSync(new URL("fixtures/peek-control-spring.json", import.meta.url)));
for (const row of reference) test(`native Peek ${row.name} spring, reversal=${row.reversal}`, () => {
  const spring = new ThemeControlSpring(row.components, { response: row.response, dampingFraction: row.damping });
  spring.write(1, 0);
  for (const [ms, targetX, targetY, valueX, valueY, merge] of row.samples) {
    if (merge !== null) { assert.equal(merge, true); spring.write(targetX / row.components[0], ms / 1000); }
    const v = spring.sample(ms / 1000);
    assert(Math.abs(v * row.components[0] - (valueX ?? targetX)) < 1e-10, `x at ${ms}ms`);
    assert(Math.abs(v * row.components[1] - (valueY ?? targetY)) < 1e-10, `y at ${ms}ms`);
    assert.equal(spring.active, valueX !== null, `settling at ${ms}ms`);
  }
});

test("Peek shadow merges changing hover/press dynamics after advancing the previous spring", () => {
  const [row] = JSON.parse(readFileSync(new URL("fixtures/peek-control-parameter-spring.json", import.meta.url)));
  const spring = new ThemeControlSpring(row.components, { response: row.response, dampingFraction: row.damping });
  spring.write(1, 0);
  for (const [ms, targetX, , valueX, , merge] of row.samples) {
    if (merge !== null) {
      assert.equal(merge, true);
      const [, response, dampingFraction] = row.changes.find(change => change[0] === ms);
      spring.write(targetX / row.components[0], ms / 1000, { response, dampingFraction });
    }
    assert(Math.abs(spring.sample(ms / 1000) * row.components[0] - (valueX ?? targetX)) < 1e-10, `radius at ${ms}ms`);
    assert.equal(spring.active, valueX !== null, `settling at ${ms}ms`);
  }
});

test("Peek light appearance limits bright foregrounds without changing dark appearance or opacity", () => {
  assert.deepEqual(peekControlForeground([1, 1, 1, .7], "light"), [.4, .4, .4, .7]);
  assert.deepEqual(peekControlForeground([0, 0, 0, .8], "light"), [0, 0, 0, .8]);
  const input = [-.1, .4, .8, .9];
  assert.deepEqual(peekControlForeground(input, "dark"), input);
  const green = peekControlForeground([0, 1, 0, 1], "light");
  assert(Math.abs(green[1] - .3696) < 1e-12);
  assert(Math.abs(green[0]) < 1e-12 && Math.abs(green[2]) < 1e-12);
});

test("Peek tokens follow any semantic palette without altering the saved colors", () => {
  const { cases } = JSON.parse(readFileSync(new URL("fixtures/space-palettes.json", import.meta.url)));
  for (const { palette } of cases) {
    const before = structuredClone(palette);
    for (const appearance of ["light", "dark"]) {
      const p = spacePaletteProperties(palette, appearance)["zen-main-app-wrapper"];
      assert.equal(p["--arc-peek-control-color-scheme"], appearance);
      assert.equal(p["--arc-peek-control-background"], `light-dark(${paletteColorCSS(palette.light.backgroundExtra)}, ${paletteColorCSS(palette.dark.backgroundExtra)})`);
      assert(p["--arc-peek-control-foreground"].endsWith(`${paletteColorCSS(palette.dark.foregroundPrimary)})`));
    }
    assert.deepEqual(palette, before);
  }
});
