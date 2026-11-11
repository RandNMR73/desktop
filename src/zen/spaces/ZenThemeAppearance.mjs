/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { THEME_APPEARANCE } from "./ZenThemeAppearanceData.mjs";
import { ThemeControlSpring } from "./ZenThemeColorPad.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";

const APPEARANCE_LABELS = {
  automatic: "Automatic Appearance", sun: "Light Appearance", moon: "Dark Appearance",
};

/** Shared, view-anchored help for the appearance row. No idle polling. */
export class ThemeAppearanceTooltip {
  constructor(panel) {
    this.panel = panel;
    this.document = panel.ownerDocument;
    this.window = this.document.defaultView;
    this.buttons = new Map();
    this.timer = null;
    this.animation = null;
    this.target = null;
    this.generation = 0;
    this.popup = this.document.createXULElement("tooltip");
    this.popup.id = "zen-theme-appearance-tooltip";
    this.popup.setAttribute("noautohide", "true");
    this.popup.setAttribute("role", "tooltip");
    this.label = this.document.createElementNS("http://www.w3.org/1999/xhtml", "span");
    this.label.className = "zen-theme-appearance-tooltip-label";
    this.popup.appendChild(this.label);
    panel.appendChild(this.popup);
    this.dismiss = () => this.hide(true);
    this.panelClosing = event => { if (event.target === panel) this.hide(true); };
    this.visibility = () => { if (this.document.hidden) this.hide(true); };
    this.popupHidden = event => {
      if (event.target !== this.popup) return;
      this.clearTimer();
      this.cancelAnimation();
      this.clearDescription();
      this.target = null;
      ++this.generation;
    };
    this.unload = () => this.destroy();
    this.window.addEventListener("blur", this.dismiss);
    this.window.addEventListener("keydown", this.dismiss, true);
    this.window.addEventListener("pointerdown", this.dismiss, true);
    this.document.addEventListener("visibilitychange", this.visibility);
    panel.addEventListener("popuphiding", this.panelClosing);
    this.popup.addEventListener("popuphidden", this.popupHidden);
    this.window.addEventListener("unload", this.unload, { once: true });
    this.disabledObserver = new this.window.MutationObserver(() => {
      if (this.target?.disabled) this.hide(true);
    });
  }

  register(button, name) {
    const label = APPEARANCE_LABELS[name];
    const previousLabel = button.getAttribute("aria-label");
    button.setAttribute("aria-label", label);
    const enter = event => {
      if (!event.buttons) this.schedule(button);
    };
    const move = event => {
      // The native configuration is onMouseIdle, not a delay after entry.
      if (event.buttons) this.hide(true);
      else if (this.target === button && this.timer !== null) this.schedule(button);
    };
    const leave = () => { if (this.target === button) this.hide(); };
    button.addEventListener("pointerenter", enter);
    button.addEventListener("pointermove", move);
    button.addEventListener("pointerleave", leave);
    this.buttons.set(button, { label, previousLabel, enter, move, leave });
    this.disabledObserver.observe(button, { attributes: true, attributeFilter: ["disabled"] });
  }

  schedule(button) {
    if (this.panel.state !== "open" || button.disabled || !button.isConnected || this.document.hidden) return;
    const visible = this.popup.state === "open" || this.popup.state === "showing";
    this.clearTimer();
    this.clearDescription();
    if (!visible) this.cancelAnimation();
    this.target = button;
    const generation = ++this.generation;
    // A visible view-anchored tooltip changes directly to the next target.
    // The 10ms / 600ms recency shortcut belongs only to cursor-anchored help.
    if (visible) this.show(button, generation);
    else this.timer = this.window.setTimeout(() => {
      this.timer = null;
      this.show(button, generation);
    }, 450);
  }

  show(button, generation) {
    if (generation !== this.generation || this.target !== button ||
        this.panel.state !== "open" || button.disabled || !button.isConnected || this.document.hidden) return;
    this.label.textContent = this.buttons.get(button).label;
    button.setAttribute("aria-describedby", this.popup.id);
    const visible = this.popup.state === "open" || this.popup.state === "showing";
    // Native opacity transitions start at the presentation layer's current
    // value. Reversing a fade must not flash back to fully opaque or invisible.
    const opacity = visible ? Number(this.window.getComputedStyle(this.label).opacity) : 0;
    this.cancelAnimation();
    if (visible) this.popup.moveToAnchor(button, "bottomcenter topcenter", 0, 4, false);
    else this.popup.openPopup(button, "bottomcenter topcenter", 0, 4, false, false);
    if (opacity < 1 && !this.window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.animation = this.label.animate([{ opacity }, { opacity: 1 }],
        { duration: 50, easing: "ease-out" });
    }
  }

  hide(immediate = false) {
    this.clearTimer();
    this.clearDescription();
    this.target = null;
    const generation = ++this.generation;
    const opacity = Number(this.window.getComputedStyle(this.label).opacity);
    this.cancelAnimation();
    if (immediate || this.window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        this.popup.state !== "open") {
      this.popup.hidePopup();
      return;
    }
    this.animation = this.label.animate([{ opacity }, { opacity: 0 }],
      { duration: 300, easing: "ease-out", fill: "forwards" });
    this.animation.finished.then(() => {
      if (generation === this.generation) this.popup.hidePopup();
    }, () => {});
  }

  clearTimer() {
    if (this.timer !== null) this.window.clearTimeout(this.timer);
    this.timer = null;
  }

  clearDescription() {
    if (this.target?.getAttribute("aria-describedby") === this.popup.id)
      this.target.removeAttribute("aria-describedby");
  }

  cancelAnimation() {
    this.animation?.cancel();
    this.animation = null;
  }

  destroy() {
    this.hide(true);
    this.disabledObserver.disconnect();
    for (const [button, { previousLabel, enter, move, leave }] of this.buttons) {
      button.removeEventListener("pointerenter", enter);
      button.removeEventListener("pointermove", move);
      button.removeEventListener("pointerleave", leave);
      if (previousLabel === null) button.removeAttribute("aria-label");
      else button.setAttribute("aria-label", previousLabel);
    }
    this.buttons.clear();
    this.window.removeEventListener("blur", this.dismiss);
    this.window.removeEventListener("keydown", this.dismiss, true);
    this.window.removeEventListener("pointerdown", this.dismiss, true);
    this.document.removeEventListener("visibilitychange", this.visibility);
    this.panel.removeEventListener("popuphiding", this.panelClosing);
    this.popup.removeEventListener("popuphidden", this.popupHidden);
    this.window.removeEventListener("unload", this.unload);
    this.popup.remove();
  }
}

// SwiftUI RoundedRectangle(cornerRadius: 8, style: .continuous), in 32pt.
const BUTTON_OUTLINE = "M32 16 L32 19.77068 C32 23.29208 32 25.052744 31.400709 26.948048 C30.64752 29.017408 29.017408 30.64752 26.948048 31.400709 C25.052744 32 23.29208 32 19.77068 32 L12.22932 32 C8.70792 32 6.947256 32 5.051952 31.400709 C2.982592 30.64752 1.35248 29.017408 .599291 26.948048 C0 25.052744 0 23.29208 0 19.77068 L0 12.22932 C0 8.70792 0 6.947256 .599291 5.051952 C1.35248 2.982592 2.982592 1.35248 5.051952 .599291 C6.947256 0 8.70792 0 12.22932 0 L19.77068 0 C23.29208 0 25.052744 0 26.948048 .599291 C29.017408 1.35248 30.64752 2.982592 31.400709 5.051952 C32 6.947256 32 8.70792 32 12.22932 Z";

/** Arc's LoopingToggleView follows selection, independently of button hover. */
export class ThemeAppearanceIcon {
  constructor(button, name, panel) {
    this.button = button;
    this.panel = panel;
    this.name = name;
    this.document = button.ownerDocument;
    this.window = this.document.defaultView;
    this.data = THEME_APPEARANCE[name];
    this.selected = false;
    this.finishingCycle = false;
    this.pressed = false;
    this.pressFrame = null;
    this.pressSpring = new ThemeControlSpring([-.1, -.1], { response: .3, dampingFraction: .5 });
    this.open = panel.state === "open";
    this.animations = [];
    this.motionPreference = this.window.matchMedia("(prefers-reduced-motion: reduce)");

    const svg = (tag, attrs = {}) => {
      const element = this.document.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
      return element;
    };
    const shape = node => {
      const element = svg(node.tag, node.attrs);
      for (const child of node.children) element.appendChild(shape(child));
      return element;
    };
    this.drawing = svg("svg", {
      viewBox: `0 0 ${this.data.size.join(" ")}`,
      class: "zen-theme-appearance-icon", "aria-hidden": "true", fill: "none",
      x: 6, y: 6, width: 20, height: 20,
    });
    for (const layer of this.data.layers) {
      const position = svg("g", { transform: `translate(${layer.position.join(" ")})` });
      const motion = svg("g", { "data-layer": layer.name });
      motion.style.transformOrigin = "0 0";
      motion.style.transformBox = "view-box";
      motion.style.transform = layer.transform;
      const anchor = svg("g", { transform: `translate(${-layer.anchor[0]} ${-layer.anchor[1]})` });
      for (const node of layer.shapes) anchor.appendChild(shape(node));
      motion.appendChild(anchor);
      position.appendChild(motion);
      this.drawing.appendChild(position);
      if (layer.keyframes) {
        const animation = motion.animate(layer.keyframes, {
          duration: this.data.duration, iterations: Infinity, fill: "both",
        });
        animation.pause();
        animation.currentTime = 0;
        this.animations.push(animation);
      }
    }
    this.surface = svg("svg", {
      viewBox: "0 0 32 32", class: "zen-theme-appearance-surface", "aria-hidden": "true",
    });
    const clipID = `${button.id}-appearance-clip`;
    const defs = svg("defs"), clip = svg("clipPath", { id: clipID });
    clip.appendChild(svg("path", { d: BUTTON_OUTLINE }));
    defs.appendChild(clip);
    const selected = svg("path", { d: BUTTON_OUTLINE, class: "zen-theme-appearance-selection" });
    const clipped = svg("g", { "clip-path": `url(#${clipID})` });
    const hovered = svg("g", { class: "zen-theme-appearance-hover" });
    hovered.appendChild(svg("rect", { width: 32, height: 32, class: "zen-theme-appearance-hover-background" }));
    this.pressDrawing = svg("g");
    this.pressDrawing.appendChild(this.drawing);
    hovered.appendChild(this.pressDrawing);
    clipped.appendChild(hovered);
    this.surface.append(defs, selected, clipped);
    button.appendChild(this.surface);
    button.setAttribute("zen-animated-appearance", "true");
    button.setAttribute("aria-pressed", "false");
    this.enter = event => { if (this.trackingPointer && (event.buttons & 1)) this.setPressed(true); };
    this.leave = () => this.setPressed(false);
    this.down = event => {
      if (event.button === 0) { this.trackingPointer = true; this.setPressed(true); }
    };
    this.up = () => { this.trackingPointer = false; this.setPressed(false); };
    this.keyDown = event => { if (event.key === " " || event.key === "Enter") this.setPressed(true); };
    this.keyUp = event => { if (event.key === " " || event.key === "Enter") this.setPressed(false); };
    this.prepare = event => {
      if (event.target !== panel) return;
      // Arc creates a new NSPopover and SpaceStyleEditorViewController on
      // each presentation. Preserve frames only within that presentation.
      this.finishingCycle = false;
      this.resetPress();
      for (const animation of this.animations) {
        animation.pause();
        animation.effect.updateTiming({ iterations: Infinity });
        animation.currentTime = 0;
      }
      this.open = true;
      this.update();
    };
    this.show = event => {
      if (event.target !== panel) return;
      this.open = true;
      this.update();
    };
    this.hide = event => {
      if (event.target !== panel) return;
      this.open = false;
      this.resetPress();
      this.update();
    };
    this.changed = () => { this.resetPress(); this.update(); };
    this.unload = () => this.destroy();
    button.addEventListener("pointerenter", this.enter);
    button.addEventListener("pointerleave", this.leave);
    button.addEventListener("pointerdown", this.down);
    button.addEventListener("keydown", this.keyDown);
    button.addEventListener("keyup", this.keyUp);
    button.addEventListener("blur", this.up);
    this.window.addEventListener("pointerup", this.up, true);
    this.window.addEventListener("pointercancel", this.up, true);
    panel.addEventListener("popupshowing", this.prepare);
    panel.addEventListener("popupshown", this.show);
    panel.addEventListener("popuphidden", this.hide);
    this.document.addEventListener("visibilitychange", this.changed);
    this.motionPreference.addEventListener("change", this.changed);
    this.window.addEventListener("unload", this.unload, { once: true });
  }

  setSelected(selected) {
    if (this.selected === selected) return;
    this.selected = selected;
    this.button.setAttribute("aria-pressed", String(selected));
    // Native ViewState.isLight/isDark/isAutomatic drives both the persistent
    // background and !isPaused. Hover never starts or stops the icon animation.
    const first = this.animations[0];
    this.finishingCycle = !selected && this.name !== "sun" &&
      first.currentTime > 0 && first.playState !== "finished";
    if (this.finishingCycle) {
      const cycles = Math.floor(first.currentTime / this.data.duration) + 1;
      for (const animation of this.animations) animation.effect.updateTiming({ iterations: cycles });
    }
    this.update();
  }

  update() {
    if (!this.open || this.document.hidden || this.motionPreference.matches) {
      // Preserve "finished": pausing a completed animation and playing it
      // after restoring visibility would animate an unselected appearance.
      for (const animation of this.animations) {
        if (animation.playState === "running") animation.pause();
      }
      return;
    }
    if (this.selected) {
      if (this.animations.every(a => a.playState === "running" && a.effect.getTiming().iterations === Infinity)) return;
      // Share one timeline origin: the delayed stars must not drift apart
      // when reselected while a previous cycle is finishing.
      const first = this.animations[0];
      const time = first.playState === "finished" ? 0 : first.currentTime ?? 0;
      const origin = this.document.timeline.currentTime - time;
      for (const animation of this.animations) {
        animation.effect.updateTiming({ iterations: Infinity });
        animation.currentTime = time;
        animation.play();
        animation.startTime = origin;
      }
    } else if (this.finishingCycle) {
      // An unselected star finishes the current cycle, even after many loops.
      for (const animation of this.animations) {
        if (animation.playState === "paused") animation.play();
      }
    } else {
      for (const animation of this.animations) animation.pause();
    }
  }

  setPressed(pressed) {
    pressed = pressed && this.open && !this.button.disabled;
    if (this.pressed === pressed) return;
    this.pressed = pressed;
    if (this.motionPreference.matches) {
      this.resetPress();
      this.pressed = pressed;
      this.pressDrawing.setAttribute("transform", `translate(16 16) scale(${pressed ? .9 : 1}) translate(-16 -16)`);
      return;
    }
    this.pressSpring.write(Number(pressed), this.window.performance.now() / 1000);
    if (this.pressFrame === null) this.pressFrame = this.window.requestAnimationFrame(() => this.tickPress());
  }

  tickPress() {
    this.pressFrame = null;
    const scale = 1 - .1 * this.pressSpring.sample(this.window.performance.now() / 1000);
    this.pressDrawing.setAttribute("transform", `translate(16 16) scale(${scale}) translate(-16 -16)`);
    if (this.pressSpring.active) this.pressFrame = this.window.requestAnimationFrame(() => this.tickPress());
  }

  resetPress() {
    if (this.pressFrame !== null) this.window.cancelAnimationFrame(this.pressFrame);
    this.pressFrame = null;
    this.pressed = false;
    this.trackingPointer = false;
    this.pressSpring.active = false;
    this.pressSpring.target = this.pressSpring.base = 0;
    this.pressDrawing.removeAttribute("transform");
  }

  destroy() {
    this.resetPress();
    for (const animation of this.animations) animation.cancel();
    this.button.removeEventListener("pointerenter", this.enter);
    this.button.removeEventListener("pointerleave", this.leave);
    this.button.removeEventListener("pointerdown", this.down);
    this.button.removeEventListener("keydown", this.keyDown);
    this.button.removeEventListener("keyup", this.keyUp);
    this.button.removeEventListener("blur", this.up);
    this.window.removeEventListener("pointerup", this.up, true);
    this.window.removeEventListener("pointercancel", this.up, true);
    this.panel.removeEventListener("popupshowing", this.prepare);
    this.panel.removeEventListener("popupshown", this.show);
    this.panel.removeEventListener("popuphidden", this.hide);
    this.document.removeEventListener("visibilitychange", this.changed);
    this.motionPreference.removeEventListener("change", this.changed);
    this.window.removeEventListener("unload", this.unload);
    this.surface.remove();
    this.button.removeAttribute("zen-animated-appearance");
    this.button.removeAttribute("aria-pressed");
  }
}
