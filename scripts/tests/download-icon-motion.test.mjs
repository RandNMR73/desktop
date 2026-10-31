import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { updateDownloadIcon, sampleDownloadIcon, downloadIconFrames } from
  "../../src/zen/library/ZenDownloadMotion.sys.mjs";

const reference = JSON.parse(fs.readFileSync(new URL(
  "../../tools/download-preview/icon-trajectory-reference.json", import.meta.url)));
for (const scenario of reference) {
  test(`download icon follows native SwiftUI through ${scenario.case}`, () => {
    let state;
    const inputs = scenario.events.filter(event => ["arrival", "dismissal", "reset"].includes(event.action));
    for (const point of scenario.samples) {
      for (const input of inputs.filter(event => event.milliseconds === point.milliseconds)) {
        state = updateDownloadIcon(state, input.action, input.milliseconds);
        const animation = downloadIconFrames(state, input.milliseconds);
        if (!animation) continue;
        assert.ok(animation.frames.length < 260, "bounded compositor keyframes");
        for (let i = 1; i < animation.frames.length; i++) {
          const a = animation.frames[i - 1], b = animation.frames[i];
          const y = frame => Number(frame.translate.split(" ")[1].replace("px", ""));
          const scale = frame => Number(frame.transform.match(/scale\(([^)]+)\)/)[1]);
          for (const fraction of [.25, .5, .75]) {
            const time = input.milliseconds + (a.offset + (b.offset - a.offset) * fraction) * animation.duration;
            const expected = sampleDownloadIcon(state, time);
            assert.ok(Math.abs(y(a) + (y(b) - y(a)) * fraction - expected.y) < .0011);
            assert.ok(20 * Math.abs(scale(a) + (scale(b) - scale(a)) * fraction - expected.scale) < .0021);
          }
        }
      }
      const actual = sampleDownloadIcon(state, point.milliseconds);
      // Native rendering settles once residual displacement is about 0.003pt.
      // The independent analytic spring retains that subpixel tail longer.
      assert.ok(Math.abs(actual.y - point.y) < .004,
        `${point.milliseconds}ms y: ${actual.y} versus ${point.y}`);
      assert.ok(Math.abs(actual.scale - point.scale) < .00001,
        `${point.milliseconds}ms scale: ${actual.scale} versus ${point.scale}`);
    }
  });
}
