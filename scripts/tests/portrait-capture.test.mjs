import assert from "node:assert/strict";
import test from "node:test";
import {
  portraitGeometry,
  portraitColor,
} from "../../src/zen/urlbar/ZenPortraitCaptureImage.mjs";

test("portrait export preserves viewport aspect and measured padding", () => {
  for (const [height, expectedHeight] of [
    [921, 3470],
    [926, 3485],
  ]) {
    const g = portraitGeometry(1472, height);
    // Arc's encoder rounds the source raster before export (within two pixels).
    assert.ok(Math.abs(g.height - expectedHeight) <= 2);
    assert.equal(g.width, 5088);
    assert.equal(g.padding, 384);
    assert.ok(Math.abs(g.pageWidth / g.pageHeight - 1472 / height) < 1e-10);
    const preview = portraitGeometry(1472, height, 280);
    assert.equal(preview.width, 280);
    assert.ok(preview.width * preview.height < 60000);
  }
});

test("portrait bounds prevent oversized allocations for unusually narrow panes", () => {
  for (const [width, height] of [
    [1, 16000],
    [100, 16000],
    [16000, 1],
    [1000, 1000],
  ]) {
    const g = portraitGeometry(width, height);
    assert.ok(g.width <= 16384 && g.height <= 16384);
    assert.ok(g.width * g.height <= 32 * 1024 * 1024);
  }
  for (const value of [NaN, Infinity, -1, 0])
    assert.throws(() => portraitGeometry(value, 100), RangeError);
  assert.throws(
    () => portraitGeometry(Number.MIN_VALUE, Number.MAX_VALUE),
    RangeError,
  );
});

test("palette handles endpoints, out-of-range settings and non-sRGB stops", () => {
  assert.deepEqual(portraitColor(-1), portraitColor(0));
  assert.deepEqual(portraitColor(2), portraitColor(1));
  assert.deepEqual(portraitColor(NaN), portraitColor(0.875));
  // The fifth stop is linear RGB: interpreting it as encoded sRGB would make
  // its green channel .235 instead of approximately .522.
  assert.ok(portraitColor(0.5)[1] > 0.52 && portraitColor(0.5)[1] < 0.53);
  for (let step = 0; step <= 1000; ++step)
    assert.ok(
      portraitColor(step / 1000).every(
        (v) => Number.isFinite(v) && v >= 0 && v <= 1,
      ),
    );
});
