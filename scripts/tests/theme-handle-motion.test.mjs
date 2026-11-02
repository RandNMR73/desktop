import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ColorPadPositionSpring, ColorPadPositionMotion } from "../../src/zen/spaces/ZenThemeColorPad.mjs";
const reference = JSON.parse(readFileSync(new URL("./fixtures/theme-handle-position.json", import.meta.url)));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
for (const row of reference) {
  test(`native handle position: ${row.name}, reversal=${row.reversal}`, () => {
    const spring = new ColorPadPositionSpring([0, 0]);
    spring.write(row.samples[0].slice(1, 3), 0);
    for (const [ms, targetX, targetY, x, y, merge] of row.samples) {
      if (merge !== null) { assert.equal(merge, true); spring.write([targetX, targetY], ms / 1000); }
      const value = spring.sample(ms / 1000);
      near(value[0], x ?? targetX); near(value[1], y ?? targetY);
      assert.equal(spring.active, x !== null);
    }
  });
}

function fixture() {
  let time = 0, id = 0, reduced = false;
  const frames = new Map(), values = new Map();
  const clock = { performance: { now: () => time * 1000 },
    requestAnimationFrame(fn) { frames.set(++id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); },
    matchMedia: () => ({ matches: reduced }) };
  const motion = new ColorPadPositionMotion(clock, (control, value) => values.set(control, value));
  const advance = t => { time = t; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); };
  return { motion, frames, values, advance, reduced() { reduced = true; } };
}

test("three handles share a frame loop and direct dragging snaps to the exact model coordinates", () => {
  const f = fixture();
  for (const id of [0, 1, 2]) f.motion.set(id, [240, 160], [120, 180]);
  assert.equal(f.frames.size, 1); f.advance(.05);
  assert.ok(f.values.get(0)[0] > 120 && f.values.get(0)[0] < 240);
  f.motion.clear(true); assert.equal(f.frames.size, 0);
  for (const id of [0, 1, 2]) assert.deepEqual(f.values.get(id), [240, 160]);
  f.motion.set(0, [10, 20], [240, 160], false); assert.deepEqual(f.values.get(0), [10, 20]);
  assert.equal(f.frames.size, 0);
});

test("removed handles and closed editors cannot receive stale frames; reduced motion and rest are idle", () => {
  const f = fixture();
  f.motion.set(0, [60, 170], [180, 20]); f.motion.set(1, [20, 40], [0, 0]);
  f.advance(.03); const removed = f.values.get(0);
  f.motion.remove(0); for (let n = 1; n < 100; n++) f.advance(.03 + n * .02);
  assert.deepEqual(f.values.get(0), removed); assert.equal(f.frames.size, 0);
  assert.deepEqual(f.values.get(1), [20, 40]);
  f.motion.set(1, [20, 40], [0, 0]); assert.equal(f.frames.size, 0);
  f.motion.set(1, [0, 0], [20, 40]); f.motion.clear(); assert.equal(f.frames.size, 0); assert.equal(f.motion.controls.size, 0);
  f.reduced(); f.motion.set(0, [150, 100], [0, 0]); assert.deepEqual(f.values.get(0), [150, 100]); assert.equal(f.frames.size, 0);
});
