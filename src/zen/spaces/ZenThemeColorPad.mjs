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

// Arc 1.171.0 preset catalog (0x1017bdd34): nine Brand solids, the same
// nine with two analogous companions, then Pastel, Drab and Greyscale solids.
// Values are the bundled NSColor assets resolved in Display P3, not sampled
// from screenshots or converted through an 8-bit sRGB swatch.
const PRESET_COLORS = Object.freeze({
  Brand: Object.freeze([
    Object.freeze([0.9444217085838318, 0.9190871715545654, 0.8967581987380981]),
    Object.freeze([0.9014095664024353, 0.6234707236289978, 0.7293687462806702]),
    Object.freeze([0.6209162473678589, 0.45569396018981934, 0.6063727736473083]),
    Object.freeze([0.8808955550193787, 0.4071536660194397, 0.4333076477050781]),
    Object.freeze([0.9377320408821106, 0.5472550392150879, 0.3847135305404663]),
    Object.freeze([0.949999988079071, 0.8399999737739563, 0.42800000309944153]),
    Object.freeze([0.45100000500679016, 0.8970000147819519, 0.6119999885559082]),
    Object.freeze([0.4959999918937683, 0.7210000157356262, 0.8379999995231628]),
    Object.freeze([0.4009999930858612, 0.40400001406669617, 0.5270000100135803]),
  ]),
  Pastel: Object.freeze([
    Object.freeze([0.9940000176429749, 0.984000027179718, 0.9810000061988831]),
    Object.freeze([0.9850000143051147, 0.9169999957084656, 0.9509999752044678]),
    Object.freeze([0.9240000247955322, 0.824999988079071, 0.9179999828338623]),
    Object.freeze([0.9679999947547913, 0.8040000200271606, 0.8220000267028809]),
    Object.freeze([0.9800000190734863, 0.8820000290870667, 0.8339999914169312]),
    Object.freeze([0.9959999918937683, 0.9769999980926514, 0.906000018119812]),
    Object.freeze([0.8939999938011169, 0.9879999756813049, 0.9259999990463257]),
    Object.freeze([0.8799999952316284, 0.949999988079071, 0.984000027179718]),
    Object.freeze([0.7739999890327454, 0.7760000228881836, 0.8880000114440918]),
  ]),
  Drab: Object.freeze([
    Object.freeze([0.2939999997615814, 0.23100000619888306, 0.3449999988079071]),
    Object.freeze([0.3840000033378601, 0.2199999988079071, 0.3370000123977661]),
    Object.freeze([0.5220000147819519, 0.2669999897480011, 0.2669999897480011]),
    Object.freeze([0.6549999713897705, 0.4390000104904175, 0.28200000524520874]),
    Object.freeze([0.8199999928474426, 0.7059999704360962, 0.41600000858306885]),
    Object.freeze([0.8040000200271606, 0.800000011920929, 0.6589999794960022]),
    Object.freeze([0.5180000066757202, 0.6589999794960022, 0.5220000147819519]),
    Object.freeze([0.20399999618530273, 0.37599998712539673, 0.2939999997615814]),
    Object.freeze([0.17599999904632568, 0.2669999897480011, 0.40799999237060547]),
  ]),
  Greyscale: Object.freeze([
    Object.freeze([1, 1, 1]),
    Object.freeze([0.8999999761581421, 0.8999999761581421, 0.8999999761581421]),
    Object.freeze([0.800000011920929, 0.800000011920929, 0.800000011920929]),
    Object.freeze([0.699999988079071, 0.699999988079071, 0.699999988079071]),
    Object.freeze([0.5, 0.5, 0.5]),
    Object.freeze([0.4000000059604645, 0.4000000059604645, 0.4000000059604645]),
    Object.freeze([0.20000000298023224, 0.20000000298023224, 0.20000000298023224]),
    Object.freeze([0.10000000149011612, 0.10000000149011612, 0.10000000149011612]),
    Object.freeze([0, 0, 0]),
  ]),
});

export const COLOR_PAD_PRESET_PAGES = Object.freeze([
  ["Brand", 1], ["Brand", 3], ["Pastel", 1], ["Drab", 1], ["Greyscale", 1],
].map(([group, count], page) => Object.freeze(PRESET_COLORS[group].map((p3, index) =>
  Object.freeze({ id: `${page}-${index}`, group, index: index + 1, p3, count,
    wheel: count === 3 ? "analogous" : "complementary" })))));

export function colorPadPresetColors(preset) {
  const primary = [...preset.p3];
  if (preset.count === 1) return [primary];
  const [hue, saturation, lightness] = colorPadHSL(primary);
  return [primary, ...[40, -40].map(angle =>
    colorPadRGB([hue + angle / 360, saturation, lightness]))];
}

// Arc's SineSlider (0x1017b0774) and SineWave.path (0x1017b2074).
// The reference samples at one-point intervals, with this phase divisor;
// it is deliberately 2*pi - .25, not an integral number of waves.
const INTENSITY_WAVE = Array.from({ length: 209 }, (_, x) =>
  Math.sin(x / (2 * Math.PI - .25) + Math.PI));
export function intensitySliderGeometry(value) {
  const v = clamp(Number.isFinite(value) ? value : 0);
  const amplitude = 15 * v;
  const thumbWidth = 12 + amplitude;
  const thumbX = 8 + 208 * v;
  return { value: v, amplitude, thumbWidth, thumbHeight: 44 + amplitude,
    thumbX, progressWidth: thumbX - thumbWidth / 2,
    path: "M 8 22 " + INTENSITY_WAVE.map((y, x) => `L ${8 + x} ${22 + amplitude * y}`).join(" ") };
}

export function intensitySliderValueAt(x, width = 224) {
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 16) return null;
  return clamp((x - 8) / (width - 16));
}

// SpaceStyleDialView and its reducer in Arc 1.171.0: clockwise from noon,
// 5% detents, inclusive endpoints. Rotation gestures alone stay continuous.
export function textureDialValue(value, gesture = "drag") {
  if (!Number.isFinite(value)) return null;
  const bounded = clamp(value);
  return gesture === "rotation" ? bounded : Math.round(bounded * 20) / 20;
}

export function textureDialValueAt(x, y, dimension = 80) {
  if (![x, y, dimension].every(Number.isFinite) || dimension <= 0) return null;
  let angle = Math.atan2(y - dimension / 2, x - dimension / 2) + Math.PI / 2;
  if (angle < 0) angle += Math.PI * 2;
  return textureDialValue(angle / (Math.PI * 2));
}

  // The reference offsets its dots downward before rotating 1..<20 by 18deg.
const TEXTURE_DIAL_DOTS = Object.freeze( Array.from({ length: 19 }, (_, i) => {
    const a = (i + 1) * Math.PI / 10;
    return Object.freeze({ x: 40 - Math.sin(a) * 32, y: 40 + Math.cos(a) * 32 });
  }));

export function textureDialGeometry(value) {
  const noise = Number.isFinite(value) ? clamp(value) : 0;
  const angle = noise * Math.PI * 2;
  const x = 40 + Math.sin(angle) * 32, y = 40 - Math.cos(angle) * 32;
  const mask = noise === 0 ? "" : noise === 1
    ? "M 40 8 A 32 32 0 1 1 40 72 A 32 32 0 1 1 40 8"
    : `M 40 8 A 32 32 0 ${noise > .5 ? 1 : 0} 1 ${x} ${y}`;
  return { value: noise, x, y, angle: noise * 360, dots: TEXTURE_DIAL_DOTS, mask };
}

// Center clicks include an off state. Turning it back on restores 80%.
export function nextTextureDialState(noise, texture) {
  const textures = ["grain", "sand", "denim", "tweed"];
  const index = textures.indexOf(texture);
  if (!noise) return { noise: .8, texture: index < 0 ? "grain" : texture };
  if (index === 3) return { noise: 0, texture: "grain" };
  return { noise, texture: textures[Math.max(0, index) + 1] };
}

export function textureDialCrossesHaptic(previous, next) {
  if (previous === next) return false;
  const lo = Math.min(previous, next), hi = Math.max(previous, next);
  for (let i = 0; i <= 10; i++) {
    const value = i * .1;
    if (lo <= value && value <= hi) return true;
  }
  return false;
}
