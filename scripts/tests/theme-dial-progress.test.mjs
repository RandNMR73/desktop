import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TextureDialProgressMotion } from "../../src/zen/spaces/ZenThemeColorPad.mjs";
const reference = JSON.parse(readFileSync(new URL("./fixtures/theme-dial-progress.json", import.meta.url)));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

function fixture() {
  let time = 0, id = 0, reduced = false;
  const frames = new Map(), values = [];
  const clock = { performance: { now: () => time * 1000 },
    requestAnimationFrame(fn) { frames.set(++id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    matchMedia: () => ({ matches: reduced }) };
  const motion = new TextureDialProgressMotion(clock, value => values.push(value));
  const advance = t => { time = t; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); };
  return { motion, frames, values, advance, time(t) { time = t; }, reduced() { reduced = true; } };
}

for (const row of reference) {
  test(`native default.speed(3) mask: amplitude=${row.amplitude}, reversal=${row.reversal}`, () => {
    const f = fixture(); f.motion.set(0); f.motion.set(row.amplitude);
    for (const [ms, target, value, merge] of row.samples) {
      f.time(ms / 1000);
      if (merge !== null) { assert.equal(merge, true); f.motion.set(target); }
      f.advance(ms / 1000);
      near(f.values.at(-1), value ?? target);
      assert.equal(f.motion.spring.active, value !== null);
      assert.equal(f.frames.size, value !== null ? 1 : 0);
    }
  });
}

test("opening, switching Spaces, disabling and reduced motion snap without idle frames", () => {
  const f = fixture(); f.motion.set(.3); assert.deepEqual(f.values, [.3]); assert.equal(f.frames.size, 0);
  f.motion.set(.8); f.advance(.02); assert.ok(f.values.at(-1) > .3 && f.values.at(-1) < .8);
  f.motion.set(.4, false); assert.equal(f.values.at(-1), .4); assert.equal(f.frames.size, 0);
  const count = f.values.length; f.motion.set(.4); assert.equal(f.values.length, count); assert.equal(f.frames.size, 0);
  f.motion.set(.9); f.advance(.03); f.motion.clear(); assert.equal(f.frames.size, 0);
  f.motion.set(.7); assert.equal(f.values.at(-1), .7); assert.equal(f.frames.size, 0);
  f.motion.set(0); f.advance(.04); f.reduced(); f.motion.set(.25);
  assert.equal(f.values.at(-1), .25); assert.equal(f.frames.size, 0);
  f.motion.set(NaN); assert.equal(f.values.at(-1), .25);
});
