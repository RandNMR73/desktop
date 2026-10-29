// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Measured against two Arc viewport exports at 1472 CSS pixels wide. Smaller
// windows, unusual aspect ratios, and the other background modes still need
// reference measurements; do not treat this as an all-size parity certificate.
const EXPORT_WIDTH = 5088;
const PAGE_WIDTH = 4320;
const PADDING = 384;

export function portraitGeometry(width, height, targetWidth = EXPORT_WIDTH) {
  if (
    ![width, height, targetWidth].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    targetWidth <= 0
  )
    throw new RangeError("Invalid portrait dimensions");
  let scale = Math.min(targetWidth, EXPORT_WIDTH) / EXPORT_WIDTH;
  const naturalHeight = (PAGE_WIDTH * height) / width + PADDING * 2;
  if (!Number.isFinite(naturalHeight))
    throw new RangeError("Invalid portrait aspect ratio");
  // Bound both axes and total memory, including extremely tall/narrow panes.
  scale = Math.min(
    scale,
    16384 / naturalHeight,
    Math.sqrt((32 * 1024 * 1024) / (EXPORT_WIDTH * naturalHeight)),
  );
  const padding = PADDING * scale;
  return {
    width: Math.max(1, Math.floor(EXPORT_WIDTH * scale)),
    height: Math.max(1, Math.floor(naturalHeight * scale)),
    pageWidth: PAGE_WIDTH * scale,
    pageHeight: ((PAGE_WIDTH * height) / width) * scale,
    padding,
    scale,
  };
}

const stops = [
  ["srgb", 0.95, 0.918, 0.894],
  ["srgb", 0.95, 0.608, 0.733],
  ["srgb", 0.651, 0.447, 0.616],
  ["srgb", 0.949, 0.369, 0.42],
  ["linear", 1, 0.235, 0.097],
  ["p3", 0.95, 0.84, 0.428],
  ["p3", 0.451, 0.897, 0.612],
  ["p3", 0.496, 0.721, 0.838],
  ["p3", 0.401, 0.404, 0.527],
];
const linear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const encoded = (v) =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
const clamp = (v) => Math.min(1, Math.max(0, v));
const palette = stops.map(([space, ...rgb]) => {
  if (space === "srgb") return rgb;
  if (space === "linear") return rgb.map(encoded);
  const [r, g, b] = rgb.map(linear);
  return [
    1.224745 * r - 0.224904 * g,
    -0.042058 * r + 1.042081 * g,
    -0.019642 * r - 0.078655 * g + 1.098537 * b,
  ].map((v) => clamp(encoded(v)));
});

export function portraitColor(value) {
  const position =
    clamp(Number.isFinite(value) ? value : 0.875) * (palette.length - 1);
  const index = Math.min(Math.floor(position), palette.length - 2);
  return palette[index].map(
    (v, channel) => v + (palette[index + 1][channel] - v) * (position - index),
  );
}

export const PORTRAIT_COLOR_STOPS = palette.map(
  (rgb) => `rgb(${rgb.map((v) => Math.round(v * 255)).join(" ")})`,
);

/** One synchronous render: small preview while editing, full output on accept. */
export function drawPortrait(
  canvas,
  image,
  { color = 0.875, watermark = true } = {},
  targetWidth,
) {
  const g = portraitGeometry(image.width, image.height, targetWidth);
  canvas.width = g.width;
  canvas.height = g.height;
  const c = canvas.getContext("2d", { alpha: false });
  const delta = portraitColor(color).map((v, i) => v - palette[7][i]);
  // The default corners are color-managed samples of the reference export.
  // Palette adjustment is provisional until every Arc slider stop is sampled.
  const corners = [
    [146, 215, 238],
    [151, 186, 235],
    [79, 172, 196],
    [91, 140, 188],
  ];
  const adjusted = corners.map((rgb) =>
    rgb.map((v, i) => Math.round(clamp(v / 255 + delta[i] * 0.7) * 255)),
  );
  // Paint a tiny bilinear texture once, then scale it. Avoid a full-resolution
  // JS pixel loop on each slider event (the preview is only 280 pixels wide).
  // A 2x2 texture reveals the rasterizer's limited fractional sampling
  // precision when stretched to 5K. This 128x128 texture avoids those wide
  // steps while using only 64 KiB, independent of output resolution.
  const edge = 128;
  const strip = new OffscreenCanvas(edge, edge);
  const pixels = new ImageData(edge, edge);
  for (let y = 0; y < edge; ++y) {
    const vertical = y / (edge - 1);
    for (let x = 0; x < edge; ++x) {
      const horizontal = x / (edge - 1);
      const offset = (y * edge + x) * 4;
      for (let channel = 0; channel < 3; ++channel) {
        const top =
          adjusted[0][channel] * (1 - horizontal) +
          adjusted[1][channel] * horizontal;
        const bottom =
          adjusted[2][channel] * (1 - horizontal) +
          adjusted[3][channel] * horizontal;
        pixels.data[offset + channel] =
          top * (1 - vertical) + bottom * vertical;
      }
      pixels.data[offset + 3] = 255;
    }
  }
  strip.getContext("2d").putImageData(pixels, 0, 0);
  c.imageSmoothingEnabled = true;
  c.drawImage(strip, 0, 0, edge, edge, 0, 0, g.width, g.height);
  strip.width = strip.height = 0;
  const s = g.scale,
    p = g.padding;
  c.save();
  c.shadowColor = "rgba(0,0,0,.15)";
  c.shadowBlur = 36 * s;
  c.shadowOffsetY = 12 * s;
  c.fillStyle = "rgba(255,255,255,.55)";
  c.beginPath();
  c.roundRect(
    p - 16 * s,
    p - 16 * s,
    g.pageWidth + 32 * s,
    g.pageHeight + 32 * s,
    24 * s,
  );
  c.fill();
  c.restore();
  c.save();
  c.beginPath();
  c.roundRect(p, p, g.pageWidth, g.pageHeight, 9 * s);
  c.clip();
  c.drawImage(image, p, p, g.pageWidth, g.pageHeight);
  c.restore();
  if (watermark) {
    c.fillStyle = "rgba(255,255,255,.72)";
    c.font = `600 ${44 * s}px -apple-system, sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("Captured with Zen", g.width / 2, g.height - p / 2);
  }
  return g;
}
