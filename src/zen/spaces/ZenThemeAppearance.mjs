/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { THEME_APPEARANCE } from "./ZenThemeAppearanceData.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Arc's LoopingToggleView: a paused sun, and stars that finish their cycle. */
export class ThemeAppearanceIcon {
  constructor(button, name, panel) {
    this.button = button;
    this.panel = panel;
    this.name = name;
    this.document = button.ownerDocument;
    this.window = this.document.defaultView;
    this.data = THEME_APPEARANCE[name];
    this.hovered = false;
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
    button.appendChild(this.drawing);
    button.setAttribute("zen-animated-appearance", "true");
    this.enter = () => { this.hovered = true; this.update(); };
    this.leave = () => { this.hovered = false; this.update(); };
    this.show = event => {
      if (event.target !== panel) return;
      this.open = true;
      this.hovered = button.matches(":hover");
      this.update();
    };
    this.hide = event => {
      if (event.target !== panel) return;
      this.open = false;
      this.hovered = false;
      this.update();
    };
    this.changed = () => this.update();
    this.unload = () => this.destroy();
    button.addEventListener("pointerenter", this.enter);
    button.addEventListener("pointerleave", this.leave);
    panel.addEventListener("popupshown", this.show);
    panel.addEventListener("popuphidden", this.hide);
    this.document.addEventListener("visibilitychange", this.changed);
    this.motionPreference.addEventListener("change", this.changed);
    this.window.addEventListener("unload", this.unload, { once: true });
  }

  update() {
    if (!this.open || this.document.hidden || this.motionPreference.matches) {
      for (const animation of this.animations) animation.pause();
      return;
    }
    if (this.hovered) {
      // Share one timeline origin: the delayed stars must not drift apart
      // when a pointer re-enters while a previous cycle is finishing.
      const first = this.animations[0];
      const time = first.playState === "finished" ? 0 : first.currentTime ?? 0;
      const origin = this.document.timeline.currentTime - time;
      for (const animation of this.animations) {
        animation.effect.updateTiming({ iterations: Infinity });
        animation.currentTime = time;
        animation.play();
        animation.startTime = origin;
      }
    } else if (this.name === "sun") {
      for (const animation of this.animations) animation.pause();
    } else if (this.animations[0].playState === "running") {
      // playOnce after a hover means finish this cycle, even after many loops.
      const cycles = Math.floor((this.animations[0].currentTime ?? 0) / this.data.duration) + 1;
      for (const animation of this.animations) animation.effect.updateTiming({ iterations: cycles });
    }
  }

  destroy() {
    for (const animation of this.animations) animation.cancel();
    this.button.removeEventListener("pointerenter", this.enter);
    this.button.removeEventListener("pointerleave", this.leave);
    this.panel.removeEventListener("popupshown", this.show);
    this.panel.removeEventListener("popuphidden", this.hide);
    this.document.removeEventListener("visibilitychange", this.changed);
    this.motionPreference.removeEventListener("change", this.changed);
    this.window.removeEventListener("unload", this.unload);
    this.drawing.remove();
    this.button.removeAttribute("zen-animated-appearance");
  }
}
