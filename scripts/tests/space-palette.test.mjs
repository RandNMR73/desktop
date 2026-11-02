import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validSpacePalette, unpackSpacePalette, spacePaletteInput, spacePaletteProperties,
  SpacePaletteStyles, primaryPaletteKeys, semanticPaletteKeys } from "../../src/zen/spaces/ZenSpacePalette.mjs";

const cases = JSON.parse(readFileSync(new URL("./fixtures/space-palettes.json", import.meta.url))).cases;
test("native layout retains all 112 extended-gamut components", () => {
  for (const { palette } of cases) {
    const values = [["primary", primaryPaletteKeys], ["light", semanticPaletteKeys], ["dark", semanticPaletteKeys]]
      .flatMap(([mode, keys]) => keys.flatMap(key => palette[mode][key]));
    assert.deepEqual(unpackSpacePalette(values), palette);
    for (const bad of [values.slice(1), [...values, 1], values.with(0, NaN), values.with(3, 2), values.with(0, 5)])
      assert.equal(unpackSpacePalette(bad), null);
    const broken = structuredClone(palette); delete broken.dark.focus;
    assert.equal(validSpacePalette(broken), false);
  }
});
test("primary P3 input survives legacy clipping and ignores unrelated theme edits", () => {
  const theme = { type: "gradient", gradientColors: [{ c: [0, 0, 0] }, { c: [255, 0, 0], p3: [1, .1, .2], isPrimary: true }] };
  const before = structuredClone(theme), input = spacePaletteInput(theme);
  assert.deepEqual(input, { space: "display-p3", rgb: [1, .1, .2] });
  theme.texture = .3; theme.opacity = .6; theme.gradientColors[0].p3 = [0, 1, 0];
  theme.gradientColors[1].position = { x: 4, y: 6 };
  assert.deepEqual(spacePaletteInput(theme), input);
  input.rgb[0] = 0; assert.deepEqual(theme.gradientColors[1].p3, before.gradientColors[1].p3);
  delete theme.gradientColors[1].p3;
  assert.deepEqual(spacePaletteInput(theme), { space: "srgb", rgb: [1, 0, 0] });
  assert.equal(spacePaletteInput({ type: "gradient", gradientColors: [] }), null);
  for (const p3 of [[NaN, 0, 0], [2, 0, 0], [], [true, 0, 0]]) {
    theme.gradientColors[1].p3 = p3; assert.equal(spacePaletteInput(theme), null);
  }
});
test("import metadata is bounded and original P3 takes precedence over rounded legacy colors", () => {
  const theme = { type: "gradient", gradientColors: [{ c: [0, 30, 200] }] };
  const imported = { version: 1, colors: [{ space: "display-p3", rgb: [.123456789, .2, .8] }] };
  assert.deepEqual(spacePaletteInput(theme, imported), imported.colors[0]);
  assert.equal(spacePaletteInput(theme, { ...imported, colors: [imported.colors[0], imported.colors[0]] }).space, "srgb");
});
test("app appearance and sidebar contrast select independent semantic tokens", () => {
  for (const { palette } of cases) for (const appearance of ["light", "dark"]) {
    const props = spacePaletteProperties(palette, appearance);
    assert(props.urlbar["--arc-command-selection"].includes(palette[appearance].focus[0]));
    assert(props["zen-sidebar-foot-buttons"]["--arc-download-fill"].startsWith("light-dark("));
    assert.equal(props.zenCreateNewPopup["--arc-menu-hover"], props.zenCreateNewPopup["--arc-menu-separator"]);
    assert(props.urlbar["--arc-sidebar-command-background"].startsWith("rgb("));
  }
  assert.equal(spacePaletteProperties(null, "dark"), null);
});
test("Create menu stays dark and legible when the Space or app switches to light", () => {
  for (const { palette } of cases) {
    const light = spacePaletteProperties(palette, "light").zenCreateNewPopup;
    const dark = spacePaletteProperties(palette, "dark").zenCreateNewPopup;
    assert.deepEqual(light, dark);
    assert.equal(light["--arc-menu-background"], `color(srgb ${palette.dark.backgroundExtra.slice(0, 3).join(" ")} / 1)`);
    assert.equal(light["--arc-menu-shortcut"], `color(srgb ${palette.dark.subtitle.slice(0, 3).join(" ")} / 1)`);
    // Independent contrast bound: a light background must never accompany
    // this menu's fixed white labels, even for previously unseen theme colors.
    const luminance = palette.dark.backgroundExtra.slice(0, 3).map(c => Math.max(0, Math.min(1, c)))
      .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
      .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    assert(1.05 / (luminance + .05) >= 7);
  }
});
test("style ownership updates late elements and clears unsupported palettes without idle writes", () => {
  let writes = 0;
  const element = () => ({ style: { data: new Map(), getPropertyValue(k) { return this.data.get(k)?.[0] ?? ""; },
    getPropertyPriority(k) { return this.data.get(k)?.[1] ?? ""; },
    setProperty(k, v, p) { writes++; this.data.set(k, [v, p]); }, removeProperty(k) { writes++; this.data.delete(k); } } });
  const bar = element(), elements = new Map([["urlbar", bar]]);
  const document = { getElementById: id => elements.get(id), querySelector: id => elements.get(id) };
  const styles = new SpacePaletteStyles(), props = spacePaletteProperties(cases[0].palette, "dark");
  styles.apply(document, props); const count = writes;
  styles.apply(document, props); assert.equal(writes, count);
  elements.set("zen-library", element()); styles.apply(document, props);
  assert.equal(writes, count + 2);
  const next = element(); elements.set("urlbar", next); styles.apply(document, props);
  assert.equal(bar.style.data.size, 0); assert.equal(next.style.data.size, 4);
  styles.clear(); assert.equal(next.style.data.size, 0);
  assert.equal(elements.get("zen-library").style.data.size, 0);
});
