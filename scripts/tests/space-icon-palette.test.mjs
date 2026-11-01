import assert from "node:assert/strict";
import test from "node:test";
import { spaceIconPalette, spaceIconPaletteCSS, spaceIconSource } from "../../src/zen/spaces/ZenSpaceIconPalette.mjs";

// Independent Arc 1.171.0 saved palettes. Input is the original P3 color;
// output is Arc's extended-sRGB semantic maxContrastColor, light then dark.
const references = [
  [[.1555883505854294,.6372049583464712,.82976598030728],[-.125337,.372358,.487561,1],[.851641,.948389,.979826,1]],
  [[.913628495466775,.3493181177131345,.14641733908116167],[.670843,.165362,-.048872,1],[1.004248,.913731,.886861,1]],
  [[.65646781297633,.1172947917049125,.05742380987700731],[.717256,-.037149,-.045602,1],[1.006955,.925131,.918696,1]],
  [[.49598264264185005,.7210080368739388,.837995297309763],[.000841,.374407,.491046,1],[.894699,.948953,.972273,1]],
  [[.15599926494839458,.8319259876688179,.4000655606304809],[-.156257,.401461,.162577,1],[.78388,.971996,.866992,1]],
];
test("general palette calculation reproduces all five independent Arc palettes", () => {
  for (const [input, light, dark] of references) {
    const palette = spaceIconPalette(input, "display-p3");
    for (const [appearance, expected] of [["light", light], ["dark", dark]])
      expected.forEach((value, i) => assert(Math.abs(value - palette[appearance][i]) < .00011));
  }
});
test("new colors and neutral endpoints produce bounded light and dark palettes", () => {
  for (const space of ["srgb", "display-p3"]) {
    for (let r = 0; r <= 1; r += .2) for (let g = 0; g <= 1; g += .2) for (let b = 0; b <= 1; b += .2) {
      const palette = spaceIconPalette([r,g,b], space);
      assert(spaceIconPaletteCSS(palette));
      const y = rgba => rgba.slice(0,3).reduce((sum,c,i) => sum + [.2126,.7152,.0722][i] *
        Math.sign(c) * (Math.abs(c) <= .04045 ? Math.abs(c)/12.92 : ((Math.abs(c)+.055)/1.055)**2.4), 0);
      assert(y(palette.light) < .15);
      assert(y(palette.dark) > .7);
    }
  }
  const neutral = spaceIconPalette([.5,.5,.5]);
  assert(Math.abs(neutral.light[0] - .34) < 1e-7);
  assert(Math.abs(neutral.dark[0] - .94) < 1e-7);
});
test("extended imported colors are retained, while invalid metadata and input are rejected", () => {
  assert.equal(spaceIconPaletteCSS({light:[-.125337,.372358,.487561,1],dark:[1.004248,.913731,.886861,1]}),
    "light-dark(color(srgb -0.125337 0.372358 0.487561 / 1), color(srgb 1.004248 0.913731 0.886861 / 1))");
  for (const input of [null, [], [1,0], [Infinity,0,0], [-1,0,0], [2,0,0], ["1",0,0]]) assert.equal(spaceIconPalette(input), null);
  assert.equal(spaceIconPalette([1,0,0],"invalid"),null);
  for (const light of [null, [], [Infinity,0,0,1], [5,0,0,1], [0,0,0,-1]])
    assert.equal(spaceIconPaletteCSS({light,dark:[1,1,1,1]}),null);
});
test("legacy outline aliases do not alter catalog, emoji, or external icon URLs", () => {
  const base = "chrome://browser/skin/zen-icons/selectable/";
  assert.equal(spaceIconSource(`${base}bell.svg`),`${base}arc-notifications.svg`);
  assert.equal(spaceIconSource(`${base}flame.svg`),`${base}arc-bonfire.svg`);
  for (const url of [`${base}arc-paw.svg`, `${base}rocket.svg`, `${base}constructor.svg`, "🦋", "https://example.test/bell.svg", null])
    assert.equal(spaceIconSource(url),url);
});
