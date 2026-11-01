/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { downloadArrivalSpring, DOWNLOAD_ARRIVAL_SETTLING, ZenDownloadIconMotion }
  from "./ZenDownloadMotion.sys.mjs";

const STEP = 1 / 300;
const STIFFNESS = (2 * Math.PI / 0.15) ** 2;
const DAMPING = 2 * Math.sqrt(STIFFNESS) * 0.86;
export const THUMBNAIL_STAGGER = 0.0125;

// interactiveSpring uses a stateful FluidSpring, not Spring.value(at:).
// Native samples preserve all four numerical fields across equal-delay merges.
export class DownloadFluidSpring {
  constructor(time, offset = 0, velocity = 0, force = 0) {
    Object.assign(this, { time, offset, velocity, force, ended: false });
  }

  sample(target, time) {
    if (time - this.time > 1) this.time = time - 1 / 60;
    while (this.time < time) {
      const half = this.velocity + this.force * STEP / 2;
      this.offset += half * STEP;
      this.force = STIFFNESS * (target - this.offset) - DAMPING * half;
      this.velocity = half + this.force * STEP / 2;
      this.time += STEP;
    }
    this.ended = Math.max(this.velocity ** 2, this.force ** 2) <= 0.0036 &&
      ((target - this.offset) ** 2 <= (target * 0.01) ** 2 || target === 0);
    return this.ended ? target : this.offset;
  }
}

function drop(progress) {
  if (progress <= 0 || progress >= 1) return Math.max(0, Math.min(1, progress));
  let lower = 0, upper = 1, t;
  for (let i = 0; i < 40; i++) {
    t = (lower + upper) / 2;
    const x = 3 * (1 - t) ** 2 * t * 0.78 + 3 * (1 - t) * t * t * 0.7 + t ** 3;
    if (x < progress) lower = t; else upper = t;
  }
  return 3 * (1 - t) * t * t + t ** 3;
}

export class DownloadThumbnailChannel {
  constructor(target) {
    Object.assign(this, { target, shift: 0, curve: null, base: null,
      start: 0, fluid: null, mergeable: false, delay: 0 });
  }

  sample(time) {
    if (!this.curve) return this.target;
    const before = this.base.sample(time);
    if (time < this.start) return before + this.shift;
    const elapsed = time - this.start;
    let value, ended;
    if (this.curve === "fluid") {
      value = before + this.fluid.sample(this.target - this.shift - before, elapsed);
      ended = this.fluid.ended && !this.base.curve;
    } else {
      const duration = this.curve === "drop" ? 0.2 :
        this.curve === "linear" ? 0.14 : DOWNLOAD_ARRIVAL_SETTLING;
      const progress = this.curve === "drop" ? drop(elapsed / duration) :
        this.curve === "linear" ? Math.min(elapsed / duration, 1) :
        elapsed < duration ? downloadArrivalSpring(elapsed) : 1;
      value = before + (this.target - this.shift - before) * progress;
      ended = elapsed >= duration;
    }
    if (ended) {
      this.curve = this.base = this.fluid = null;
      this.shift = 0;
      return this.target;
    }
    return value + this.shift;
  }

  write(value, time, curve = null, delay = 0, force = false) {
    if (value === this.target && !force) return this;
    if (!curve) {
      // A non-animated State write changes the target; it does not cancel the
      // presentation's unfinished interpolation contributions.
      this.shift += value - this.target;
      this.target = value;
      return this;
    }
    if (curve === "fluid" && this.curve === "fluid" &&
        this.mergeable && this.delay === delay) {
      const { velocity, force: previousForce } = this.fluid;
      this.sample(time);
      // Sampling can finish the old channel. In that case start a new one.
      if (this.fluid) {
        Object.assign(this.fluid, { velocity, force: previousForce, time: time - this.start });
        this.target = value;
        return this;
      }
    }
    const node = new DownloadThumbnailChannel(value);
    Object.assign(node, { curve, base: this, start: time + delay, delay,
      // Eligibility belongs to creation, even after the base finishes.
      mergeable: !this.curve });
    if (curve === "fluid") node.fluid = new DownloadFluidSpring(0);
    return node;
  }
}

// One channel set per download identity. Reordering rows must not move an
// unrelated item's animation state onto the new occupant of a DOM slot.
export class DownloadThumbnailState {
  constructor({ items = [], selected = null, active = [], width = 212,
    localX = 24, footerX = 10, footerY = 30, stride = 56 } = {}) {
    this.items = [...items];
    this.active = new Set(active);
    this.selected = this.visible = selected;
    this.expanded = false;
    Object.assign(this, { width, localX, footerX, footerY, stride });
    this.pending = [];
    this.nodes = new Map();
    [this.x, this.y] = this.rest();
    this.scale = this.normalScale();
    this.rotation = 0;
    this.opacity = selected ? 1 : 0;
    for (const id of items) this.nodes.set(id, this.newChannels(id));
  }

  normalScale() { return this.active.has(this.visible) ? 0.8 : 0.55; }

  rest() {
    const index = this.items.indexOf(this.visible);
    return this.expanded || index < 0 ? [0, 0] :
      [this.footerX, this.footerY + this.stride * index];
  }

  targets(id) {
    const selected = id === this.visible, closed = selected && !this.expanded;
    const index = this.items.indexOf(id);
    const [x, y] = this.expanded ? [0, 0] : closed ?
      (this.x === 0 && this.y === 0 ? this.rest() : [this.x, this.y]) :
      [0, index === 0 ? 20 : this.stride];
    return { width: closed ? 40 : this.width, localX: closed ? 20 : this.localX,
      scale: closed ? this.scale === 1 ? this.normalScale() : this.scale : 1,
      rotation: closed ? this.rotation : 0, x, y,
      opacity: this.expanded ? 1 : selected ? this.opacity : 0 };
  }

  newChannels(id) {
    return Object.fromEntries(Object.entries(this.targets(id))
      .map(([key, value]) => [key, new DownloadThumbnailChannel(value)]));
  }

  write(time, curve = null) {
    for (const [index, id] of this.items.entries()) {
      const targets = this.targets(id), channels = this.nodes.get(id);
      // SwiftUI animates CGSize as one value; a change of y also writes x.
      const offsetChanged = targets.x !== channels.x.target || targets.y !== channels.y.target;
      for (const [key, value] of Object.entries(targets)) {
        channels[key] = channels[key].write(value, time, curve,
          curve === "fluid" ? index * THUMBNAIL_STAGGER : 0,
          offsetChanged && (key === "x" || key === "y"));
      }
    }
  }

  setItems(items, active, time) {
    const previousIndex = this.items.indexOf(this.selected);
    this.items = [...items];
    this.active = new Set(active);
    for (const id of this.nodes.keys()) if (!items.includes(id)) this.nodes.delete(id);
    for (const id of items) if (!this.nodes.has(id)) this.nodes.set(id, this.newChannels(id));
    if (this.selected === this.visible && previousIndex !== items.indexOf(this.selected)) {
      [this.x, this.y] = this.rest();
    }
    this.write(time);
  }

  select(id, time, reorder = false) {
    if (reorder) this.items = [id, ...this.items.filter(other => other !== id)];
    this.selected = id;
    if (id === this.visible) {
      [this.x, this.y] = this.rest();
      this.write(time);
      return;
    }
    if (id !== null) {
      this.visible = id;
      if (this.expanded) { this.reset(time); return; }
      const [x, y] = this.rest();
      this.x = x; this.y = y - 8; this.opacity = 0; this.scale = this.normalScale();
      this.write(time);
      this.y = y + 12; this.opacity = 1;
      this.write(time, "drop");
      this.pending.push({ time: time + 0.22, kind: "return", x, y });
    } else {
      if (this.expanded) { this.visible = null; this.write(time); return; }
      const [x, y] = this.rest();
      this.x = x - 14; this.y = y + 20; this.opacity = 0;
      this.scale = 0.2; this.rotation = -45;
      this.write(time, "linear");
      this.pending.push({ time: time + 0.39, kind: "cleanup", x, y });
    }
  }

  reset(time) {
    [this.x, this.y] = this.rest();
    this.scale = this.normalScale(); this.rotation = 0;
    this.opacity = this.expanded || this.visible !== null ? 1 : 0;
    this.write(time);
  }

  setExpanded(expanded, time) {
    this.expanded = expanded;
    this.write(time, "fluid");
    this.reset(time);
    if (expanded && this.selected !== null && !this.active.has(this.selected)) this.select(null, time);
  }

  callbacks(time) {
    const ready = this.pending.filter(event => event.time <= time + 1e-10)
      .sort((a, b) => a.time - b.time);
    this.pending = this.pending.filter(event => !ready.includes(event));
    for (const { kind, x, y } of ready) {
      if (kind === "return") { this.y = y; this.write(time, "bounce"); }
      else {
        this.x = x; this.y = y; this.scale = 1; this.rotation = 0;
        this.visible = this.selected;
        this.write(time);
      }
    }
  }

  sample(time) {
    return new Map(this.items.map(id => [id, Object.fromEntries(
      Object.entries(this.nodes.get(id)).map(([key, node]) => [key, node.sample(time)]))]));
  }

  get moving() {
    return this.pending.length > 0 || [...this.nodes.values()]
      .some(channels => Object.values(channels).some(node => node.curve));
  }
}

const downloadKey = item => item?.target?.path ?? null;

// The numerical state is sampled once per presentation frame. Layout is read
// only when the download list changes; there is no animation loop at rest.
export class ZenDownloadThumbnails {
  #window;
  #clock;
  #changed;
  #icon;
  #state = new DownloadThumbnailState();
  #rows = [];
  #selected = null;
  #selectedItem = null;
  #displayed = null;
  #frame = null;
  #timer = null;
  #waiters = [];
  #destroyed = false;

  constructor(window, sprite, changed, clock = {
    setTimeout: (...args) => ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs").setTimeout(...args),
    clearTimeout: timer => ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs").clearTimeout(timer),
  }) {
    this.#window = window; this.#clock = clock; this.#changed = changed;
    this.#icon = new ZenDownloadIconMotion(window, sprite, clock);
  }

  get displayed() { return this.#displayed; }
  // Gecko's DocumentTimeline can retain its last refresh-driver time while
  // idle. Event and process-timer writes need the current monotonic time.
  #now() { return this.#window.performance.now() / 1000; }

  sync(rows, item, { animate = true, canDismiss = true } = {}) {
    if (this.#destroyed) return;
    const now = this.#now(), key = downloadKey(item);
    this.#state.sample(now);
    this.#rows = rows.filter(row => !row.hidden).map(row => {
      const badge = row.querySelector(".zen-library-download-badge");
      return { row, id: downloadKey(row.download), width: row.clientWidth,
        iconX: badge.offsetLeft + badge.offsetWidth / 2,
        iconY: badge.offsetTop + badge.offsetHeight / 2,
        details: [...row.querySelectorAll(".zen-library-download-list-title-container, .zen-library-download-action")] };
    });
    const items = this.#rows.map(row => row.id).reverse();
    const active = rows.filter(row => row.download && !row.download.succeeded)
      .map(row => downloadKey(row.download));
    const reduced = this.#window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const expanded = this.#state.expanded;
    const sidebar = this.#window.document.getElementById?.("navigator-toolbox");
    const width = sidebar ? Math.min(sidebar.clientWidth, 1000) - 16 :
      this.#rows[0]?.width || this.#state.width;
    if (!animate || reduced || (!key && !canDismiss && !expanded && this.#selected !== null)) {
      this.#state = new DownloadThumbnailState({ items, selected: key, active, width });
      this.#state.expanded = expanded;
      this.#state.reset(now);
      if (!animate || reduced) this.#icon.stop();
      else this.#icon.update("reset");
    } else {
      this.#state.width = width;
      this.#state.setItems(items, active, now);
      if (key !== this.#selected) {
        this.#state.select(key, now);
        this.#icon.update(expanded ? "reset" : key ? "arrival" : "dismissal");
      }
    }
    this.#selected = key;
    this.#selectedItem = item;
    if (downloadKey(item) === this.#state.visible) this.#displayed = item;
    this.#paint(now);
    this.#schedule();
  }

  resize() {
    this.sync(this.#rows.map(({ row }) => row), this.#selectedItem);
  }

  setExpanded(expanded) {
    if (this.#destroyed) return Promise.resolve();
    const now = this.#now();
    this.#state.sample(now);
    this.#state.setExpanded(expanded, now);
    this.#icon.update("reset");
    if (this.#window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.#state.pending = [];
      for (const id of this.#state.items) this.#state.nodes.set(id, this.#state.newChannels(id));
    }
    this.#paint(now);
    this.#schedule();
    if (!this.#state.moving) return Promise.resolve();
    return new Promise(resolve => this.#waiters.push(resolve));
  }

  #paint(time) {
    const values = this.#state.sample(time);
    for (const { row, id, iconX, iconY, details } of this.#rows) {
      const value = values.get(id);
      if (!value) continue;
      // Keep the DOM at its resting width. Compose the interpolated frame
      // center and inner icon position into a transform, avoiding layout work
      // on each frame while preserving the native curved horizontal path.
      const center = value.width / 2;
      const x = value.x + center + iconX - this.#state.localX;
      row.style.transform = `translate(${x}px, ${value.y + iconY}px) rotate(${value.rotation}deg) scale(${value.scale}) translate(${value.localX - center - iconX}px, ${-iconY}px)`;
      row.style.opacity = Math.max(0, Math.min(1, value.opacity));
      const progress = (value.width - 40) / Math.max(1, this.#state.width - 40);
      for (const node of details) {
        node.style.opacity = Math.max(0, Math.min(1, progress));
        node.style.transform = `translateX(${4 * (1 - progress)}px)`;
      }
      row.toggleAttribute("zen-library-footer-badge", id === this.#state.visible);
    }
    this.#displayed = this.#rows.find(({ id }) => id === this.#state.visible)?.row.download ?? null;
    if (!this.#state.moving) {
      for (const resolve of this.#waiters.splice(0)) resolve();
    }
  }

  #schedule() {
    if (this.#timer !== null) this.#clock.clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#state.pending.length) {
      const next = Math.min(...this.#state.pending.map(event => event.time));
      this.#timer = this.#clock.setTimeout(() => {
        this.#timer = null;
        if (this.#destroyed) return;
        const now = Math.max(next, this.#now());
        this.#state.sample(now);
        const previous = this.#state.visible;
        this.#state.callbacks(now);
        this.#paint(now);
        if (previous !== this.#state.visible) this.#changed();
        this.#schedule();
      }, Math.max(0, (next - this.#now()) * 1000));
    }
    if (this.#state.moving) this.#scheduleFrame();
  }

  #scheduleFrame() {
    if (this.#frame !== null || this.#destroyed) return;
    this.#frame = this.#window.requestAnimationFrame(time => {
      this.#frame = null;
      if (this.#destroyed) return;
      this.#paint(time / 1000);
      if (this.#state.moving) this.#scheduleFrame();
    });
  }

  destroy() {
    this.#destroyed = true;
    if (this.#frame !== null) this.#window.cancelAnimationFrame(this.#frame);
    if (this.#timer !== null) this.#clock.clearTimeout(this.#timer);
    this.#icon.stop();
    this.#state.nodes.clear(); this.#state.pending = []; this.#rows = [];
    this.#displayed = this.#selectedItem = null;
    for (const resolve of this.#waiters.splice(0)) resolve();
  }
}
