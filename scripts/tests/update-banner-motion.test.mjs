import test from "node:test";
import assert from "node:assert/strict";
import { UpdateBannerMotion } from "../../src/zen/common/modules/ZenUpdateBannerMotion.mjs";
import { ThemeControlSpring } from "../../src/zen/spaces/ZenThemeColorPad.mjs";

function fixture(reduced = false) {
  let time = 0, next = 0;
  const timers = new Map(), frames = new Map(), values = [], expanded = [];
  const motion = new UpdateBannerMotion({
    now: () => time, reducedMotion: () => reduced,
    setTimeout: (fn, delay) => { const id = ++next; timers.set(id, { fn, at: time + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => { const id = ++next; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  }, new ThemeControlSpring([64, 1]), (value, active) => values.push({ time, value, active }), value => expanded.push(value));
  const advance = ms => {
    const end = time + ms;
    while (time < end) {
      time = Math.min(end, time + 1000 / 120);
      for (const [id, timer] of timers) if (timer.at <= time) { timers.delete(id); timer.fn(); }
      const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn());
    }
  };
  return { motion, values, expanded, timers, frames, advance };
}

test("passing over the notice doesn't expand it; sustained hover waits 300ms", () => {
  const f = fixture();
  f.motion.hover(true); f.advance(299);
  assert.equal(f.motion.open, false);
  f.motion.hover(false); f.advance(500);
  assert.equal(f.expanded.length, 0);
  f.motion.hover(true); f.advance(300);
  assert.equal(f.motion.open, true);
  assert.equal(f.values.at(-1).value, 0);
});

test("opening has a spring overshoot and settles without an idle frame loop", () => {
  const f = fixture();
  f.motion.hover(true); f.advance(1300);
  assert.ok(Math.max(...f.values.map(x => x.value)) > 1.03);
  assert.equal(f.values.at(-1).value, 1);
  assert.equal(f.values.at(-1).active, false);
  assert.equal(f.frames.size, 0);
  f.motion.hover(false);
  assert.equal(f.motion.open, false);
  f.advance(500);
  assert.equal(f.values.at(-1).value, 0);
  assert.equal(f.frames.size, 0);
});

test("keyboard focus opens immediately and retains the panel after pointer exit", () => {
  const f = fixture();
  f.motion.focus(true);
  assert.equal(f.motion.open, true);
  assert.equal(f.timers.size, 0);
  f.motion.hover(false);
  assert.equal(f.motion.open, true);
  f.motion.focus(false);
  assert.equal(f.motion.open, false);
});

test("interrupted expansion reverses from the current position", () => {
  const f = fixture();
  f.motion.focus(true); f.advance(80);
  const previous = f.values.at(-1).value;
  assert.ok(previous > 0 && previous < 1);
  f.motion.focus(false);
  assert.ok(Math.abs(f.values.at(-1).value - previous) < .01);
  f.advance(600);
  assert.equal(f.values.at(-1).value, 0);
});

test("reduced motion and teardown leave no timer or animation running", () => {
  const f = fixture(true);
  f.motion.focus(true);
  assert.equal(f.values.at(-1).value, 1);
  assert.equal(f.frames.size, 0);
  f.motion.hover(true); f.motion.reset(); f.advance(1000);
  assert.equal(f.motion.open, false);
  assert.equal(f.values.at(-1).value, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.frames.size, 0);
});
