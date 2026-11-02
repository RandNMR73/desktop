import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ThemeControlSpring, ThemeControlHoverMotion } from "../../src/zen/spaces/ZenThemeColorPad.mjs";
const reference = JSON.parse(readFileSync(new URL("./fixtures/theme-control-spring.json", import.meta.url)));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
for (const row of reference) {
  test(`coupled native ${row.name} spring, reversal=${row.reversal}`, () => {
    const components = row.name === "scale" ? [.1, .1] : [1.5, 2];
    const spring = new ThemeControlSpring(components);
    spring.write(1, 0);
    for (const [ms, targetX, targetY, valueX, valueY, merge] of row.samples) {
      if (merge !== null) { assert.equal(merge, true); spring.write(targetX / components[0], ms / 1000); }
      const value = spring.sample(ms / 1000);
      near(value * components[0], valueX ?? targetX);
      near(value * components[1], valueY ?? targetY);
      assert.equal(spring.active, valueX !== null);
    }
  });
}

function fixture() {
  let time = 0, id = 0, reduced = false;
  const frames = new Map(), values = new Map();
  const clock = { performance: { now: () => time * 1000 },
    requestAnimationFrame(fn) { frames.set(++id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); },
    matchMedia: () => ({ matches: reduced }) };
  const motion = new ThemeControlHoverMotion(clock, (control, ...value) => values.set(control, value));
  const advance = t => { time = t; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); };
  return { motion, frames, values, advance, reduced() { reduced = true; } };
}

test("both controls share a frame loop, unchanged hover is free and settling stops scheduling", () => {
  const f = fixture();
  f.motion.set("slider", true); f.motion.set("dial", true); f.motion.set("slider", true);
  assert.equal(f.frames.size, 1);
  for (let i = 1; i <= 100; i++) f.advance(i / 100);
  assert.equal(f.frames.size, 0);
  assert.deepEqual(f.values.get("slider"), [1.1, 3, 4]);
  assert.deepEqual(f.values.get("dial"), [1.1, 3, 4]);
  f.motion.set("slider", true); assert.equal(f.frames.size, 0);
});

test("reversing hover preserves momentum, closure cancels every frame and reduced motion snaps", () => {
  const f = fixture(); f.motion.set("slider", true); f.advance(.07);
  const before = f.values.get("slider")[0];
  f.motion.set("slider", false); f.advance(.075);
  assert.ok(f.values.get("slider")[0] > before, "reversal should initially preserve outward velocity");
  f.motion.clear(); assert.equal(f.frames.size, 0);
  assert.deepEqual(f.values.get("slider"), [1, 1.5, 2]);
  f.reduced(); f.motion.set("dial", true);
  assert.deepEqual(f.values.get("dial"), [1.1, 3, 4]); assert.equal(f.frames.size, 0);
  f.motion.set("dial", false); assert.deepEqual(f.values.get("dial"), [1, 1.5, 2]);
});

test("disabled controls reset independently and do not schedule empty motion", () => {
  const f = fixture();
  f.motion.set("slider", false); assert.equal(f.frames.size, 0); assert.equal(f.motion.controls.size, 0);
  f.motion.set("slider", true); f.motion.set("dial", true); f.advance(.05);
  f.motion.reset("dial"); assert.equal(f.motion.controls.has("dial"), false);
  assert.deepEqual(f.values.get("dial"), [1, 1.5, 2]); assert.equal(f.frames.size, 1);
  f.motion.reset("slider"); assert.equal(f.frames.size, 0);
});
