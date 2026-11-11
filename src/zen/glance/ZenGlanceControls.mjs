/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ThemeControlSpring } from "resource:///modules/zen/ZenThemeColorPad.mjs";
import { createNativePeekControls } from "resource:///modules/zen/ZenNativeTheme.sys.mjs";

export class GlanceControlPaint {
  constructor(container, create = createNativePeekControls, isDriven = () => false) {
    this.container = container;
    this.window = container.ownerDocument.defaultView;
    this.isDriven = isDriven;
    this.frame = null;
    this.parents = [];
    this.abort = new this.window.AbortController();
    this.schedule = () => {
      if (!this.destroyed && this.surface && this.frame === null && !this.isDriven())
        this.frame = this.window.requestAnimationFrame(() => this.sync());
    };
    Promise.resolve().then(() => create(this.window)).then(surface => {
      if (this.destroyed) { surface?.clear(); return; }
      if (!surface) return;
      this.surface = surface;
      this.observer = new this.window.MutationObserver(records => {
        // The spring driver synchronizes these writes in the same frame.
        if (records.some(r => !(r.type === "attributes" && r.attributeName === "style" &&
            r.target.matches("toolbarbutton")))) this.schedule();
      });
      this.resize = new this.window.ResizeObserver(this.schedule);
      const events = ["resize", "sizemodechange", "fullscreen", "activate", "TabSelect",
        "popupshowing", "popupshown", "popuphidden", "focusin", "focusout", "transitionrun",
        "transitionend", "transitioncancel", "animationstart", "animationend", "animationcancel",
        "ZenCompactMode:LayoutUpdate", "ZenCompactMode:Toggled",
        "ZenNativeThemeChanged", "ZenNativeThemeReady"];
      for (const name of events) this.window.addEventListener(name, this.schedule,
        { capture: true, signal: this.abort.signal });
      for (const query of ["(forced-colors: active)", "(prefers-contrast: more)"])
        this.window.matchMedia(query).addEventListener("change", this.schedule, { signal: this.abort.signal });
      this.observeParents();
      this.schedule();
    }).catch(() => { /* A missing native helper leaves CSS unchanged. */ });
  }

  observeParents() {
    if (!this.observer) return;
    const parents = [];
    for (let element = this.container.parentElement; element; element = element.parentElement)
      parents.push(element);
    if (this.parents.length && parents.length === this.parents.length &&
        parents.every((element, i) => element === this.parents[i])) return;
    this.parents = parents;
    this.observer.disconnect();
    this.resize.disconnect();
    this.resize.observe(this.container);
    this.observer.observe(this.container, { attributes: true, childList: true, subtree: true,
      attributeFilter: ["style", "hidden", "disabled", "waitconfirmation", "class", "label", "value"] });
    // Compact mode and Peek entrance both change layout through custom
    // attributes. Observe their final state as well as animated style writes.
    for (const element of parents) {
      this.observer.observe(element, { attributes: true, childList: true });
      this.resize.observe(element);
    }
    // Toasts are siblings of the browser tree. Their animated departure and
    // removal must restore controls that correctly yielded to the overlay.
    const toasts = this.container.ownerDocument.getElementById("zen-toast-container");
    if (toasts) this.observer.observe(toasts, {
      attributes: true, childList: true, subtree: true,
      attributeFilter: ["style", "hidden", "class"],
    });
  }

  sync() {
    if (this.frame !== null) this.window.cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.destroyed || !this.surface) return;
    if (this.container.isConnected) this.connected = true;
    else if (this.connected) { this.destroy(); return; }
    this.observeParents();
    let painted = false;
    try { painted = this.surface.sync(this.container) === true; }
    catch { this.surface.clear(); }
    this.container.toggleAttribute("native-peek-controls", painted);
    // Follow only finite layout/entrance/confirmation animations. The spring
    // driver calls sync directly and owns its existing single frame loop.
    if (!this.isDriven()) {
      const animations = this.container.getAnimations({ subtree: true });
      for (const element of this.parents) animations.push(...element.getAnimations());
      if (animations.some(a => (a.pending || a.playState === "running") &&
          a.effect?.getComputedTiming().iterations !== Infinity)) this.schedule();
    }
  }

  clear() {
    this.surface?.clear();
    this.container.removeAttribute("native-peek-controls");
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.frame !== null) this.window.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.abort.abort();
    this.observer?.disconnect();
    this.resize?.disconnect();
    this.clear();
    this.parents = [];
  }
}

// Arc 1.172.1 ModalButtonStyle.ButtonView: hover response .15 / damping .95,
// press response .28 / damping .63. Its fill does not change on hover.
export class GlanceControlMotion {
  constructor(container) {
    this.container = container;
    this.window = container.ownerDocument.defaultView;
    this.states = new Map();
    this.frame = null;
    this.nativePaint = new GlanceControlPaint(container, createNativePeekControls, () => this.moving());
    this.abort = new this.window.AbortController();
    const listen = (target, name, callback, capture = false) =>
      target.addEventListener(name, callback, { capture, signal: this.abort.signal });
    const buttonFor = event => {
      const button = event.target.closest?.("toolbarbutton");
      return button && container.contains(button) ? button : null;
    };
    listen(container, "pointerover", event => {
      const button = buttonFor(event);
      if (button && !button.contains(event.relatedTarget))
        this.set(button, { hover: true, press: this.pointerOwner === button && !!(event.buttons & 1) });
    });
    listen(container, "pointerout", event => {
      const button = buttonFor(event);
      if (button && !button.contains(event.relatedTarget)) this.set(button, { hover: false, press: false });
    });
    listen(container, "pointerdown", event => {
      const button = buttonFor(event);
      if (button && !button.disabled && event.button === 0) {
        this.pointerOwner = button;
        this.set(button, { press: true });
      }
    });
    listen(this.window, "pointerup", event => { if (event.button === 0) this.release(); }, true);
    listen(this.window, "pointercancel", () => this.release(), true);
    listen(this.window, "blur", () => this.reset());
    listen(container, "keydown", event => {
      const button = buttonFor(event);
      if (button && [" ", "Enter"].includes(event.key) && !event.repeat) this.set(button, { press: true });
    });
    listen(this.window, "keyup", event => { if ([" ", "Enter"].includes(event.key)) this.release(); }, true);
    listen(this.window, "unload", () => this.destroy());
    this.disabledObserver = new this.window.MutationObserver(records => {
      for (const { target } of records) if (target.disabled) this.clearButton(target);
    });
    this.disabledObserver.observe(container, { attributes: true, subtree: true, attributeFilter: ["disabled"] });
  }

  set(button, changes) {
    if (this.destroyed || !button.isConnected || button.disabled) return;
    let state = this.states.get(button);
    if (!state && !changes.hover && !changes.press) return;
    if (!state) {
      const hover = { response: .15, dampingFraction: .95 };
      state = { hover: false, press: false,
        lift: new ThemeControlSpring([-1], hover),
        opacity: new ThemeControlSpring([.1], hover),
        radius: new ThemeControlSpring([2], hover),
        scale: new ThemeControlSpring([-.05, -.05], { response: .28, dampingFraction: .63 }) };
      this.states.set(button, state);
    }
    const pressedChanged = "press" in changes && state.press !== changes.press;
    Object.assign(state, changes);
    const now = this.window.performance.now() / 1000;
    const targets = { lift: +state.hover, opacity: +state.hover,
      radius: +(state.hover && !state.press), scale: +state.press };
    const radiusDynamics = pressedChanged
      ? { response: .28, dampingFraction: .63 }
      : { response: .15, dampingFraction: .95 };
    const reduced = this.window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const [key, target] of Object.entries(targets)) {
      if (reduced) { state[key].active = false; state[key].target = target; }
      else state[key].write(target, now, key === "radius" ? radiusDynamics : null);
    }
    this.paint(button, state, now);
    this.nativePaint.sync();
    if (this.frame === null && this.moving()) this.frame = this.window.requestAnimationFrame(() => this.tick());
  }

  moving() {
    return [...this.states.values()].some(s => [s.lift, s.opacity, s.radius, s.scale].some(p => p.active));
  }

  paint(button, state, now) {
    button.style.setProperty("--zen-peek-control-lift", `${-state.lift.sample(now)}px`);
    button.style.setProperty("--zen-peek-control-scale", 1 - .05 * state.scale.sample(now));
    button.style.setProperty("--zen-peek-control-shadow-opacity", .2 + .1 * state.opacity.sample(now));
    // SwiftUI's shadow radius is the Gaussian sigma. CSS blur-radius is 2σ.
    button.style.setProperty("--zen-peek-control-shadow-blur", `${8 + 4 * state.radius.sample(now)}px`);
  }

  tick() {
    this.frame = null;
    const now = this.window.performance.now() / 1000;
    for (const [button, state] of this.states) {
      if (!button.isConnected) { this.states.delete(button); continue; }
      this.paint(button, state, now);
    }
    this.nativePaint.sync();
    if (this.moving()) this.frame = this.window.requestAnimationFrame(() => this.tick());
  }

  release() {
    this.pointerOwner = null;
    for (const [button, state] of this.states) if (state.press) this.set(button, { press: false });
  }

  clearButton(button, repaint = true) {
    if (this.pointerOwner === button) this.pointerOwner = null;
    for (const name of ["lift", "scale", "shadow-opacity", "shadow-blur"])
      button.style.removeProperty(`--zen-peek-control-${name}`);
    this.states.delete(button);
    if (!this.moving() && this.frame !== null) {
      this.window.cancelAnimationFrame(this.frame);
      this.frame = null;
    }
    if (repaint) this.nativePaint.sync();
  }

  reset() {
    this.pointerOwner = null;
    if (this.frame !== null) this.window.cancelAnimationFrame(this.frame);
    this.frame = null;
    for (const button of this.states.keys()) this.clearButton(button, false);
    this.nativePaint.clear();
    this.nativePaint.schedule();
  }

  destroy() {
    this.destroyed = true;
    this.nativePaint.destroy();
    this.abort.abort();
    this.disabledObserver.disconnect();
    this.reset();
  }
}
