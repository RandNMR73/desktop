/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// All coordinates are CSS pixels. Hard stops and neutral colors let the checks
// distinguish incorrect gradient geometry from color-profile rounding.
function gradientSnapshotFixture() {
  const white = [255, 255, 255],
    black = [0, 0, 0];
  const stripePoints = [
    [12, 10, white],
    [12, 78, white],
    [12, 79, black],
    [12, 80, white],
    [12, 158, white],
    [12, 159, black],
  ];
  const cases = [];
  for (const space of ["srgb", "oklab"]) {
    const add = (name, background, points, extra = "", height = 2000) =>
      cases.push({
        name: `${space}/${name}`,
        background,
        points,
        extra,
        height,
      });
    add(
      "tall-linear",
      `repeating-linear-gradient(in ${space}, white 0 79px, black 79px 80px)`,
      stripePoints,
    );
    add(
      "short-linear",
      `repeating-linear-gradient(in ${space}, white 0 79px, black 79px 80px)`,
      stripePoints,
      "",
      256,
    );
    add(
      "shifted-linear",
      `repeating-linear-gradient(in ${space}, white -20px 59px, black 59px 60px)`,
      [
        [12, 10, white],
        [12, 58, white],
        [12, 59, black],
        [12, 60, white],
        [12, 139, black],
      ],
    );
    add(
      "transparent-linear",
      `repeating-linear-gradient(in ${space}, transparent 0 79px, #7774 79px 80px)`,
      [
        [12, 10, white],
        [12, 78, white],
        [12, 79, [219, 219, 219]],
        [12, 80, white],
      ],
    );
    add(
      "outside-box",
      `linear-gradient(in ${space}, white -2000px 79px, black 79px 4000px)`,
      [
        [12, 10, white],
        [12, 78, white],
        [12, 79, black],
        [12, 150, black],
      ],
    );
    add(
      "degenerate",
      `repeating-linear-gradient(in ${space}, white 20px, black 20px)`,
      [
        [12, 10, black],
        [12, 78, black],
        [12, 150, black],
      ],
    );
    add(
      "radial",
      `repeating-radial-gradient(circle at 0 0 in ${space}, white 0 60px, black 60px 64px)`,
      [
        [10, 1, white],
        [62, 1, black],
        [66, 1, white],
        [1, 62, black],
        [1, 66, white],
      ],
    );
    add(
      "conic",
      `repeating-conic-gradient(from 0deg at 64px 64px in ${space}, white 0deg 60deg, black 60deg 90deg)`,
      [
        [64, 8, white],
        [112, 40, black],
        [112, 64, white],
        [88, 16, white],
        [88, 112, black],
      ],
    );
    add(
      "opacity",
      `repeating-linear-gradient(in ${space}, white 0 60px, black 60px 64px)`,
      [
        [12, 10, white],
        [12, 62, "half-opacity"],
        [12, 66, white],
      ],
      "opacity:0.5;",
    );
    add(
      "color-ramp",
      `repeating-linear-gradient(in ${space}, red 0px, blue 80px)`,
      [5, 20, 40, 60, 75].map((y) => [
        12,
        y,
        { reference: [716, (space === "srgb" ? 32 : 240) + y] },
      ]),
    );
  }
  const width = 736,
    height = Math.ceil(cases.length / 4) * 208;
  let html = `<!doctype html><meta charset="utf-8"><title>Gradient snapshot regression</title>
    <style>*{box-sizing:border-box}body{margin:0;background:white;color:black;font:12px sans-serif}
    .clip{position:absolute;width:160px;height:176px;overflow:hidden;background:white}
    .fill{width:160px}label{position:absolute;height:32px}</style>
    <div style="position:absolute;left:708px;top:0;width:16px;height:16px;background:black;opacity:0.5"></div>`;
  // A background-size tile normalizes its line to an 80px image. It is an
  // independent reference for a short CSS repeat painted in a tall element.
  for (const [index, space] of ["srgb", "oklab"].entries()) {
    html += `<div style="position:absolute;left:708px;top:${32 + index * 208}px;width:16px;height:176px;
      background:linear-gradient(in ${space}, red 0px, blue 80px);background-size:100% 80px"></div>`;
  }
  for (const [index, entry] of cases.entries()) {
    entry.x = (index % 4) * 176;
    entry.y = Math.floor(index / 4) * 208 + 32;
    html += `<label style="left:${entry.x}px;top:${entry.y - 32}px">${entry.name}</label>
      <div class="clip" style="left:${entry.x}px;top:${entry.y}px"><div class="fill"
      style="height:${entry.height}px;background:${entry.background};${entry.extra}"></div></div>`;
  }
  return {
    cases,
    width,
    height,
    url: "data:text/html;charset=utf-8," + encodeURIComponent(html),
  };
}

async function checkGradientSnapshot(browser, fixture, scale, win = window) {
  const bitmap = await browser.browsingContext.currentWindowGlobal.drawSnapshot(
    new win.DOMRect(0, 0, fixture.width, fixture.height),
    scale,
    "white",
  );
  const canvas = new win.OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  try {
    ctx.drawImage(bitmap, 0, 0);
    // Use a separate solid-color layer for opacity, so this checks identical
    // compositing without baking the backend's 8-bit alpha rounding into it.
    const halfOpacity = Array.from(
      ctx.getImageData(716 * scale, 8 * scale, 1, 1).data,
    ).slice(0, 3);
    return fixture.cases.map((entry) => {
      const samples = entry.points.map(([x, y, reference]) => {
        const expected =
          reference === "half-opacity"
            ? halfOpacity
            : reference.reference
              ? Array.from(
                  ctx.getImageData(
                    reference.reference[0] * scale,
                    reference.reference[1] * scale,
                    1,
                    1,
                  ).data,
                ).slice(0, 3)
              : reference;
        const actual = Array.from(
          ctx.getImageData(
            Math.floor((entry.x + x) * scale),
            Math.floor((entry.y + y) * scale),
            1,
            1,
          ).data,
        ).slice(0, 3);
        return {
          x,
          y,
          expected,
          actual,
          pass: actual.every((v, i) => Math.abs(v - expected[i]) <= 1),
        };
      });
      return {
        name: entry.name,
        scale,
        pass: samples.every((s) => s.pass),
        samples,
      };
    });
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}
