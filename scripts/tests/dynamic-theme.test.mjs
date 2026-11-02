import assert from "node:assert/strict";
import test from "node:test";
import { dynamicThemeRequest } from "../../src/zen/spaces/ZenNativeThemeState.mjs";

const theme = () => ({ type: "gradient", opacity: .8, texture: 1,
  gradientColors: [{ c: [255, 0, 0], p3: [1, 0, 0], isPrimary: true }] });
test("live native requests retain precise P3, intensity, grain and appearance", () => {
  for (const count of [1, 2, 3]) for (const appearance of ["light", "dark"]) {
    const input = theme();
    input.gradientColors = Array.from({ length: count }, (_, i) => ({ p3: [i / 3, .123456789, .7] }));
    input.opacity = .55; input.texture = .25; input.colorPadTexture = "sand";
    const request = dynamicThemeRequest(input, appearance);
    assert.deepEqual(request, { version: 1, colors: input.gradientColors.map(c => c.p3),
      intensity: request.intensity, noise: .25, texture: "sand", appearance });
    assert.ok(Math.abs(request.intensity - .5) < 1e-12);
    request.colors[0][0] = 99;
    assert.equal(input.gradientColors[0].p3[0], 0);
  }
});
test("legacy, custom, invalid and unsupported themes keep the existing rendering path", () => {
  for (const edit of [
    t => delete t.gradientColors[0].p3,
    t => t.gradientColors[0].isCustom = true,
    t => t.gradientColors[0].p3 = [NaN, 0, 0],
    t => t.gradientColors[0].p3 = [1.1, 0, 0],
    t => t.gradientColors = [],
    t => t.gradientColors = Array(4).fill(t.gradientColors[0]),
    t => t.opacity = .81,
    t => t.texture = -1,
    t => t.colorPadTexture = "unknown",
    t => t.type = "custom",
  ]) {
    const input = theme(); edit(input); assert.equal(dynamicThemeRequest(input, "dark"), null);
  }
  assert.equal(dynamicThemeRequest(null, "dark"), null);
  assert.equal(dynamicThemeRequest(theme(), "unknown"), null);
});
