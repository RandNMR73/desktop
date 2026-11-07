/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Arc's VelocityTracker retains samples no older than 100 ms. Release advances
// the clock and trims the window, but does not append a stationary sample.
// Values and results are screen points and screen points per second.
export class SpaceSwipeVelocity {
  #samples = [];

  #trim(time) {
    while (this.#samples.length && time - this.#samples[0].time > 100) {
      this.#samples.shift();
    }
  }

  reset(position, time) {
    this.#samples = [{ position, time }];
  }

  sample(position, time) {
    this.#samples.push({ position, time });
    this.#trim(time);
  }

  at(time) {
    this.#trim(time);
    if (this.#samples.length < 2) return 0;
    const first = this.#samples[0], last = this.#samples.at(-1);
    const elapsed = last.time - first.time;
    if (elapsed <= 0 || elapsed >= 100) return 0;
    return (last.position - first.position) * 1000 / elapsed;
  }
}

// PageSwipeController's ordinary (no custom settling handler) release policy.
// Origins are ordered screen-point coordinates, including any edge pages the
// consumer exposes. Selection may move at most one page from the start item.
export function spaceSwipeTarget(origins, startIndex, position, velocity) {
  if (!origins.length) return null;
  if (startIndex < 0 || startIndex >= origins.length) return 0;
  if (position < origins[0]) return 0;

  let target = 0;
  if (Math.abs(velocity) < 5) {
    let distance = Infinity;
    for (let index = 0; index < origins.length; index++) {
      const nextDistance = Math.abs(position - origins[index]);
      if (nextDistance < distance) {
        target = index;
        distance = nextDistance;
      }
    }
  } else {
    // The native controller searches reversed pages for the last origin <=
    // presentation, then chooses that page or its successor by velocity sign.
    for (let index = origins.length - 1; index >= 0; index--) {
      if (origins[index] <= position) {
        target = index;
        break;
      }
    }
    if (velocity > 0) target++;
  }
  return Math.max(0, startIndex - 1,
    Math.min(target, startIndex + 1, origins.length - 1));
}

export function spaceSwipeReleaseVelocity(position, target, velocity) {
  // Preserve the native comparison at equality as well: its direction test
  // uses position > target and velocity >= 0, rather than a product of deltas.
  return (position > target) !== (velocity >= 0) ? velocity : 0;
}
