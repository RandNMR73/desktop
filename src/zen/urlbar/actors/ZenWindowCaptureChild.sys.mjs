// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/** Read-only, on-demand geometry query. No page listeners, overlay, or timers. */
export class ZenWindowCaptureChild extends JSWindowActorChild {
  receiveMessage({ name }) {
    if (name !== "ZenWindowCapture:VisibleBounds") return undefined;
    const w = this.contentWindow;
    return {
      left: w.scrollX,
      top: w.scrollY,
      right: w.scrollX + w.innerWidth,
      bottom: w.scrollY + w.innerHeight,
      devicePixelRatio: w.devicePixelRatio,
    };
  }
}
