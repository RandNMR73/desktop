/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Arc HomeBadgingCellStack uses interactiveSpring(0.15, 0.86, 0.25).
// The response and damping stay constant, so response blending is unnecessary.
const OMEGA = 2 * Math.PI / 0.15;
const DECAY = OMEGA * 0.86;
const FREQUENCY = OMEGA * Math.sqrt(1 - 0.86 ** 2);
// SwiftUI.Spring's settlingDuration for those parameters, measured natively.
export const DOWNLOAD_SPRING_DURATION = 0.2920116798274432;
export const DOWNLOAD_ROW_STAGGER = 0.0125;
const settledFrames = new Map();

export function downloadSpring(value, velocity, target, seconds) {
  const a = value - target;
  const b = (velocity + DECAY * a) / FREQUENCY;
  const t = Math.max(0, seconds);
  const c = Math.cos(FREQUENCY * t), s = Math.sin(FREQUENCY * t);
  const e = Math.exp(-DECAY * t);
  return {
    value: target + e * (a * c + b * s),
    velocity: e * ((b * FREQUENCY - DECAY * a) * c -
      (a * FREQUENCY + DECAY * b) * s),
  };
}

export function sampleDownloadMotion(motion, time) {
  if (!motion) return { value: 0, velocity: 0 };
  if (time < motion.start) return sampleDownloadMotion(motion.previous, time);
  if (time >= motion.end) return { value: motion.target, velocity: 0 };
  return downloadSpring(motion.value, motion.velocity, motion.target, time - motion.start);
}

export function retargetDownloadMotion(previous, target, time, delay = 0) {
  const start = time + delay;
  // Continue an interrupted animation through the stagger, then carry its
  // position and velocity into the new spring. CSS reversal loses momentum.
  const state = sampleDownloadMotion(previous, start);
  return { ...state, target, start, end: start + DOWNLOAD_SPRING_DURATION, previous };
}

export function downloadRowFrames(motion, now, distance) {
  const duration = motion.end - now;
  const key = motion.velocity === 0 && (!motion.previous || motion.previous.end <= now)
    ? `${motion.value}:${motion.target}:${(motion.start - now).toFixed(6)}:${distance}`
    : null;
  if (key && settledFrames.has(key)) return settledFrames.get(key);
  const times = new Set([0, motion.start - now, duration]);
  // 1ms samples keep linear interpolation within 0.02pt of the native curve
  // for these 20/56pt rows; the compositor runs them without per-frame JS.
  for (let t = 0.001; t < duration; t += 0.001) times.add(t);
  const samples = [...times].sort((a, b) => a - b).map(t => {
    const { value } = sampleDownloadMotion(motion, now + t);
    return { t, value, opacity: Math.max(0, Math.min(1, value)) };
  });
  // Keep only the points needed to preserve that curve. Passing hundreds of
  // redundant transform strings to the animation engine adds avoidable work.
  const kept = new Set([0, samples.length - 1]);
  const simplify = (first, last) => {
    const a = samples[first], b = samples[last];
    let error = 0.0001, selected = -1;
    for (let i = first + 1; i < last; i++) {
      const p = samples[i], fraction = (p.t - a.t) / (b.t - a.t);
      const difference = Math.max(
        Math.abs(p.value - (a.value + (b.value - a.value) * fraction)),
        Math.abs(p.opacity - (a.opacity + (b.opacity - a.opacity) * fraction))
      );
      if (difference > error) { error = difference; selected = i; }
    }
    if (selected < 0) return;
    kept.add(selected);
    simplify(first, selected);
    simplify(selected, last);
  };
  simplify(0, samples.length - 1);
  const frames = [...kept].sort((a, b) => a - b).map(i => {
    const { t, value, opacity } = samples[i];
    return {
      offset: t / duration,
      transform: `translateY(${distance * (1 - value)}px)`,
      opacity,
    };
  });
  if (key && settledFrames.size < 8) settledFrames.set(key, frames);
  return frames;
}

// A badge expands from a 40pt frame scaled to 0.55 (completed) or 0.8 (active) into the full
// row. SwiftUI interpolates the frame's layout as well as its scale. Their
// composition produces this quadratic horizontal path (not a Bezier easing).
// Native offscreen hosting samples verify both the icon and inserted details.
export function downloadBadgeGeometry(progress, visibility, geometry) {
  const { width, iconX, iconY, dx, dy, distance, closedScale = 0.55 } = geometry;
  const scale = closedScale + (1 - closedScale) * progress;
  const bow = (1 - closedScale) * (width - 48) / 2;
  return {
    x: dx * (1 - progress) + bow * progress * (1 - progress) + iconX * (1 - scale),
    y: dy * (1 - progress) + distance * (1 - visibility) + iconY * (1 - scale),
    scale,
    opacity: Math.max(0, Math.min(1, visibility)),
    detailsX: 4 * (1 - progress),
    detailsOpacity: Math.max(0, Math.min(1, progress)),
  };
}

export function downloadBadgeFrames(expansion, visibility, now, geometry) {
  const end = Math.max(expansion.end, visibility.end);
  const duration = end - now;
  const at = t => ({ t, ...downloadBadgeGeometry(
    sampleDownloadMotion(expansion, now + t).value,
    sampleDownloadMotion(visibility, now + t).value, geometry
  ) });
  const limits = { x: 0.002, y: 0.002, scale: 0.002 / geometry.width,
    opacity: 0.0001, detailsX: 0.002, detailsOpacity: 0.0001 };
  const points = [at(0)];
  const append = (a, b) => {
    const middle = at((a.t + b.t) / 2);
    let divide = false;
    for (const key in limits) {
      if (Math.abs(middle[key] - (a[key] + b[key]) / 2) > limits[key]) {
        divide = true;
        break;
      }
    }
    if (divide && b.t - a.t > 0.000125) {
      append(a, middle);
      append(middle, b);
    } else points.push(b);
  };
  // Short initial intervals cannot alias the spring's oscillation. Refine
  // only where curvature requires it, bounding the scaled far edge as well
  // as the icon, without constructing thousands of throwaway keyframes.
  const times = new Set([0, expansion.start - now, visibility.start - now, duration]);
  for (let t = 0.01; t < duration; t += 0.01) times.add(t);
  for (const t of [...times].filter(t => t > 0 && t <= duration).sort((a, b) => a - b)) {
    append(points.at(-1), at(t));
  }
  return {
    duration: duration * 1000,
    row: points.map(p => ({ offset: p.t / duration,
      transform: `translate(${p.x}px, ${p.y}px) scale(${p.scale})`, opacity: p.opacity })),
    details: points.map(p => ({ offset: p.t / duration,
      transform: `translateX(${p.detailsX}px)`, opacity: p.detailsOpacity })),
  };
}

const restingMotion = (value, time) =>
  ({ value, velocity: 0, target: value, start: time, end: time, previous: null });

export class ZenDownloadMotion {
  #window;
  #rows;
  #motions = new Map();
  #animations = new Map();
  #badges = new Map();

  constructor(window, rows) {
    this.#window = window;
    this.#rows = rows;
  }

  badgeGeometry(row) {
    const state = this.#badges.get(row);
    // During a reversal the DOM bounds include the presentation transform.
    // Reuse its original layout; a settled row can be measured after resize.
    return state?.animations.length ? state.geometry : null;
  }

  resetRow(row, expanded = false) {
    const badge = this.#badges.get(row);
    for (const animation of badge?.animations ?? []) animation.cancel();
    this.#badges.delete(row);
    this.#animations.get(row)?.cancel();
    this.#animations.delete(row);
    this.#motions.set(row, restingMotion(expanded ? 1 : 0,
      this.#window.document.timeline.currentTime / 1000));
    row.removeAttribute("zen-library-active-badge");
  }

  setExpanded(expanded, badge = null) {
    const now = this.#window.document.timeline.currentTime / 1000;
    const reduced = this.#window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finished = [];
    if (badge && !this.#badges.has(badge.row)) {
      this.#badges.set(badge.row, {
        geometry: badge,
        expansion: restingMotion(expanded ? 0 : 1, now),
        visibility: restingMotion(1, now),
        animations: [],
      });
    }
    this.#rows.forEach((row, i) => {
      const index = this.#rows.length - 1 - i;
      const target = expanded ? 1 : 0;
      const badgeState = this.#badges.get(row);
      if (badgeState) {
        const retained = !!badge?.retained && badge.row === row;
        if (!badgeState.animations.length && badge?.row === row) badgeState.geometry = badge;
        row.toggleAttribute("zen-library-active-badge", retained ||
          row.hasAttribute("zen-library-active-badge"));
        for (const animation of badgeState.animations) animation.cancel();
        this.#animations.get(row)?.cancel();
        this.#animations.delete(row);
        if (!reduced && !row.hidden) {
          // Active badges return to the footer without fading. Completed
          // badges are consumed on expansion: a quick exit continues their
          // expansion while fading toward the ordinary closed-row position.
          badgeState.expansion = retargetDownloadMotion(badgeState.expansion, retained ? target : 1, now,
            index * DOWNLOAD_ROW_STAGGER);
          badgeState.visibility = retargetDownloadMotion(badgeState.visibility, retained ? 1 : target, now,
            index * DOWNLOAD_ROW_STAGGER);
          const frames = downloadBadgeFrames(badgeState.expansion, badgeState.visibility, now,
            badgeState.geometry);
          const options = { duration: frames.duration, fill: "both" };
          const animations = [row.animate(frames.row, options),
            ...[...row.querySelectorAll(".zen-library-download-list-title-container, .zen-library-download-action")]
              .map(node => node.animate(frames.details, options))];
          for (const animation of animations) animation.startTime = now * 1000;
          badgeState.animations = animations;
          finished.push(Promise.all(animations.map(animation => animation.finished)).then(() => {
            if (badgeState.animations !== animations) return;
            for (const animation of animations) animation.cancel();
            badgeState.animations = [];
            if (retained && expanded) {
              badgeState.expansion = restingMotion(1, now);
              badgeState.visibility = restingMotion(1, now);
            } else {
              this.#badges.delete(row);
              row.removeAttribute("zen-library-active-badge");
            }
            this.#motions.set(row, restingMotion(target, now));
          }, () => {}));
          return;
        }
        badgeState.animations = [];
        if (retained && expanded && !row.hidden) {
          badgeState.expansion = restingMotion(1, now);
          badgeState.visibility = restingMotion(1, now);
        } else {
          this.#badges.delete(row);
          row.removeAttribute("zen-library-active-badge");
        }
      }
      const motion = retargetDownloadMotion(
        this.#motions.get(row), target, now, index * DOWNLOAD_ROW_STAGGER
      );
      this.#animations.get(row)?.cancel();
      if (reduced || row.hidden) {
        motion.start = motion.end = now;
        motion.previous = null;
        this.#motions.set(row, motion);
        this.#animations.delete(row);
        return;
      }
      this.#motions.set(row, motion);
      const animation = row.animate(downloadRowFrames(motion, now, index ? 56 : 20), {
        duration: (motion.end - now) * 1000,
        fill: "both",
      });
      animation.startTime = now * 1000;
      this.#animations.set(row, animation);
      finished.push(animation.finished.then(() => {
        if (this.#animations.get(row) !== animation) return;
        animation.cancel();
        this.#animations.delete(row);
        motion.previous = null;
      }, () => {}));
    });
    return Promise.all(finished);
  }

  destroy() {
    for (const badge of this.#badges.values()) {
      for (const animation of badge.animations) animation.cancel();
    }
    this.#badges.clear();
    for (const row of this.#rows) row.removeAttribute("zen-library-active-badge");
    for (const animation of this.#animations.values()) animation.cancel();
    this.#animations.clear();
    this.#motions.clear();
  }
}

// HomeBadgingCellStack's arrival is a 200ms drop, a 20ms hold, then a
// mass=1/stiffness=500/damping=25 spring with normalized initial velocity 10.
export const DOWNLOAD_ARRIVAL_SETTLING = 0.7608355971541216;
export function downloadArrivalSpring(seconds) {
  const t = Math.max(0, seconds), frequency = Math.sqrt(500 - 12.5 ** 2);
  return 1 + Math.exp(-12.5 * t) *
    (-Math.cos(frequency * t) + (10 - 12.5) / frequency * Math.sin(frequency * t));
}

export function downloadArrivalFrames() {
  const duration = 0.22 + DOWNLOAD_ARRIVAL_SETTLING;
  const points = [{t:0, y:-8, opacity:0, button:0, easing:"cubic-bezier(0.78, 0, 0.7, 1)"},
    {t:0.2, y:12, opacity:1, button:6}, {t:0.22, y:12, opacity:1, button:6}];
  const at = t => ({t:0.22+t, y:12*(1-downloadArrivalSpring(t)), opacity:1,
    button:6*(1-downloadArrivalSpring(t))});
  const append = (a,b) => {
    const middle = at((a.t+b.t)/2-0.22);
    if (Math.abs(middle.y-(a.y+b.y)/2)>0.001 && b.t-a.t>0.000125) {
      append(a,middle);append(middle,b);
    } else points.push(b);
  };
  for (let t=0.02;t<DOWNLOAD_ARRIVAL_SETTLING;t+=0.02) append(points.at(-1),at(t));
  append(points.at(-1),{t:duration,y:0,opacity:1,button:0});
  return {duration:duration*1000,
    badge:points.map(p=>({offset:p.t/duration,transform:`translateY(${p.y}px)`,opacity:p.opacity,
      ...(p.easing ? {easing:p.easing} : {})})),
    button:points.map(p=>({offset:p.t/duration,translate:`0 ${p.button}px`,
      ...(p.easing ? {easing:p.easing} : {})})),
  };
}
const ARRIVAL_FRAMES = downloadArrivalFrames();

function downloadDropProgress(progress) {
  if (progress <= 0 || progress >= 1) return Math.max(0, Math.min(1, progress));
  let lower = 0, upper = 1, t = progress;
  for (let i = 0; i < 20; i++) {
    const left = 1 - t;
    const x = 3 * left * left * t * 0.78 + 3 * left * t * t * 0.7 + t ** 3;
    if (Math.abs(x - progress) < 1e-12) break;
    if (x < progress) lower = t; else upper = t;
    const derivative = 3 * left * left * 0.78 + 6 * left * t * (0.7 - 0.78) +
      3 * t * t * (1 - 0.7);
    const next = t - (x - progress) / derivative;
    t = next > lower && next < upper ? next : (lower + upper) / 2;
  }
  return 3 * (1 - t) * t * t + t ** 3;
}

const emptyIconMotion = () => ({ targets: { y: 0, scale: 1 }, pending: [], segments: [] });
function writeIconTarget(state, event) {
  const difference = state.targets[event.property] - event.value;
  state.targets[event.property] = event.value;
  if (event.duration && difference) {
    // SwiftUI interpolates from the continuing previous animation to the new
    // target. Its residual is therefore weighted by the new interpolation too.
    state.segments = state.segments.map(segment =>
      segment.property === event.property &&
      segment.time + segment.duration > event.time ? {
        ...segment, factors: [...(segment.factors ?? []), event],
      } : segment);
  }
  if (event.duration && difference) state.segments.push({ ...event, difference });
}
function advanceIconMotion(previous, time) {
  const state = { targets: { ...previous.targets }, pending: [], segments: [...previous.segments] };
  for (const event of previous.pending) {
    if (event.time <= time) writeIconTarget(state, event); else state.pending.push(event);
  }
  state.segments = state.segments.filter(event => event.time + event.duration > time);
  return state;
}

// SwiftUI keeps unfinished interpolation contributions when a State target is
// changed. A non-animated reset changes the target without removing those
// contributions, and delayed callbacks are independent of later selections.
export function updateDownloadIcon(previous, action, time) {
  const state = advanceIconMotion(previous ?? emptyIconMotion(), time);
  const write = (property, value, curve, duration = 0, delay = 0) => {
    const event = { property, value, curve, duration, time: time + delay };
    if (delay) state.pending.push(event); else writeIconTarget(state, event);
  };
  if (action === "arrival" || action === "reset") write("y", 0);
  write("scale", 1);
  if (action === "arrival") {
    write("y", 6, "drop", 200);
    write("y", 0, "spring", DOWNLOAD_ARRIVAL_SETTLING * 1000, 220);
  } else if (action === "dismissal") {
    write("scale", 1.2, "linear", 100, 160);
    write("scale", 1, "linear", 100, 270);
  }
  state.pending.sort((a, b) => a.time - b.time);
  return state;
}

export function sampleDownloadIcon(state, time) {
  const current = advanceIconMotion(state, time), result = { ...current.targets };
  const residual = event => {
    const progress = (time - event.time) / event.duration;
    const value = event.curve === "spring" ? downloadArrivalSpring((time - event.time) / 1000) :
      event.curve === "drop" ? downloadDropProgress(progress) : progress;
    return progress >= 1 ? 0 : 1 - value;
  };
  for (const event of current.segments) {
    const factor = (event.factors ?? []).reduce((value, next) => value * residual(next), 1);
    result[event.property] += event.difference * residual(event) * factor;
  }
  return result;
}

export function downloadIconFrames(state, now) {
  const end = Math.max(now, ...[...state.pending, ...state.segments].map(e => e.time + e.duration));
  if (end === now) return null;
  const at = time => ({ time, ...sampleDownloadIcon(state, time) });
  const points = [at(now)], times = new Set([end]);
  for (const event of [...state.pending, ...state.segments]) {
    if (event.time > now) times.add(event.time);
    if (event.time + event.duration > now) times.add(event.time + event.duration);
  }
  const append = (a, b) => {
    const middle = at((a.time + b.time) / 2);
    if ((Math.abs(middle.y - (a.y + b.y) / 2) > 0.001 ||
         Math.abs(middle.scale - (a.scale + b.scale) / 2) > 0.0001) && b.time - a.time > 0.125) {
      append(a, middle); append(middle, b);
    } else points.push(b);
  };
  for (let time = now + 10; time < end; time += 10) times.add(time);
  for (const time of [...times].sort((a, b) => a - b)) append(points.at(-1), at(time));
  return { duration: end - now, frames: points.map(p => ({ offset: (p.time - now) / (end - now),
    translate: `0 ${p.y}px`, transform: `scale(${p.scale})` })) };
}

const restingIconFrames = new Map();
export class ZenDownloadIconMotion {
  #window;
  #sprite;
  #state = emptyIconMotion();
  #animation = null;
  #clock;
  #timer = null;
  constructor(window, sprite, clock) { this.#window = window; this.#sprite = sprite; this.#clock = clock; }
  update(action) {
    const now = this.#window.document.timeline.currentTime;
    const prior = advanceIconMotion(this.#state, now);
    const resting = !prior.pending.length && !prior.segments.length;
    this.#state = updateDownloadIcon(this.#state, action, now);
    if (this.#timer !== null) this.#clock.clearTimeout(this.#timer);
    this.#timer = null;
    this.#animation?.cancel();
    this.#animation = null;
    let frames = resting ? restingIconFrames.get(action) : null;
    if (!frames) {
      frames = downloadIconFrames(this.#state, now);
      if (resting && frames) restingIconFrames.set(action, frames);
    }
    if (!frames) return;
    const animation = this.#sprite.animate(frames.frames, { duration: frames.duration, fill: "both" });
    animation.startTime = now;
    this.#animation = animation;
    const complete = () => {
      if (this.#animation !== animation) return;
      this.stop();
    };
    animation.finished.then(complete, () => {});
    this.#timer = this.#clock.setTimeout(complete, frames.duration);
  }
  stop() {
    if (this.#timer !== null) this.#clock.clearTimeout(this.#timer);
    this.#timer = null;
    this.#animation?.cancel(); this.#animation = null; this.#state = emptyIconMotion();
  }
}

/** Local presentation may outlive the shared selected ID during dismissal. */
export class ZenDownloadBadgeMotion {
  #window;
  #badge;
  #changed;
  #selected = null;
  #displayed = null;
  #animations = [];
  #destroyed = false;
  #clock;
  #dismissTimer = null;
  #iconMotion;

  constructor(window, badge, sprite, changed, clock = {
    setTimeout: (...args) => ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs").setTimeout(...args),
    clearTimeout: timer => ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs").clearTimeout(timer),
  }) {
    this.#window=window;this.#badge=badge;this.#changed=changed;this.#clock=clock;
    this.#iconMotion = new ZenDownloadIconMotion(window, sprite, clock);
  }
  get displayed() { return this.#displayed; }

  #cancel() {
    if (this.#dismissTimer !== null) this.#clock.clearTimeout(this.#dismissTimer);
    this.#dismissTimer = null;
    for (const animation of this.#animations) animation.cancel();
    this.#animations=[];
  }
  reset(item = this.#selected) {
    this.#cancel();this.#selected=item;this.#displayed=item;
    this.#iconMotion.update("reset");
  }
  #play(entries, dismissed = false) {
    const now=this.#window.document.timeline.currentTime;
    const animations=entries.map(([element,frames,duration])=>
      element.animate(frames,{duration,fill:"both"}));
    for (const animation of animations) animation.startTime=now;
    this.#animations=animations;
    const complete=()=>{
      if (this.#destroyed || this.#animations!==animations) return;
      this.#cancel();
      if (dismissed) {this.#displayed=this.#selected;this.#changed();}
    };
    Promise.all(animations.map(a=>a.finished)).then(() => {
      if (!dismissed) complete();
    },()=>{});
    // Arc dispatches its identity cleanup after 390ms independently of the
    // rendered animation. Occluded windows must not wait for a compositor tick.
    if (dismissed) this.#dismissTimer=this.#clock.setTimeout(complete,390);
  }
  update(item, {expanded=false, animate=true, canDismiss=true} = {}) {
    if (this.#destroyed) return null;
    if (expanded || !animate || this.#window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (!animate || this.#window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        this.#iconMotion.stop();
      } else if (item !== this.#selected) this.#iconMotion.update("reset");
      this.#cancel();this.#selected=item;this.#displayed=item;
      return this.#displayed;
    }
    if (item===this.#selected) return this.#displayed;
    const previous=this.#displayed;
    const parent=this.#badge.parentElement;
    const style=!item && this.#animations.length
      ? this.#window.getComputedStyle(parent) : {transform:"none", opacity:"1"};
    const y=style.transform==="none" ? 0 : new this.#window.DOMMatrixReadOnly(style.transform).f;
    const opacity=Number(style.opacity);
    this.#cancel();this.#selected=item;this.#displayed=item;
    if (item) {
      this.#play([[parent,ARRIVAL_FRAMES.badge,ARRIVAL_FRAMES.duration]]);
      this.#iconMotion.update("arrival");
    } else if (previous && canDismiss) {
      this.#displayed=previous;
      const scale=previous.succeeded ? 0.55 : 0.8;
      // Scale and rotation act about the 40pt thumbnail's center, followed
      // by the native -14/+20pt translation. Keep its artwork while fading.
      const transform=(x,y,s,r)=>`translate(${x}px, ${y}px) rotate(${r}deg) scale(${s}) translate(-20px, -20px)`;
      const badge=[{transform:transform(24,2+y,scale,0),opacity},
        {transform:transform(10,22,0.2,-45),opacity:0}];
      this.#play([[this.#badge,badge,140]],true);
      this.#iconMotion.update("dismissal");
    }
    return this.#displayed;
  }
  destroy() {
    this.#destroyed=true;this.#cancel();this.#iconMotion.stop();this.#displayed=this.#selected=null;
  }
}
