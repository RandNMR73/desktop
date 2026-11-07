/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Arc's WindowLayoutController uses PageSwipeController without a custom
// settling handler: response .4, damping ratio 1. Response is the spring's
// natural period, not an animation duration. See SPACE-TRANSITIONS.md.
const frequency = 2 * Math.PI / .4;
export const SPACE_TRANSITION_SPRING = Object.freeze({
  type: "spring",
  stiffness: frequency ** 2,
  damping: 2 * frequency,
  mass: 1,
  restDelta: .001,
  restSpeed: .01,
});

export function spaceTransitionOffset(transform, fallback = 0) {
  const match = /^translateX\(([-+.\deE]+)%\)$/.exec(transform);
  const value = match ? Number(match[1]) : fallback;
  return Number.isFinite(value) ? value : fallback;
}

// Keep the page coordinate unwrapped while moving through the circular strip.
// In particular, reversing a request must start from the presented position,
// not the index of the Space whose model was most recently selected.
export function spacePageTarget(position, index, count) {
  let distance = (index - position) % count;
  if (distance > count / 2) distance -= count;
  if (distance < -count / 2) distance += count;
  // Construct the integer endpoint directly; adding a fractional displacement
  // can otherwise leave the spring just short of a page boundary.
  return index + Math.round((position + distance - index) / count) * count;
}

export function spacePageFrame(position, count) {
  const wrap = value => ((value % count) + count) % count;
  const floor = Math.floor(position);
  return {
    from: wrap(floor),
    to: wrap(floor + 1),
    progress: position - floor,
    offsets: Array.from({ length: count }, (_, index) =>
      (spacePageTarget(position, index, count) - position) * 100),
  };
}

export function animateSpacePage(motion, state, target, paint, isCurrent) {
  return motion.animate(state.position, target, {
    ...SPACE_TRANSITION_SPRING,
    velocity: state.velocity,
    onUpdate(position) {
      if (isCurrent()) paint(position);
    },
  });
}

// One normalized spring drives every visible strip and both background
// renderers. Separate element animations can otherwise settle at different
// times because their distances and rest thresholds use different units.
export function animateSpaceTransition(motion, tracks, isCurrent) {
  return motion.animate(0, 1, {
    ...SPACE_TRANSITION_SPRING,
    onUpdate(progress) {
      if (!isCurrent()) return;
      for (const track of tracks) track(progress);
    },
  });
}
