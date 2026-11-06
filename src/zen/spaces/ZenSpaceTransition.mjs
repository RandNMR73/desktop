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
