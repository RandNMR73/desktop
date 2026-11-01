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
#zen-native-sidebar-layout {
  display: flex; flex-direction: column; box-sizing: border-box;
  min-width: var(--zen-toolbox-min-width); flex: none;
  visibility: hidden !important; pointer-events: none !important;
}
#zen-native-sidebar-titlebar-layout {
  display: flex; flex: 1; min-height: 0; box-sizing: border-box;
  visibility: hidden !important; pointer-events: none !important;
}
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
}
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

  async #refresh() {
    const generation = ++this.#generation;
    this.#window.cancelAnimationFrame(this.#paintFrame);
    this.#paintFrame = 0;
    if (!this.#wanted()) { this.#failed = false; this.#hide(); return; }
    if (!this.#eligible()) { this.#hide(); return; }
    const surface = this.#surface ?? await this.#surfacePromise;
    if (generation !== this.#generation || this.#disposed || !surface || this.#failed) return;
    if (!this.#eligible() || !this.#wanted()) { this.#hide(); return; }

    if (!this.#hosted) {
      // Keep the current editor and the finite CSS reveal animation in place.
      if (this.#window.gURLBar.view.isOpen) return;
      if (this.#toolbox.getAnimations().some(animation => animation.playState === "running" || animation.pending)) {
        this.#queue(); return;
      }
      this.#copyLayout();
      this.#toolbox.before(this.#layout);
      const inherited = this.#window.getComputedStyle(this.#toolbox);
      for (const name of ["--zen-toolbox-padding", "--zen-min-toolbox-padding"])
        this.panel.style.setProperty(name, inherited.getPropertyValue(name));
      this.#placement();
      this.#hosted = true;
      this.#moveToolbox(this.panel);
      const rect = this.#layoutTitlebar.getBoundingClientRect();
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
        if (status === 1 && surface.activate(ticket) === 0) {
          this.panel.setAttribute("native-ready", "");
          return;
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
    for (const [name, value] of Object.entries({
      "--zen-native-sidebar-width": rect.width, "--zen-native-sidebar-height": rect.height,
      "--zen-native-toolbox-width": box.width, "--zen-native-toolbox-height": box.height,
      "--zen-native-toolbox-left": box.x - rect.x, "--zen-native-toolbox-top": box.y - rect.y,
    })) {
      const css = `${value}px`;
      if (this.panel.style.getPropertyValue(name) !== css) this.panel.style.setProperty(name, css);
    }
    if (this.#hosted && this.panel.state === "open")
      this.panel.moveTo(this.#window.mozInnerScreenX + rect.x, this.#window.mozInnerScreenY + rect.y);
  }

  #fallback() { this.#failed = true; this.#hide(); }

  #hide() {
    ++this.#generation;
    this.#window.cancelAnimationFrame(this.#paintFrame);
    this.#paintFrame = 0;
    this.panel.removeAttribute("native-ready");
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
    this.#window.windowUtils.removeSheetUsingURIString(this.#sheet, this.#window.windowUtils.USER_SHEET);
  }
}
