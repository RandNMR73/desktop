/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Reserve each request before yielding. Awaiting the current switch first lets
// multiple callers resume together and mutate the active Space concurrently.
export class ZenSpaceSwitchQueue {
  #tail = Promise.resolve();
  #active = null;
  #sequence = 0;

  run(task) {
    const sequence = ++this.#sequence;
    const pending = this.#tail.then(async () => {
      const context = {
        animations: [],
        isLatest: () => sequence === this.#sequence,
      };
      this.#active = context;
      try {
        return await task(context);
      } finally {
        this.#active = null;
      }
    });
    // A failed request must not prevent later user input from being handled.
    this.#tail = pending.catch(() => {});
    for (const animation of this.#active?.animations ?? []) {
      try {
        animation.complete();
      } catch (error) {
        console.error("Unable to finish a Space animation", error);
      }
    }
    return pending;
  }
}
