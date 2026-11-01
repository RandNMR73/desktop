/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Arc's Space dock uses the target theme's maxContrastColor: shadedDark in
// a light appearance, tintedLight in a dark appearance. Its palette builder
// changes HSL lightness in .01 steps, measuring luminance in the input RGB
// space (the Arc color pad uses Display P3). No icon or Space names participate.
const SRGB_TO_P3 = [
  [.822461969, .177538031, 0],
  [.033194199, .966805801, 0],
  [.017082631, .072397441, .910519928],
];
const P3_TO_SRGB = [
  [1.224940176, -.224940176, 0],
  [-.042056955, 1.042056955, 0],
  [-.019637555, -.078636046, 1.098273601],
];
const decode = c => Math.sign(c) * (Math.abs(c) <= .04045
  ? Math.abs(c) / 12.92 : ((Math.abs(c) + .055) / 1.055) ** 2.4);
const encode = c => Math.sign(c) * (Math.abs(c) <= .0031308
  ? Math.abs(c) * 12.92 : 1.055 * Math.abs(c) ** (1 / 2.4) - .055);
function convert(rgb, matrix) {
  const linear = rgb.map(decode);
  return matrix.map(row => encode(row.reduce((sum, v, i) => sum + v * linear[i], 0)));
}
function luminance(rgb) {
  return rgb.reduce((sum, c, i) => sum + [.2126, .7152, .0722][i] *
    (c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4), 0);
}
function hsl(rgb) {
  const [r, g, b] = rgb, max = Math.max(...rgb), min = Math.min(...rgb);
  const l = (max + min) / 2, delta = max - min;
  if (!delta) return [0, 0, l];
  const s = delta / (l > .5 ? 2 - max - min : max + min);
  const h = max === r ? (g - b) / delta + (g < b ? 6 : 0)
    : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [h / 6, s, l];
}
function rgb([h, s, l]) {
  if (!s) return [l, l, l];
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [h + 1 / 3, h, h - 1 / 3].map(t => {
    t = (t + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t
      : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  });
}
function adjust(input, low, high) {
  let value = [...input];
  // At most 100 lightness steps for valid RGB; keep malformed input bounded.
  for (let step = 0; step <= 101; step++) {
    const y = luminance(value);
    if (y >= low && y <= high) return value;
    const [h, s, l] = hsl(value);
    value = rgb([h, s, Math.max(0, Math.min(1, l + (y < low ? .01 : -.01)))]);
  }
  return value;
}

export function spaceIconPalette(input, space = "srgb") {
  if (!["srgb", "display-p3"].includes(space) || !Array.isArray(input) ||
      input.length !== 3 || input.some(c => !Number.isFinite(c) || c < 0 || c > 1)) return null;
  const primary = space === "srgb" ? convert(input, SRGB_TO_P3) : input;
  return {
    light: [...convert(adjust(primary, 0, .1), P3_TO_SRGB), 1],
    dark: [...convert(adjust(primary, .85, .95), P3_TO_SRGB), 1],
  };
}

export function spaceIconPaletteCSS(palette) {
  if (!palette || ![palette.light, palette.dark].every(rgba =>
    Array.isArray(rgba) && rgba.length === 4 && rgba.every(Number.isFinite) &&
    rgba.slice(0, 3).every(v => Math.abs(v) <= 4) && rgba[3] >= 0 && rgba[3] <= 1)) return null;
  const css = rgba => `color(srgb ${rgba.slice(0, 3).join(" ")} / ${rgba[3]})`;
  return `light-dark(${css(palette.light)}, ${css(palette.dark)})`;
}

// Preserve saved legacy URLs; use the same catalog outline at render time.
export function spaceIconSource(url) {
  const prefix = "chrome://browser/skin/zen-icons/selectable/";
  const aliases = { planet: "planet", bell: "notifications", flame: "bonfire",
    lightning: "flash", leaf: "leaf" };
  const name = url?.startsWith(prefix) ? url.slice(prefix.length, -4) : null;
  return name && Object.hasOwn(aliases, name) && url.endsWith(".svg") ? `${prefix}arc-${aliases[name]}.svg` : url;
}
