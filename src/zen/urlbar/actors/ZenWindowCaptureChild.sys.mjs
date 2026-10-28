// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/** Read-only, on-demand geometry query. No page listeners, overlay, or timers. */
export class ZenWindowCaptureChild extends JSWindowActorChild {
  receiveMessage({ name }) {
    if (name !== "ZenWindowCapture:VisibleBounds" &&
        name !== "ZenWindowCapture:FullPageBounds") return undefined;
    const w = this.contentWindow;
    if (name === "ZenWindowCapture:FullPageBounds") {
      const scrollbarWidth = {}, scrollbarHeight = {};
      w.windowUtils.getScrollbarSize(false, scrollbarWidth, scrollbarHeight);
      const root = w.document.documentElement;
      const scrolling = w.document.scrollingElement;
      // Read document extents directly to avoid rounding the viewport and
      // scroll range separately. RTL documents may start left of x = 0.
      const width = Math.max(root.scrollWidth, scrolling?.scrollWidth || 0,
        w.innerWidth - scrollbarWidth.value);
      const height = Math.max(root.scrollHeight, scrolling?.scrollHeight || 0,
        w.innerHeight - scrollbarHeight.value);
      return {
        left: w.scrollMinX,
        top: w.scrollMinY,
        right: w.scrollMinX + width,
        bottom: w.scrollMinY + height,
        devicePixelRatio: w.devicePixelRatio,
      };
    }
    return {
      left: w.scrollX,
      top: w.scrollY,
      right: w.scrollX + w.innerWidth,
      bottom: w.scrollY + w.innerHeight,
      devicePixelRatio: w.devicePixelRatio,
    };
  }
}
