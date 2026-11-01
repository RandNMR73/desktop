import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { downloadHoverPath } from "../../src/zen/library/ZenDownloadThumbnailMotion.sys.mjs";

const reference = JSON.parse(fs.readFileSync(new URL(
  "../../tools/download-preview/hover-row-native.json", import.meta.url)));

for (const native of reference) {
  test(`hover mask follows the native continuous path at ${native.width}pt`, () => {
    assert.deepEqual(native.backgroundBounds, [0, 4, native.width, 48]);
    const actual = downloadHoverPath(native.width).match(/[MLCQZ]|-?\d+(?:\.\d+)?/g);
    const expected = native.path.flat();
    assert.equal(actual.length, expected.length);
    expected.forEach((value, index) => {
      if (typeof value === "string") assert.equal(actual[index], value);
      else assert.ok(Math.abs(Number(actual[index]) - value) < 0.000001,
        `coordinate ${index}: ${actual[index]} != ${value}`);
    });
  });
}
