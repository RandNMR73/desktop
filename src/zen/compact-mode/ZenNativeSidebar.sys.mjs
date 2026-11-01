/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createNativeSidebarSurface } from "resource:///modules/zen/ZenNativeTheme.sys.mjs";
import { ZenUrlbarNativeHost } from "resource:///modules/ZenUrlbarNativeHost.sys.mjs";

const SHOW_ATTRIBUTES = ["zen-has-hover", "zen-user-show", "zen-has-empty-tab",
  "flash-popup", "has-popup-menu", "movingtab", "zen-compact-mode-active"];
const ROOT_ATTRIBUTES = ["zen-compact-mode", "zen-compact-animating", "zen-single-toolbar",
  "zen-sidebar-expanded", "zen-right-side", "zen-no-padding", "customizing", "inDOMFullscreen",
  "supress-primary-adjustment", "zen-renaming-tab", "zen-native-theme", "style"];
const EVENTS = ["resize", "sizemodechange", "fullscreen", "activate", "ZenCompactMode:LayoutUpdate",
  "ZenCompactMode:Toggled", "ZenWorkspaceDataChanged", "ZenWorkspacesUIUpdate", "ZenNativeThemeChanged"];
const CSS = `
:root[zen-native-sidebar-slide][zen-compact-mode="true"] #navigator-toolbox {
  opacity: 0 !important; transition: none !important;
}
:root[zen-native-sidebar-slide] #zen-native-sidebar-layout {
  translate: none !important; transition: none !important;
}
:root[zen-compact-mode="true"][zen-single-toolbar="true"][zen-sidebar-expanded="true"]
  :is(#navigator-toolbox, #zen-native-sidebar-layout) {
  /* Arc's floating frame is inset 5pt on each outer edge. The shared compact
     layout uses half this value for the inset and the full value for height. */
  --zen-compact-float: 10px !important;
}
#zen-native-sidebar-layout {
  display: flex; flex-direction: column; box-sizing: border-box;
  min-width: var(--zen-toolbox-min-width); flex: none;
  visibility: hidden !important; pointer-events: none !important;
}
#zen-native-sidebar-titlebar-layout {
  display: flex; flex: 1; min-height: 0; box-sizing: border-box;
  visibility: hidden !important; pointer-events: none !important;
}
#zen-native-sidebar-layout[native-pinning] {
  position: relative !important; inset: auto !important;
  padding: 0 !important; margin: 0 !important; min-width: 0 !important;
  max-width: none !important; translate: none !important; transition: none !important;
  order: 0 !important;
}
:root[zen-right-side="true"] #zen-native-sidebar-layout[native-pinning] { order: 10 !important; }
#zen-native-sidebar-panel {
  appearance: none !important; background: transparent !important;
  border: 0 !important; margin: 0 !important; padding: 0 !important;
  min-width: var(--zen-native-sidebar-width) !important;
  max-width: var(--zen-native-sidebar-width) !important;
  --panel-background: transparent; --panel-border-color: transparent;
  -moz-window-shadow: none !important;
}
#zen-native-sidebar-panel::part(content) {
  min-width: var(--zen-native-sidebar-width) !important;
  max-width: var(--zen-native-sidebar-width) !important;
  height: var(--zen-native-sidebar-height) !important;
  overflow: visible !important; margin: 0 !important; padding: 0 !important;
  background: transparent !important; border: 0 !important;
}
#zen-native-sidebar-panel #navigator-toolbox {
  position: relative !important;
  flex: none !important;
  left: var(--zen-native-toolbox-left) !important; top: var(--zen-native-toolbox-top) !important;
  right: auto !important; bottom: auto !important;
  width: var(--zen-native-toolbox-width) !important;
  height: var(--zen-native-toolbox-height) !important;
  translate: none !important; transform: none !important; transition: none !important;
  visibility: visible !important;
  opacity: 1 !important;
}
#zen-native-sidebar-panel[native-preparing] #navigator-toolbox { opacity: 0 !important; }
#zen-native-sidebar-panel #titlebar { visibility: visible !important; }
#zen-native-sidebar-panel[native-ready] #zen-toolbar-background { visibility: hidden !important; }
#zen-native-sidebar-panel[native-ready] :is(#navigator-toolbox, #titlebar) {
  background: transparent !important; box-shadow: none !important;
}`;

// The original toolbox moves into a native popup only while compact mode's
// existing state requests it. An inert box shares the compact layout rules,
// keeping viewport geometry available without moving the live editor to measure.
export class ZenNativeSidebar {
  #window; #root; #toolbox; #layout; #layoutTitlebar; #style; #sheet;
  #surface; #surfacePromise; #attributes; #size; #urlbarHost;
  #frame = 0; #paintFrame = 0; #generation = 0; #ticket = 0;
  #hosted = false; #closing = false; #disposed = false; #failed = false;
  #pin = null;
  #slide = null;

  constructor(window) {
    this.#window = window;
    const document = window.document;
    this.#root = document.documentElement;
    this.#toolbox = document.getElementById("navigator-toolbox");
    this.panel = document.createXULElement("panel");
    this.panel.id = "zen-native-sidebar-panel";
    for (const name of ["noautofocus", "noautohide", "ignorekeys"]) this.panel.setAttribute(name, "true");
    this.panel.setAttribute("consumeoutsideclicks", "false");
    this.panel.setAttribute("role", "region");
    this.panel.setAttribute("aria-label", "Sidebar");
    this.panel.addEventListener("popuphidden", this);
    document.getElementById("mainPopupSet").append(this.panel);
    this.#layout = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    this.#layout.id = "zen-native-sidebar-layout";
    this.#layout.inert = true;
    this.#layout.setAttribute("aria-hidden", "true");
    this.#layoutTitlebar = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    this.#layoutTitlebar.id = "zen-native-sidebar-titlebar-layout";
    this.#layout.append(this.#layoutTitlebar);
    this.#style = document.createElementNS("http://www.w3.org/1999/xhtml", "style");
    this.#style.textContent = CSS;
    this.#root.append(this.#style);
    this.#sheet = "data:text/css;charset=utf-8," + encodeURIComponent(CSS);
    window.windowUtils.loadSheetUsingURIString(this.#sheet, window.windowUtils.USER_SHEET);
    this.#urlbarHost = new ZenUrlbarNativeHost(window);
    this.#attributes = new window.MutationObserver(() => this.#queue());
    this.#attributes.observe(this.#root, { attributes: true, attributeFilter: ROOT_ATTRIBUTES });
    this.#attributes.observe(this.#toolbox, { attributes: true,
      attributeFilter: [...SHOW_ATTRIBUTES, "style", "zen-right-side", "animate"] });
    this.#attributes.observe(window.gURLBar, { attributes: true,
      attributeFilter: ["open", "breakout-extend", "zen-floating-urlbar"] });
    this.#size = new window.ResizeObserver(() => this.#queue());
    this.#size.observe(this.#layout);
    for (const event of EVENTS) window.addEventListener(event, this);
    window.addEventListener("unload", this, { once: true });
    this.#surfacePromise = createNativeSidebarSurface(window).then(surface => {
      if (this.#disposed) { surface?.destroy(); return null; }
      this.#surface = surface;
      this.#queue();
      return surface;
    }).catch(() => null);
    this.#queue();
  }

  get urlbarHost() { return this.#hosted ? this.#urlbarHost : null; }
  get isOpen() { return this.#hosted; }
  get isPinning() { return !!this.#pin; }
  get isSliding() { return !!this.#slide; }
  get hasOpenEditor() { return this.#urlbarHost.isOpen; }

  moveNavbar(parent, before = null) {
    if (this.#urlbarHost.moveAnchor(parent, before)) return true;
    if (!this.#hosted) return false;
    this.#window.gURLBar.moveToolbarForNativePopover(parent, before);
    return true;
  }

  // The compact-mode manager supplies the synchronous layout commit. Keep the
  // real controls in their transparent window until both renderers finish;
  // returning them to Gecko early would put them underneath the native material.
  pin(commitLayout) {
    const window = this.#window;
    if (!this.#eligible() || !this.#hosted || this.#pin || this.#slide || !this.#surface?.canTransition ||
        !this.panel.hasAttribute("native-ready") || this.panel.state !== "open" ||
        this.#toolbox.hasAttribute("movingtab") || window.fullScreen ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        window.gURLBar.view.isOpen || this.#urlbarHost.isOpen) return null;
    const document = window.document;
    if ([...document.querySelectorAll("panel, menupopup")].some(popup =>
      popup !== this.panel && (popup.state === "open" || popup.state === "showing"))) return null;
    const page = document.getElementById("zen-tabbox-wrapper");
    const controls = ["zen-sidebar-top-buttons", "nav-bar", "TabsToolbar", "zen-sidebar-foot-buttons"]
      .map(id => document.getElementById(id));
    if (!page || controls.some(node => !node)) return null;
    const source = this.#layoutTitlebar.getBoundingClientRect();
    const width = source.width, height = window.innerHeight;
    const right = this.#root.getAttribute("zen-right-side") === "true";
    const x = right ? window.innerWidth - width : 0;
    const ticket = this.#ticket;
    const beforePage = page.getBoundingClientRect();
    const before = controls.map(node => node.getBoundingClientRect());
    let resolve;
    const result = new Promise(done => { resolve = done; });
    const state = this.#pin = { resolve, animations: [], frame: 0, preparing: true,
      width: window.innerWidth, height, right };
    ++this.#generation;
    window.cancelAnimationFrame(this.#paintFrame);
    this.#paintFrame = 0;
    let committed = false;
    try {
      this.#layout.setAttribute("native-pinning", "");
      this.#layout.style.width = `${width}px`;
      this.#root.setAttribute("zen-compact-animating", "true");
      for (const [name, value] of Object.entries({
        "--zen-native-sidebar-width": width, "--zen-native-sidebar-height": height,
        "--zen-native-toolbox-width": width, "--zen-native-toolbox-height": height,
        "--zen-native-toolbox-left": 0, "--zen-native-toolbox-top": 0,
      })) this.panel.style.setProperty(name, `${value}px`);
      this.panel.moveTo(window.mozInnerScreenX + x, window.mozInnerScreenY);
      committed = true;
      commitLayout();
      const afterPage = page.getBoundingClientRect();
      const after = controls.map(node => node.getBoundingClientRect());
      const timing = { duration: 80, easing: "cubic-bezier(.25,.46,.45,.94)", fill: "both" };
      const offsets = before.map((rect, index) => [rect.x - after[index].x, rect.y - after[index].y]);
      controls.forEach((node, index) => {
        // The footer is nested inside TabsToolbar, so subtract its parent's
        // movement rather than translating it twice.
        const parent = index === 3 ? offsets[2] : [0, 0];
        const delta = offsets[index].map((value, axis) => value - parent[axis]);
        state.animations.push(node.animate({ translate: [`${delta[0]}px ${delta[1]}px`, "0px 0px"] }, timing));
      });
      const initialWidth = Math.max(0, width - (beforePage.width - afterPage.width));
      state.animations.push(this.#layout.animate({ width: [`${initialWidth}px`, `${width}px`] }, timing));
      // Start the native transaction in the same task as the finite DOM
      // animations. No timers or rendering callbacks remain after completion.
      const started = this.#surface.startTransition([x, 0, width, height, window.innerWidth, height], ticket);
      // A layout commit can span a refresh tick. Default pending play tasks may
      // backdate to that older tick, putting the controls ahead of AppKit. Both
      // timelines use this document's time origin; explicitly start at submission.
      const startTime = window.performance.now();
      for (const animation of state.animations) animation.startTime = startTime;
      state.preparing = false;
      if (started !== 0) { this.#finishPin(); return result; }
      const deadline = window.performance.now() + 2000;
      const check = () => {
        state.frame = 0;
        if (this.#pin !== state) return;
        try {
          const status = this.#surface.transitionStatus(ticket);
          if (!this.#pinContextValid(state) || status < 0 || window.performance.now() >= deadline ||
              (status === 1 && state.animations.every(animation => animation.playState === "finished"))) {
            this.#finishPin(); return;
          }
          state.frame = window.requestAnimationFrame(check);
        } catch { this.#finishPin(); }
      };
      state.frame = window.requestAnimationFrame(check);
    } catch {
      // Once the layout has committed, failure must still leave one usable,
      // pinned toolbox. Never retry the layout callback or toggle the pref back.
      state.preparing = false;
      this.#finishPin();
      if (!committed) commitLayout();
    }
    return result;
  }

  #pinContextValid(state) {
    return !this.#disposed && !this.#window.closed && !this.#window.fullScreen &&
      !this.#window.gURLBar.view.isOpen && !this.#urlbarHost.isOpen &&
      this.#window.innerWidth === state.width && this.#window.innerHeight === state.height &&
      (this.#root.getAttribute("zen-right-side") === "true") === state.right &&
      this.#root.getAttribute("zen-compact-mode") === "false" &&
      this.#root.getAttribute("zen-single-toolbar") === "true" &&
      this.#root.getAttribute("zen-sidebar-expanded") === "true" &&
      this.#root.getAttribute("inDOMFullscreen") !== "true" &&
      !this.#root.hasAttribute("customizing") && this.#root.hasAttribute("zen-native-theme");
  }

  #finishPin() {
    const state = this.#pin;
    if (!state) return;
    this.#pin = null;
    this.#window.cancelAnimationFrame(state.frame);
    for (const animation of state.animations) animation.cancel();
    this.#layout.removeAttribute("native-pinning");
    this.#layout.style.removeProperty("width");
    this.#root.removeAttribute("zen-compact-animating");
    this.#hide();
    state.resolve(true);
  }

  #eligible() {
    return !this.#disposed && !this.#window.closed &&
      this.#root.getAttribute("zen-compact-mode") === "true" &&
      this.#root.getAttribute("zen-single-toolbar") === "true" &&
      this.#root.getAttribute("zen-sidebar-expanded") === "true" &&
      this.#root.getAttribute("inDOMFullscreen") !== "true" &&
      !this.#root.hasAttribute("customizing") && !this.#root.hasAttribute("zen-compact-animating") &&
      this.#root.getAttribute("supress-primary-adjustment") !== "true" &&
      !this.#toolbox.hasAttribute("animate") && this.#root.hasAttribute("zen-native-theme");
  }

  #wanted() {
    return SHOW_ATTRIBUTES.some(name => this.#toolbox.hasAttribute(name)) ||
      this.#root.getAttribute("zen-renaming-tab") === "true";
  }

  #queue() {
    if (this.#disposed || this.#frame) return;
    this.#frame = this.#window.requestAnimationFrame(() => {
      this.#frame = 0;
      this.#refresh().catch(() => this.#fallback());
    });
  }

  #copyLayout() {
    for (const name of [...SHOW_ATTRIBUTES, "style", "zen-right-side", "animate"]) {
      if (this.#toolbox.hasAttribute(name)) this.#layout.setAttribute(name, this.#toolbox.getAttribute(name));
      else this.#layout.removeAttribute(name);
    }
  }

  #moveToolbox(parent, before = null) {
    const bar = this.#window.gURLBar;
    if (this.#toolbox.contains(bar)) bar.moveToolbarForNativePopover(parent, before, this.#toolbox);
    else parent.moveBefore(this.#toolbox, before);
  }

  #canSlide() {
    return this.#surface?.slideDuration > 0 && this.#eligible() && !this.#failed &&
      !this.#window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      !this.#toolbox.hasAttribute("movingtab") && !this.#window.gURLBar.view.isOpen &&
      !this.#urlbarHost.isOpen;
  }

  #syncSlideOwnership() {
    if (this.#canSlide()) this.#root.setAttribute("zen-native-sidebar-slide", "");
    else this.#root.removeAttribute("zen-native-sidebar-slide");
  }

  #stopSlide() {
    const state = this.#slide;
    if (!state) return;
    this.#slide = null;
    this.#window.cancelAnimationFrame(state.frame);
    state.animation.cancel();
  }

  #slideContextValid(state) {
    return this.#canSlide() && this.#hosted && this.panel.state === "open" &&
      this.#window.innerWidth === state.rect[4] && this.#window.innerHeight === state.rect[5] &&
      (this.#root.getAttribute("zen-right-side") === "true") === state.right &&
      this.#surface.slideStatus(state.ticket) >= 0;
  }

  #startSlide(reveal) {
    if (!this.#canSlide() || !this.#hosted) return false;
    const window = this.#window;
    const titlebar = window.document.getElementById("titlebar");
    const visible = this.#layoutTitlebar.getBoundingClientRect();
    const rect = [visible.x, visible.y, visible.width, visible.height, window.innerWidth, window.innerHeight];
    const right = this.#root.getAttribute("zen-right-side") === "true";
    const hidden = right ? window.innerWidth + 10 - visible.x : -visible.width - 10 - visible.x;
    // A reversal starts from the displayed controls, matching the native
    // presentation frame used when replacing the AppKit spring.
    const from = this.#slide ? titlebar.getBoundingClientRect().x - visible.x : (reveal ? hidden : 0);
    this.#stopSlide();
    const to = reveal ? 0 : hidden;
    const duration = this.#surface.slideDuration * 1000;
    // Sample the same damped spring at 1ms intervals. These finite keyframes
    // run on the compositor and leave no timer or draw loop when settled.
    const omega = 2 * Math.PI / .18, damping = .8, frequency = omega * Math.sqrt(1 - damping ** 2);
    const count = Math.ceil(duration);
    const keyframes = Array.from({ length: count + 1 }, (_, index) => {
      const offset = index / count, time = offset * duration / 1000;
      const progress = 1 - Math.exp(-damping * omega * time) *
        (Math.cos(frequency * time) + damping * omega / frequency * Math.sin(frequency * time));
      const x = index === count ? to : from + (to - from) * progress;
      return { translate: `${x}px 0px`, offset };
    });
    const animation = titlebar.animate(keyframes, { duration, easing: "linear", fill: "both" });
    const ticket = this.#ticket;
    if (this.#surface.startSlide(rect, ticket, reveal, right) !== 0) { animation.cancel(); return false; }
    animation.startTime = window.performance.now();
    this.panel.removeAttribute("native-preparing");
    const state = this.#slide = { animation, frame: 0, rect, right, reveal, ticket };
    const deadline = window.performance.now() + 2000;
    const check = () => {
      state.frame = 0;
      if (this.#slide !== state) return;
      if (!this.#slideContextValid(state) || this.#wanted() !== reveal) { this.#queue(); return; }
      if (window.performance.now() >= deadline) { this.#fallback(); return; }
      if (this.#surface.slideStatus(ticket) === 1 && animation.playState === "finished") {
        this.#stopSlide();
        if (!reveal) this.#hide();
        return;
      }
      state.frame = window.requestAnimationFrame(check);
    };
    state.frame = window.requestAnimationFrame(check);
    return true;
  }

  async #refresh() {
    if (this.#pin) return;
    this.#syncSlideOwnership();
    if (this.#slide) {
      if (this.#slideContextValid(this.#slide)) {
        if (this.#wanted() === this.#slide.reveal) return;
        if (this.#startSlide(this.#wanted())) return;
      }
      this.#stopSlide();
    }
    const generation = ++this.#generation;
    this.#window.cancelAnimationFrame(this.#paintFrame);
    this.#paintFrame = 0;
    if (!this.#wanted()) {
      this.#failed = false;
      if (this.#hosted && this.panel.hasAttribute("native-ready") && this.#startSlide(false)) return;
      this.#hide(); this.#syncSlideOwnership(); return;
    }
    if (!this.#eligible()) { this.#hide(); return; }
    const surface = this.#surface ?? await this.#surfacePromise;
    if (generation !== this.#generation || this.#disposed || !surface || this.#failed) return;
    if (!this.#eligible() || !this.#wanted()) { this.#hide(); return; }

    const revealing = this.#canSlide() && (!this.#hosted || this.panel.hasAttribute("native-preparing"));
    if (!this.#hosted) {
      // Keep the current editor and the finite CSS reveal animation in place.
      if (this.#window.gURLBar.view.isOpen) return;
      if (!revealing && this.#toolbox.getAnimations().some(animation => animation.playState === "running" || animation.pending)) {
        this.#queue(); return;
      }
      this.#copyLayout();
      this.#toolbox.before(this.#layout);
      const inherited = this.#window.getComputedStyle(this.#toolbox);
      for (const name of ["--zen-toolbox-padding", "--zen-min-toolbox-padding"])
        this.panel.style.setProperty(name, inherited.getPropertyValue(name));
      this.#placement();
      if (revealing) this.panel.setAttribute("native-preparing", "");
      this.#hosted = true;
      this.#moveToolbox(this.panel);
      const rect = this.#popupRect();
      this.panel.openPopupAtScreen(this.#window.mozInnerScreenX + rect.x,
        this.#window.mozInnerScreenY + rect.y, false);
    }
    this.#copyLayout();
    this.#placement();
    const ticket = this.#ticket = (this.#ticket + 1) >>> 0 || 1;
    const deadline = this.#window.performance.now() + 2000;
    let submitted = false;
    const check = () => {
      this.#paintFrame = 0;
      if (this.#disposed || generation !== this.#generation || !this.#hosted) return;
      if (!this.#eligible() || !this.#wanted()) { this.#hide(); return; }
      try {
        if (!submitted) {
          const rect = this.#layoutTitlebar.getBoundingClientRect();
          submitted = surface.apply([rect.x, rect.y, rect.width, rect.height,
            this.#window.innerWidth, this.#window.innerHeight], ticket) === 0;
        }
        const status = submitted ? surface.status(ticket) : 0;
        // GPU readiness can precede the popup's first presentation. Starting
        // then would immediately fail the active-slide context check.
        if (status === 1 && this.panel.state === "open") {
          this.panel.setAttribute("native-ready", "");
          if (revealing && this.#startSlide(true)) return;
          if (surface.activate(ticket) === 0) { this.panel.removeAttribute("native-preparing"); return; }
          this.panel.removeAttribute("native-ready");
        }
        if (status < 0 || this.#window.performance.now() >= deadline) { this.#fallback(); return; }
        this.#paintFrame = this.#window.requestAnimationFrame(check);
      } catch { this.#fallback(); }
    };
    check();
  }

  #placement() {
    const box = this.#layout.getBoundingClientRect();
    const rect = this.#layoutTitlebar.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) throw new Error("Empty sidebar layout");
    const popup = this.#popupRect();
    for (const [name, value] of Object.entries({
      "--zen-native-sidebar-width": popup.width, "--zen-native-sidebar-height": rect.height,
      "--zen-native-toolbox-width": box.width, "--zen-native-toolbox-height": box.height,
      "--zen-native-toolbox-left": box.x - popup.x, "--zen-native-toolbox-top": box.y - rect.y,
    })) {
      const css = `${value}px`;
      if (this.panel.style.getPropertyValue(name) !== css) this.panel.style.setProperty(name, css);
    }
    if (this.#hosted && this.panel.state === "open")
      this.panel.moveTo(this.#window.mozInnerScreenX + popup.x, this.#window.mozInnerScreenY + popup.y);
  }

  #popupRect() {
    const rect = this.#layoutTitlebar.getBoundingClientRect();
    if (!(this.#surface?.slideDuration > 0)) return rect;
    // Include the five-point outer inset in the transparent host. Moving
    // controls then clip at the owning window edge, like the native material.
    const right = this.#root.getAttribute("zen-right-side") === "true";
    return { x: right ? rect.x : 0, y: rect.y,
      width: right ? this.#window.innerWidth - rect.x : rect.x + rect.width };
  }

  #fallback() { this.#failed = true; this.#hide(); this.#syncSlideOwnership(); }

  #hide() {
    if (this.#pin) { this.#finishPin(); return; }
    this.#stopSlide();
    ++this.#generation;
    this.#window.cancelAnimationFrame(this.#paintFrame);
    this.#paintFrame = 0;
    this.panel.removeAttribute("native-ready");
    this.panel.removeAttribute("native-preparing");
    this.#surface?.clear();
    this.#closing = true;
    this.#hosted = false;
    this.panel.hidePopup();
    if (this.#layout.isConnected) {
      this.#moveToolbox(this.#layout.parentNode, this.#layout);
      this.#layout.remove();
    }
    this.#closing = false;
  }

  handleEvent(event) {
    if (event.type === "unload") { this.destroy(); return; }
    if (event.type === "popuphidden") {
      if (event.target === this.panel && this.#hosted && !this.#closing) this.#fallback();
      return;
    }
    if (this.#pin) {
      if (!this.#pin.preparing && (event.type === "ZenNativeThemeChanged" ||
          event.type === "ZenWorkspaceDataChanged" || event.type === "ZenWorkspacesUIUpdate" ||
          !this.#pinContextValid(this.#pin))) this.#finishPin();
      return;
    }
    this.#queue();
  }

  destroy() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#urlbarHost.destroy();
    this.#hide();
    this.#surface?.destroy();
    this.#attributes.disconnect();
    this.#size.disconnect();
    this.#window.cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    for (const event of EVENTS) this.#window.removeEventListener(event, this);
    this.#window.removeEventListener("unload", this);
    this.panel.removeEventListener("popuphidden", this);
    this.panel.remove(); this.#style.remove();
    this.#root.removeAttribute("zen-native-sidebar-slide");
    this.#window.windowUtils.removeSheetUsingURIString(this.#sheet, this.#window.windowUtils.USER_SHEET);
  }
}
