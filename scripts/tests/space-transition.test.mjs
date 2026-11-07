import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { SPACE_TRANSITION_SPRING, spaceTransitionSpring, animateSpaceTransition, animateSpacePage, spacePageFrame, spacePageTarget, spaceTransitionOffset } from "../../src/zen/spaces/ZenSpaceTransition.mjs";
import "../../src/zen/vendor/motion.min.mjs";

const nativeReference = JSON.parse(readFileSync(new URL(
  "../../tools/native-theme-runtime/space-spring-reference.json", import.meta.url)));
const selectionReference = JSON.parse(readFileSync(new URL(
  "../../tools/native-theme-runtime/space-selection-reference.json", import.meta.url)));

test("rapid selection matches native reset velocity for reversal and forward retargeting", () => {
  for (const { width, fps, elapsed, position, velocity, previousTarget, target, samples }
    of selectionReference.cases) {
    let spring;
    animateSpacePage({ animate(from, to, options) {
      spring = Motion.spring({ ...options, keyframes: [from, to] });
    } }, { position, velocity, target: previousTarget }, target,
    () => {}, () => true, width);
    for (const [index, [seconds, nativePosition]] of samples.entries()) {
      const frame = spring.next(seconds * 1000);
      const label = `${width}pt, ${fps}Hz, retarget ${previousTarget}→${target} at ${elapsed}s, ${seconds}s`;
      assert.ok(Math.abs(frame.value - nativePosition) * width < 1e-9, label);
      assert.equal(frame.done, index === samples.length - 1, label);
    }
  }
});

test("page and partial-swipe settlement match the native Motion reference in screen points", () => {
  for (const { width, distance, fps, samples } of nativeReference.cases) {
    for (const partial of [false, true]) {
      let sample;
      const motion = { animate(from, to, options) {
        const spring = Motion.spring({ ...options, keyframes: [from, to] });
        sample = seconds => {
          const frame = spring.next(seconds * 1000);
          return { ...frame, value: partial ? frame.value * distance : frame.value };
        };
      } };
      if (partial) animateSpaceTransition(motion, [], () => true, width * distance);
      else animateSpacePage(motion, { position: 0, velocity: 0 }, distance,
        () => {}, () => true, width);
      for (const [index, [seconds, nativePosition]] of samples.entries()) {
        const frame = sample(seconds);
        const label = `${width}pt, ${distance} pages, ${fps}Hz, ${seconds}s, partial=${partial}`;
        assert.ok(Math.abs(frame.value - nativePosition) * width < 1e-9, label);
        assert.equal(frame.done, index === samples.length - 1, label);
      }
    }
  }
});

test("an unavailable page measurement keeps finite spring thresholds", () => {
  for (const width of [0, -1, NaN, Infinity]) {
    const spring = spaceTransitionSpring(width);
    assert.equal(spring.restDelta, .01);
    assert.equal(spring.restSpeed, .01);
  }
});

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

test("retargeting uses the visible page rather than the previously selected destination", () => {
  assert.equal(spacePageTarget(.2, 0, 5), 0);
  assert.equal(spacePageTarget(.2, 2, 5), 2);
  assert.equal(spacePageTarget(4.8, 0, 5), 5);
  assert.equal(spacePageTarget(-.2, 4, 5), -1);
  assert.equal(spacePageTarget(10.2, 0, 5), 10);
});

test("visible strips and theme progress stay continuous across every page boundary", () => {
  for (const count of [2, 3, 5, 9]) {
    for (let boundary = -count; boundary <= count; boundary++) {
      const before = spacePageFrame(boundary - 1e-6, count);
      const after = spacePageFrame(boundary + 1e-6, count);
      assert.equal(before.to, after.from);
      assert.ok(before.progress > .99999 && after.progress < .00001);
      const visible = after.from;
      assert.ok(Math.abs(before.offsets[visible] - after.offsets[visible]) < .001);
      for (const frame of [before, after]) {
        assert.ok(frame.progress >= 0 && frame.progress < 1);
        assert.ok(frame.offsets.every(offset => Math.abs(offset) <= count * 50));
      }
    }
  }
});

test("a repeated destination keeps its presented position and incoming velocity", () => {
  let spring, update, current = true;
  const state = { position: .2, target: 0, velocity: 3 };
  const positions = [];
  animateSpacePage({ animate(from, to, options) {
    spring = Motion.spring({ ...options, keyframes: [from, to] });
    update = time => options.onUpdate(spring.next(time).value);
  } }, state, 0, position => positions.push(position), () => current);
  update(0);
  update(.001);
  assert.equal(positions[0], .2);
  assert.ok(Math.abs((positions[1] - positions[0]) / .000001 - 3) < .001);
  update(1000);
  assert.equal(positions.at(-1), 0);
  current = false;
  update(50);
  assert.equal(positions.length, 3);
});
