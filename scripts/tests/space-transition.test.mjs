import assert from "node:assert/strict";
import test from "node:test";
import { SPACE_TRANSITION_SPRING, animateSpaceTransition, spaceTransitionOffset } from "../../src/zen/spaces/ZenSpaceTransition.mjs";
import "../../src/zen/vendor/motion.min.mjs";

test("the production spring follows the critically damped .4-response solution", () => {
  const spring = Motion.spring({ ...SPACE_TRANSITION_SPRING, keyframes: [0, 1] });
  const frequency = 2 * Math.PI / .4;
  for (let milliseconds = 0; milliseconds <= 500; milliseconds += 10) {
    const time = milliseconds / 1000;
    const expected = 1 - (1 + frequency * time) * Math.exp(-frequency * time);
    const sample = spring.next(milliseconds);
    assert.equal(sample.done, false);
    assert.ok(Math.abs(sample.value - expected) < 1e-12, `${milliseconds} ms`);
  }
  assert.deepEqual(spring.next(1000), { done: true, value: 1 });
});

test("a partially dragged Space keeps the strip and theme at the same progress", () => {
  let update;
  const strip = { offset: 65 }, color = { progress: .35 };
  animateSpaceTransition({ animate(from, to, options) {
    const spring = Motion.spring({ ...options, keyframes: [from, to] });
    update = time => options.onUpdate(spring.next(time).value);
  } }, [
    progress => { strip.offset = 65 * (1 - progress); },
    progress => { color.progress = .35 + .65 * progress; },
  ], () => true);
  for (const time of [0, 16, 75, 150, 250, 400, 1000]) {
    update(time);
    assert.ok(Math.abs(strip.offset / 100 + color.progress - 1) < 1e-12);
  }
});

test("callbacks from a superseded or disposed transition cannot repaint", () => {
  let options, current = true;
  const frames = [];
  animateSpaceTransition({ animate(_from, _to, settings) { options = settings; } },
    [progress => frames.push(progress)], () => current);
  options.onUpdate(.2);
  current = false;
  options.onUpdate(.8);
  options.onUpdate(1);
  assert.deepEqual(frames, [.2]);
});

test("track starts retain signed fractional offsets from swipes and rapid input", () => {
  for (const offset of [0, -100, 200, -37.125, 1e-7]) {
    assert.equal(spaceTransitionOffset(`translateX(${offset}%)`), offset);
  }
  assert.equal(spaceTransitionOffset("", 100), 100);
  assert.equal(spaceTransitionOffset("translateX(NaN%)", -100), -100);
});
