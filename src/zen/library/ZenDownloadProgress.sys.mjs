/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Arc DownloadProgressBadge: the early 0.9 -> 1 scale writes coalesce before
// rendering. Native hosting confirms the later 1 -> 1.03 -> 0.97 pulse/fade.
// These animations belong to the progress view; a status change replaces it
// immediately rather than delaying a usable file thumbnail until they finish.
const COMPLETION_DURATION = 1450;
const COMPLETION_SCALE = [
  { offset: 0, transform: "scale(1)" },
  { offset: 1150 / COMPLETION_DURATION, transform: "scale(1)", easing: "ease-out" },
  { offset: 1300 / COMPLETION_DURATION, transform: "scale(1.03)", easing: "ease-in" },
  { offset: 1, transform: "scale(0.97)" },
];
const COMPLETION_OPACITY = [
  { offset: 0, opacity: 1 },
  { offset: 1300 / COMPLETION_DURATION, opacity: 1, easing: "ease-in" },
  { offset: 1, opacity: 0 },
];

export class ZenDownloadProgress {
  #window;
  #items = new Map();
  #views = new Map();

  constructor(window) {
    this.#window = window;
  }

  prune(downloads) {
    const keep = new Set(downloads);
    for (const item of this.#items.keys()) {
      if (!keep.has(item)) this.#items.delete(item);
    }
  }

  #reset(badge) {
    const view = this.#views.get(badge);
    view?.ring?.cancel();
    for (const animation of view?.completion ?? []) animation.cancel();
    const content = badge.querySelector(".zen-library-download-progress-content");
    content.style.removeProperty("transform");
    content.style.removeProperty("opacity");
    badge.removeAttribute("completing");
    this.#views.delete(badge);
  }

  update(badge, download) {
    const now = this.#window.document.timeline.currentTime;
    const active = !!download && !download.stopped;
    const progress = download?.hasProgress ? Math.max(0, Math.min(100, download.progress)) : 0;
    let item = this.#items.get(download);
    if (download) {
      if (!item) {
        // onChange does not run when a native progress view first appears.
        item = { active, progress, started: null };
        this.#items.set(download, item);
      } else {
        if (!active || !item.active) item.started = null;
        else if (item.started === null && item.progress < 100 && progress >= 100) {
          item.started = now;
        }
        item.active = active;
        item.progress = progress;
      }
    }

    let view = this.#views.get(badge);
    if (view && (view.download !== download || view.active !== active)) {
      this.#reset(badge);
      view = null;
    }
    const arc = badge.querySelector(".zen-library-download-progress-arc");
    if (view?.progress !== progress) {
      // Capture the current presentation before cancelling an interrupted
      // trim. Native easeOut uses a fresh 350ms curve for each progress update.
      const from = view && active
        ? parseFloat(this.#window.getComputedStyle(arc).strokeDasharray)
        : progress;
      view?.ring?.cancel();
      arc.style.strokeDasharray = `${progress} 100`;
      badge.toggleAttribute("progress-zero", !progress);
      const ring = view && active && from !== progress ? arc.animate([
        { strokeDasharray: `${from} 100`, visibility: from ? "visible" : "hidden" },
        { strokeDasharray: `${progress} 100`, visibility: progress ? "visible" : "hidden" },
      ], { duration: 350, easing: "ease-out" }) : null;
      if (!view) {
        view = { download, active, progress, ring: null, started: null, completion: [] };
        this.#views.set(badge, view);
      }
      view.progress = progress;
      view.ring = ring;
      ring?.finished.then(() => {
        if (view.ring === ring) { ring.cancel(); view.ring = null; }
      }, () => {});
    }

    if (active && item.started !== null && view.started !== item.started) {
      const content = badge.querySelector(".zen-library-download-progress-content");
      const started = view.started = item.started;
      badge.setAttribute("completing", "true");
      // A row can move to another slot or be recreated while the footer's
      // animation is running. All copies follow the item's original clock.
      const elapsed = now - started;
      const settle = () => {
        content.style.transform = "scale(0.97)";
        content.style.opacity = "0";
      };
      if (elapsed >= COMPLETION_DURATION) {
        settle();
        return;
      }
      const options = { duration: COMPLETION_DURATION, fill: "both" };
      const animations = [content.animate(COMPLETION_SCALE, options),
        content.animate(COMPLETION_OPACITY, options)];
      for (const animation of animations) animation.startTime = started;
      view.completion = animations;
      Promise.all(animations.map(animation => animation.finished)).then(() => {
        if (this.#views.get(badge) !== view || view.completion !== animations) return;
        settle();
        for (const animation of animations) animation.cancel();
        view.completion = [];
      }, () => {});
    }
  }

  destroy() {
    for (const badge of this.#views.keys()) this.#reset(badge);
    this.#items.clear();
  }
}
