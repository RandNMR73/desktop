import assert from "node:assert/strict";
import test from "node:test";
import { SpaceSwipeVelocity, spaceSwipeTarget, spaceSwipeReleaseVelocity,
  spaceSwipePresentation, spaceSwipeUnresisted }
  from "../../src/zen/spaces/ZenSpaceSwipeInput.mjs";

test("resisted edge positions can be adopted without a first-movement jump", () => {
  for (const [minimum, maximum] of [[0, 228], [180, 540], [-228, 228]]) {
    for (const raw of [minimum - 10000, minimum - 255, minimum - 1,
      minimum, (minimum + maximum) / 2, maximum, maximum + 1, maximum + 255, maximum + 10000]) {
      const shown = spaceSwipePresentation(raw, minimum, maximum);
      const restored = spaceSwipeUnresisted(shown, minimum, maximum);
      assert.ok(Math.abs(restored - raw) < 1e-8);
      assert.ok(shown > minimum - 255 && shown < maximum + 255);
      if (raw >= minimum && raw <= maximum) assert.equal(shown, raw);
    }
    assert.ok(Math.abs(spaceSwipePresentation(maximum + .001, minimum, maximum) - maximum - .00015) < 1e-9);
  }
});

test("release retains movement velocity instead of averaging in finger-lift latency", () => {
  const velocity = new SpaceSwipeVelocity();
  velocity.reset(0, 0);
  velocity.sample(12, 20);
  velocity.sample(24, 40);
  assert.equal(velocity.at(60), 600);
  assert.equal(velocity.at(120), 600);
  assert.equal(velocity.at(121), 0);
});

test("recent movement replaces stale direction and reset discards the old gesture", () => {
  const velocity = new SpaceSwipeVelocity();
  velocity.reset(0, 0);
  velocity.sample(100, 50);
  velocity.sample(80, 120);
  assert.equal(velocity.at(120), -2000 / 7);
  velocity.reset(80, 130);
  assert.equal(velocity.at(130), 0);
  velocity.sample(90, 150);
  assert.equal(velocity.at(150), 500);
});

test("100 ms interval and coincident timestamps follow native zero-velocity boundaries", () => {
  const velocity = new SpaceSwipeVelocity();
  velocity.reset(0, 0);
  velocity.sample(20, 100);
  assert.equal(velocity.at(100), 0);
  velocity.reset(0, 10);
  velocity.sample(20, 10);
  assert.equal(velocity.at(10), 0);
});

test("slow releases choose nearest origin, with stable ties and adjacent-page bounds", () => {
  const origins = [0, 180, 460, 800, 1000];
  for (const velocity of [-4.999, 0, 4.999]) {
    assert.equal(spaceSwipeTarget(origins, 1, 319, velocity), 1);
    assert.equal(spaceSwipeTarget(origins, 1, 320, velocity), 1);
    assert.equal(spaceSwipeTarget(origins, 1, 321, velocity), 2);
    assert.equal(spaceSwipeTarget(origins, 1, 990, velocity), 2);
    assert.equal(spaceSwipeTarget(origins, 3, 1, velocity), 2);
  }
});

test("a moving release uses its current interval, including at the 5-point threshold", () => {
  const origins = [0, 228, 456, 684, 912];
  assert.equal(spaceSwipeTarget(origins, 1, 250, 5), 2);
  assert.equal(spaceSwipeTarget(origins, 1, 430, -5), 1);
  assert.equal(spaceSwipeTarget(origins, 1, 80, 100), 1);
  assert.equal(spaceSwipeTarget(origins, 1, 80, -100), 0);
  assert.equal(spaceSwipeTarget(origins, 2, 228, -100), 1);
  assert.equal(spaceSwipeTarget(origins, 2, 228, 100), 2);
});

test("overscroll, one page, missing start and removed pages retain native fallbacks", () => {
  assert.equal(spaceSwipeTarget([], 0, 0, 0), null);
  assert.equal(spaceSwipeTarget([0], 0, 500, 100), 0);
  assert.equal(spaceSwipeTarget([0, 228, 456], 1, -10, 100), 0);
  assert.equal(spaceSwipeTarget([0, 228, 456], 1, 600, -100), 2);
  assert.equal(spaceSwipeTarget([0, 228, 456], -1, 400, 100), 0);
});

test("release only carries velocity on the native side of its target, including equality", () => {
  assert.equal(spaceSwipeReleaseVelocity(50, 228, 300), 300);
  assert.equal(spaceSwipeReleaseVelocity(50, 228, -300), 0);
  assert.equal(spaceSwipeReleaseVelocity(250, 228, -300), -300);
  assert.equal(spaceSwipeReleaseVelocity(250, 228, 300), 0);
  assert.equal(spaceSwipeReleaseVelocity(228, 228, 300), 300);
  assert.equal(spaceSwipeReleaseVelocity(228, 228, -300), 0);
});
