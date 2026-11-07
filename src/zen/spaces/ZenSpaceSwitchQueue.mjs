/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Reserve each request before yielding. Awaiting the current switch first lets
// multiple callers resume together and mutate the active Space concurrently.
export class ZenSpaceSwitchQueue {
  #tail = Promise.resolve();
  #active = null;
  #sequence = 0;
  #latest = null;
  #presentationSequence = 0;

  takePresentation() {
    const sequence = ++this.#sequence;
    this.#presentationSequence = sequence;
    this.#latest = null;
    // Invalidate paint callbacks before completing their promises. Model work
    // already underway may finish, but queued old selections must not start.
    this.#completeActiveAnimations();
    return { isLatest: () => sequence === this.#sequence };
  }

  #completeActiveAnimations() {
    for (const animation of this.#active?.animations ?? []) {
      try {
        animation.complete();
      } catch (error) {
        console.error("Unable to finish a Space animation", error);
      }
    }
  }

  run(task, selectionKey) {
    // Only adjacent, still-pending plain selections may share work. In
    // particular A→B→A must reserve the final A, even while the first A runs.
    if (selectionKey !== undefined && this.#latest?.key === selectionKey) {
      return this.#latest.pending;
    }
    const sequence = ++this.#sequence;
    const request = { key: selectionKey };
    const pending = this.#tail.then(async () => {
      const context = {
        animations: [],
        isLatest: () => sequence === this.#sequence,
        wasInterrupted: () => sequence < this.#presentationSequence,
      };
      this.#active = context;
      try {
        return await task(context);
      } finally {
        this.#active = null;
        if (this.#latest === request) this.#latest = null;
      }
    });
    request.pending = pending;
    // Publish before completing an old animation: its completion can itself
    // enqueue input, which must see the newly reserved destination.
    this.#latest = request;
    // A failed request must not prevent later user input from being handled.
    this.#tail = pending.catch(() => {});
    this.#completeActiveAnimations();
    return pending;
  }
}
