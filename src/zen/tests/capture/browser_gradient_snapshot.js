/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function gradient_snapshot_preserves_color_stop_positions() {
  const fixture = gradientSnapshotFixture();
  await BrowserTestUtils.withNewTab(fixture.url, async (browser) => {
    // drawSnapshot exercises the software paint path. A normal WebRender
    // reftest would miss this defect because the live page already looks right.
    for (const scale of [1, 2]) {
      for (const result of await checkGradientSnapshot(
        browser,
        fixture,
        scale,
      )) {
        for (const sample of result.samples) {
          Assert.ok(
            sample.pass,
            `${result.name} at ${scale}x (${sample.x},${sample.y}): ` +
              `expected ${sample.expected}, got ${sample.actual}`,
          );
        }
      }
    }
  });
});
