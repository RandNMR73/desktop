/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Arc 1.171.0: SpaceStyleColorPadState (0x1017a76c8), drag conversion
// (0x1017a79ec), and initial lightness range (0x1017a9bb4).
// Positions are normalized about the pad center, independently of its size.
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
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const decode = c => Math.sign(c) * (Math.abs(c) <= .04045
  ? Math.abs(c) / 12.92 : ((Math.abs(c) + .055) / 1.055) ** 2.4);
const encode = c => Math.sign(c) * (Math.abs(c) <= .0031308
  ? Math.abs(c) * 12.92 : 1.055 * Math.abs(c) ** (1 / 2.4) - .055);
function convert(rgb, matrix) {
  const linear = rgb.map(decode);
  return matrix.map(row => encode(row.reduce((sum, v, i) => sum + v * linear[i], 0)));
}
function validRGB(rgb) {
  return Array.isArray(rgb) && rgb.length === 3 &&
    rgb.every(c => Number.isFinite(c) && Math.abs(c) <= 4);
}

export function colorPadP3(rgb, space = "srgb") {
  if (!validRGB(rgb) || !["srgb", "display-p3"].includes(space)) return null;
  return (space === "display-p3" ? [...rgb] : convert(rgb, SRGB_TO_P3)).map(c => clamp(c));
}

export function colorPadSRGB(p3) {
  return validRGB(p3) ? convert(p3, P3_TO_SRGB) : null;
}

export function colorPadHSL(rgb) {
  if (!validRGB(rgb)) return null;
  const [r, g, b] = rgb, max = Math.max(...rgb), min = Math.min(...rgb);
  const lightness = (max + min) / 2, delta = max - min;
  if (!delta) return [0, 0, lightness];
  const saturation = delta / (lightness > .5 ? 2 - max - min : max + min);
  const hue = max === r ? (g - b) / delta + (g < b ? 6 : 0)
    : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [hue / 6, saturation, lightness];
}

export function colorPadRGB([hue, saturation, lightness]) {
  if (![hue, saturation, lightness].every(Number.isFinite)) return null;
  const s = clamp(saturation), l = clamp(lightness);
  if (!s) return [l, l, l];
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [hue + 1 / 3, hue, hue - 1 / 3].map(t => {
    t = ((t % 1) + 1) % 1;
    return t < 1 / 6 ? p + (q - p) * 6 * t
      : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
  });
}

export function colorPadRange(lightness, appearance = "automatic") {
  if (!Number.isFinite(lightness)) return null;
  const l = clamp(lightness);
  let range;
  if (appearance === "dark") range = [.01, .425];
  else if (appearance === "light") range = [.575, .97];
  else return [Math.max(.01, l - .25), Math.min(.97, l + .25)];
  // A forced appearance expands its initial range to include the saved color.
  return [Math.min(range[0], l), Math.max(range[1], l)];
}

function validRange(range) {
  return Array.isArray(range) && range.length === 2 && range.every(Number.isFinite) &&
    range[0] >= 0 && range[1] <= 1 && range[0] <= range[1];
}

export function colorPadPosition(p3, range) {
  if (!validRange(range)) return null;
  const hsl = colorPadHSL(p3);
  if (!hsl) return null;
  const [h, , l] = hsl;
  const radius = range[0] === range[1] ? 0 : .99 * clamp((l - range[0]) / (range[1] - range[0]));
  return { x: Math.cos(h * Math.PI * 2) * radius, y: Math.sin(h * Math.PI * 2) * radius };
}

export function colorPadColor(position, saturation, range) {
  if (!position || ![position.x, position.y, saturation].every(Number.isFinite) || !validRange(range)) return null;
  const h = ((Math.atan2(position.y, position.x) / (Math.PI * 2)) + 1) % 1;
  const fraction = clamp(Math.hypot(position.x, position.y) / .99);
  return colorPadRGB([h, saturation, range[0] + fraction * (range[1] - range[0])]);
}

