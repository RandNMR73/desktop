/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ThemeControlSpring } from "resource:///modules/zen/ZenThemeColorPad.mjs";

// Arc 1.172.1 ModalButtonStyle.ButtonView: hover response .15 / damping .95,
// press response .28 / damping .63. Its fill does not change on hover.
export class GlanceControlMotion {
  constructor(container) {
    this.container = container;
    this.window = container.ownerDocument.defaultView;
    this.states = new Map();
    this.frame = null;
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
    if (this.moving()) this.frame = this.window.requestAnimationFrame(() => this.tick());
  }

  release() {
    this.pointerOwner = null;
    for (const [button, state] of this.states) if (state.press) this.set(button, { press: false });
  }

  clearButton(button) {
    if (this.pointerOwner === button) this.pointerOwner = null;
    for (const name of ["lift", "scale", "shadow-opacity", "shadow-blur"])
      button.style.removeProperty(`--zen-peek-control-${name}`);
    this.states.delete(button);
    if (!this.moving() && this.frame !== null) {
      this.window.cancelAnimationFrame(this.frame);
      this.frame = null;
    }
  }

  reset() {
    this.pointerOwner = null;
    if (this.frame !== null) this.window.cancelAnimationFrame(this.frame);
    this.frame = null;
    for (const button of this.states.keys()) this.clearButton(button);
  }

  destroy() {
    this.destroyed = true;
    this.abort.abort();
    this.disabledObserver.disconnect();
    this.reset();
  }
}
