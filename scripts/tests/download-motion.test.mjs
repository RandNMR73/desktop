import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { downloadSpring, retargetDownloadMotion, sampleDownloadMotion,
  downloadRowFrames, downloadBadgeGeometry, downloadBadgeFrames, DOWNLOAD_SPRING_DURATION }
  from "../../src/zen/library/ZenDownloadMotion.sys.mjs";

const native = JSON.parse(fs.readFileSync(new URL(
  "../../tools/download-preview/native-spring-samples.json", import.meta.url)));

test("download spring matches native SwiftUI values and velocities", () => {
  assert.equal(DOWNLOAD_SPRING_DURATION, native.settlingDuration);
  for (const sample of native.samples) {
    for (const point of sample.values) {
      const actual = downloadSpring(0, sample.initialVelocity, 1, point.time);
      assert.ok(Math.abs(actual.value - point.value) < 1e-12);
      assert.ok(Math.abs(actual.velocity - point.velocity) < 1e-11);
    }
  }
});

const badgeGeometry = { width: 212, iconX: 22, iconY: 26, dx: 6, dy: 30, distance: 20 };
const rest = (value, time = 0) => ({ value, velocity: 0, target: value,
  start: time, end: time, previous: null });

test("completed badge follows independently rendered native layout frames", () => {
  const samples = JSON.parse(fs.readFileSync(new URL(
    "../../tools/download-preview/badge-blocks-reference.json", import.meta.url)));
  for (const { bounds: b } of samples) {
    const p = (284 - b.centerY) / 30;
    const g = downloadBadgeGeometry(p, 1, badgeGeometry);
    assert.ok(Math.abs(6 + g.x + 22 * g.scale - b.centerX) < 0.04);
    assert.ok(Math.abs(40 * g.scale - Math.sqrt(b.redArea)) < 0.1);
    if (b.blueArea > 10) {
      const detailsCenter = 6 + g.x + (22 + 108 + g.detailsX) * g.scale;
      assert.ok(Math.abs(detailsCenter - b.blueX) < 0.08);
      assert.ok(Math.abs(b.blueArea / (4864 * g.scale ** 2) - g.detailsOpacity) < 0.004);
    }
  }
});

test("consumed badge keeps expanding during an interrupted close", () => {
  const opening = retargetDownloadMotion(rest(0), 1, 0);
  const visible = rest(1);
  for (const time of [0.02, 0.05, 0.1, 0.2]) {
    const expansion = retargetDownloadMotion(opening, 1, time);
    const closing = retargetDownloadMotion(visible, 0, time);
    const before = downloadBadgeGeometry(sampleDownloadMotion(opening, time).value, 1, badgeGeometry);
    const after = downloadBadgeGeometry(sampleDownloadMotion(expansion, time).value,
      sampleDownloadMotion(closing, time).value, badgeGeometry);
    assert.deepEqual(after, before, "no position, size or opacity discontinuity");
    const end = downloadBadgeGeometry(sampleDownloadMotion(expansion, 1).value,
      sampleDownloadMotion(closing, 1).value, badgeGeometry);
    assert.equal(end.scale, 1, "completed badge never shrinks back onto the button");
    assert.equal(end.y, 20);
    assert.equal(end.opacity, 0);
  }
});

test("badge compositor frames preserve native curve across widths and reversals", () => {
  for (const width of [160, 212, 360, 984]) {
    let expansion = rest(0), visibility = rest(1);
    for (const [i, now] of [0, 0.05, 0.09, 0.14, 0.22].entries()) {
      expansion = retargetDownloadMotion(expansion, 1, now);
      visibility = retargetDownloadMotion(visibility, i % 2 ? 0 : 1, now);
      const geometry = { ...badgeGeometry, width };
      const frames = downloadBadgeFrames(expansion, visibility, now, geometry);
      const values = f => f.transform.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g).map(Number);
      for (let j = 1; j < frames.row.length; j++) {
        const a = frames.row[j - 1], b = frames.row[j];
        const t = now + (a.offset + b.offset) / 2 * frames.duration / 1000;
        const g = downloadBadgeGeometry(sampleDownloadMotion(expansion, t).value,
          sampleDownloadMotion(visibility, t).value, geometry);
        const av = values(a), bv = values(b), v = av.map((x, k) => (x + bv[k]) / 2);
        assert.ok(Math.abs(v[0] + width * v[2] - g.x - width * g.scale) < 0.02);
        assert.ok(Math.abs(v[1] - g.y) < 0.02);
        assert.ok(Math.abs((a.opacity + b.opacity) / 2 - g.opacity) < 0.001);
      }
    }
  }
});

test("reversing a moving row preserves both position and momentum", () => {
  const opening = retargetDownloadMotion(null, 1, 0);
  const before = sampleDownloadMotion(opening, 0.05);
  const closing = retargetDownloadMotion(opening, 0, 0.05);
  const after = sampleDownloadMotion(closing, 0.05);
  assert.ok(Math.abs(before.value - after.value) < 1e-12);
  assert.ok(Math.abs(before.velocity - after.velocity) < 1e-12);
  assert.ok(after.velocity > 0, "closing initially continues the incoming motion");
  assert.ok(sampleDownloadMotion(closing, 0.07).velocity < 0, "then reverses naturally");
});

test("a staggered reversal continues the previous curve until its start", () => {
  const opening = retargetDownloadMotion(null, 1, 0);
  const closing = retargetDownloadMotion(opening, 0, 0.05, 0.0375);
  for (const t of [0.05, 0.06, 0.075, 0.087499]) {
    assert.deepEqual(sampleDownloadMotion(closing, t), sampleDownloadMotion(opening, t));
  }
  const before = sampleDownloadMotion(opening, closing.start);
  const after = sampleDownloadMotion(closing, closing.start);
  assert.ok(Math.abs(before.value - after.value) < 1e-12);
  assert.ok(Math.abs(before.velocity - after.velocity) < 1e-12);
});

test("row keyframes use native distances and a bounded interpolation error", () => {
  for (const distance of [20, 56]) {
    const motion = retargetDownloadMotion(null, 1, 0, 0.0375);
    const frames = downloadRowFrames(motion, 0, distance);
    assert.equal(frames[0].transform, `translateY(${distance}px)`);
    assert.equal(frames.at(-1).transform, "translateY(0px)");
    assert.equal(frames.at(-1).opacity, 1);
    const y = f => Number(f.transform.slice(11, -3));
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1], b = frames[i];
      const time = (a.offset + b.offset) / 2 * motion.end;
      const actual = distance * (1 - sampleDownloadMotion(motion, time).value);
      assert.ok(Math.abs((y(a) + y(b)) / 2 - actual) < 0.02);
    }
  }
});

test("repeated reversals settle at the final requested state", () => {
  let motion;
  for (const [i, time] of [0, 0.04, 0.075, 0.1, 0.15, 0.2].entries()) {
    motion = retargetDownloadMotion(motion, i % 2 ? 0 : 1, time, 0.0125);
    const frames = downloadRowFrames(motion, time, 56);
    assert.ok(frames.every(f => Number.isFinite(f.offset) && f.opacity >= 0 && f.opacity <= 1));
  }
  assert.deepEqual(sampleDownloadMotion(motion, 1), { value: 0, velocity: 0 });
});

test("reduced keyframes retain the native curve with incoming velocity", () => {
  for (const sample of native.samples) {
    const motion = { value: 0, velocity: sample.initialVelocity, target: 1,
      start: 0, end: DOWNLOAD_SPRING_DURATION, previous: null };
    const frames = downloadRowFrames(motion, 0, 56);
    assert.ok(frames.length < 150, "avoid sending redundant compositor keyframes");
    for (const point of sample.values.filter(p => p.time < motion.end)) {
      const offset = point.time / motion.end;
      const i = frames.findIndex(f => f.offset >= offset);
      const a = frames[Math.max(0, i - 1)], b = frames[i];
      const fraction = i ? (offset - a.offset) / (b.offset - a.offset) : 0;
      const y = f => Number(f.transform.slice(11, -3));
      const rendered = y(a) + (y(b) - y(a)) * fraction;
      assert.ok(Math.abs(rendered - 56 * (1 - point.value)) < 0.02);
    }
  }
});
