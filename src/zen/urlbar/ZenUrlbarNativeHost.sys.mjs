/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A native sidebar surface sits above the main window's web-rendered chrome.
// Its expanded address bar therefore needs a native popup of its own. Keep the
// existing navbar and editor: replacing either loses selection and undo state.
import { createNativeCommandSurface } from "resource:///modules/zen/ZenNativeTheme.sys.mjs";

const HOST_CSS = `
#zen-native-urlbar-layout {
  position: fixed !important;
  display: block !important;
  visibility: hidden !important;
  pointer-events: none !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  height: 0 !important;
  min-height: 0 !important;
}
#zen-native-urlbar-panel {
  appearance: none !important;
  background: transparent !important;
  border: 0 !important;
  padding: 0 !important;
  margin: 0 !important;
  min-width: 0 !important;
  max-width: none !important;
  --panel-background: transparent;
  --panel-border-color: transparent;
  -moz-window-shadow: none !important;
}
@media (-moz-platform: macos) {
  #zen-native-urlbar-panel {
    border-radius: var(--zen-native-urlbar-radius) !important;
    -moz-window-shadow: auto !important;
  }
  #zen-native-urlbar-panel #urlbar .urlbar-background {
    /* A CSS shadow is clipped by the native popup's bounds and leaves gray
     * wedges outside the rounded corners. AppKit paints it outside the window. */
    box-shadow: none !important;
  }
}
#zen-native-urlbar-panel::part(content) {
  max-width: none !important;
  min-width: var(--zen-native-urlbar-width) !important;
  overflow: visible !important;
  margin: 0 !important;
  padding: var(--zen-native-urlbar-inset-top, 0px) 0 0
    var(--zen-native-urlbar-inset-left, 0px) !important;
  background: transparent !important;
  border: 0 !important;
}
#zen-native-urlbar-panel :is(#nav-bar, #nav-bar-customization-target, #urlbar-container) {
  display: block !important;
  width: var(--zen-native-urlbar-width) !important;
  min-width: 0 !important;
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  visibility: visible !important;
}
#zen-native-urlbar-panel #nav-bar-customization-target > :not(#urlbar-container),
#zen-native-urlbar-panel #nav-bar > :not(#nav-bar-customization-target),
#zen-native-urlbar-panel #urlbar-container::before,
#zen-native-urlbar-panel #urlbar-container::after {
  display: none !important;
}
#main-window #zen-native-urlbar-panel #urlbar {
  flex: none !important;
  display: block !important;
  position: relative !important;
  left: 0 !important;
  top: 0 !important;
  translate: none !important;
  /* Keep the search-mode scale pulse; only its layout translation changes. */
  margin: 0 !important;
  width: var(--zen-native-urlbar-width) !important;
  max-width: var(--zen-native-urlbar-width) !important;
  min-width: 0 !important;
}
#main-window #mainPopupSet #zen-native-urlbar-panel[native-command-fills] #urlbar {
  & .urlbar-background,
  & #urlbar-results .urlbarView-row:is([selected], :hover),
  &[zen-site-search] #urlbar-search-mode-indicator {
    background: transparent !important;
  }
  &[zen-site-search] #urlbar-search-mode-indicator { box-shadow: none !important; }
  & .urlbar-background { backdrop-filter: none !important; }
}
#zen-native-urlbar-panel[native-command-border] #urlbar .urlbar-background {
  outline: none !important;
}
/* While the editor is hosted in its native popup, its sidebar slot keeps the
 * resting address bar: Arc leaves the current domain in place while the
 * command bar floats. Geometry and type match the resting #urlbar. */
#zen-native-urlbar-anchor {
  display: flex !important;
  align-items: center !important;
  box-sizing: border-box !important;
  padding: 0.5px 2px !important;
}
#zen-native-urlbar-ghost {
  flex: 1 !important;
  min-width: 0 !important;
  height: 36px !important;
  box-sizing: border-box !important;
  display: flex !important;
  align-items: center !important;
  padding-inline: 12.7px 8px !important;
  border-radius: calc(var(--border-radius-medium) * var(--zen-squircle-value, 1)) !important;
  background: var(--zen-toolbar-element-bg) !important;
  color: color-mix(in srgb, var(--input-color, var(--toolbox-textcolor, FieldText)) 70%, transparent) !important;
  font: 400 13px -apple-system, system-ui, sans-serif !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  pointer-events: none !important;
}
/* A page without a web address rests on the search icon and the address
 * bar's placeholder: the icon 16 px, 8 px in, in the Space text colour at
 * 40 %; the placeholder 32.2 px in. */
#zen-native-urlbar-ghost[placeholder] {
  position: relative !important;
  padding-inline-start: 32.2px !important;
}
#zen-native-urlbar-ghost[placeholder]::before {
  content: "" !important;
  position: absolute !important;
  inset-inline-start: 8px !important;
  top: 10px !important;
  width: 16px !important;
  height: 16px !important;
  background-color: rgb(from var(--toolbox-textcolor, FieldText) r g b / 0.4) !important;
  mask: var(--zen-native-urlbar-ghost-icon, url("chrome://global/skin/icons/search-glass.svg")) center / contain no-repeat !important;
}`;

export class ZenUrlbarNativeHost {
  #window;
  #anchor;
  #ghost;
  #sheet;
  #style;
  #layout;
  #layoutFrame = 0;
  #attributes;
  #surface;
  #paintAttributes;
  #paintSize;
  #paintFrame = 0;
  #contrast;
  #open = false;
  #disposed = false;

  constructor(window) {
    this.#window = window;
    this.urlbar = window.gURLBar;
    const document = window.document;
    this.panel = document.createXULElement("panel");
    this.panel.id = "zen-native-urlbar-panel";
    for (const name of ["noautofocus", "noautohide", "ignorekeys"]) {
      this.panel.setAttribute(name, "true");
    }
    this.panel.setAttribute("consumeoutsideclicks", "false");
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-label", "Search or Enter URL");
    this.panel.addEventListener("popupshown", this);
    this.panel.addEventListener("popuphidden", this);
    document.getElementById("mainPopupSet").append(this.panel);
    this.#anchor = document.createXULElement("hbox");
    this.#anchor.id = "zen-native-urlbar-anchor";
    this.#anchor.setAttribute("aria-hidden", "true");
    this.#ghost = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    this.#ghost.id = "zen-native-urlbar-ghost";
    this.#anchor.append(this.#ghost);
    // Panel shadow parts need a document sheet. The user sheet also keeps the
    // hosted navbar geometry ahead of the sidebar's existing userChrome rules.
    this.#style = document.createElementNS("http://www.w3.org/1999/xhtml", "style");
    this.#style.textContent = HOST_CSS;
    document.documentElement.append(this.#style);
    this.#layout = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    this.#layout.id = "zen-native-urlbar-layout";
    this.#layout.setAttribute("aria-hidden", "true");
    this.#layout.inert = true;
    document.getElementById("mainPopupSet").append(this.#layout);
    this.#sheet = "data:text/css;charset=utf-8," + encodeURIComponent(HOST_CSS);
    window.windowUtils.loadSheetUsingURIString(
      this.#sheet,
      window.windowUtils.USER_SHEET
    );
    window.addEventListener("unload", this, { once: true });
    window.addEventListener("resize", this);
    this.#attributes = new window.MutationObserver(() => this.#queueLayout());
    this.#attributes.observe(this.urlbar, {
      attributes: true,
      attributeFilter: ["style", "zen-floating-urlbar", "zen-arc-url-editor"],
    });
    this.#paintAttributes = new window.MutationObserver(() => this.#queuePaint());
    this.#paintSize = new window.ResizeObserver(() => this.#queuePaint());
    this.#contrast = window.matchMedia("(forced-colors: active), (prefers-contrast: more), (prefers-reduced-transparency: reduce)");
    this.#contrast.addEventListener("change", this);
    for (const type of ["ZenNativeThemeReady", "ZenNativeThemeChanged", "ZenWorkspacesUIUpdate"])
      window.addEventListener(type, this);
    createNativeCommandSurface(window).then(surface => {
      if (this.#disposed) { surface?.clear(); return; }
      this.#surface = surface;
      this.#queuePaint();
    }).catch(() => {});
  }

  // The text the resting sidebar address bar shows for the selected page: the
  // host alone with zen.urlbar.show-domain-only-in-sidebar (Zen's trimURL),
  // otherwise the trimmed address. Empty for pages without a web address.
  #restingLabel() {
    const window = this.#window;
    try {
      const uri = Services.io.createExposableURI(
        window.gBrowser.selectedBrowser.currentURI
      );
      if (!uri.schemeIs("http") && !uri.schemeIs("https")) {
        return "";
      }
      if (Services.prefs.getBoolPref("zen.urlbar.show-domain-only-in-sidebar", false)) {
        return uri.displayHost.replace(/^www\./, "");
      }
      return window.BrowserUIUtils?.trimURL(uri.displaySpec) ?? uri.displaySpec;
    } catch {
      return "";
    }
  }

  get isOpen() {
    return this.#open;
  }

  get canAnimateScope() {
    return this.canPaintColors && this.#surface?.splash === true;
  }

  get canAnimateScopeExit() {
    return this.canPaintColors && this.#surface?.transition === true;
  }

  get canPaintColors() {
    return !this.#disposed && this.#surface?.eligible() === true;
  }

  open() {
    if (this.#disposed || this.#open) {
      return this.#open;
    }
    const window = this.#window;
    const navbar = this.urlbar.closest("#nav-bar");
    if (!navbar || !this.urlbar.matches(":popover-open")) {
      return false;
    }

    // Measure the normal top-layer layout after all URL bar open attributes
    // have been set. The native popup uses those exact CSS coordinates.
    const rect = this.urlbar.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    const original = navbar.getBoundingClientRect();
    const inherited = window.getComputedStyle(navbar);
    this.panel.style.setProperty(
      "--zen-native-urlbar-radius",
      window.getComputedStyle(this.urlbar).borderRadius
    );
    for (const name of ["--zen-min-toolbox-padding", "--zen-toolbox-padding"]) {
      this.panel.style.setProperty(name, inherited.getPropertyValue(name));
    }
    this.#anchor.style.width = `${original.width}px`;
    this.#anchor.style.height = `${original.height}px`;
    const label = this.#restingLabel();
    this.#ghost.toggleAttribute("placeholder", !label);
    this.#ghost.textContent = label || this.urlbar.inputField?.placeholder || "";
    navbar.before(this.#anchor);
    const { x, y } = this.#setPlacement(rect);

    this.#open = true;
    try {
      this.urlbar.hidePopover();
      this.urlbar.moveToolbarForNativePopover(this.panel);
      this.panel.openPopupAtScreen(x, y, false);
      this.#observeOpen();
    } catch (error) {
      this.hide();
      this.urlbar.showPopover();
      throw error;
    }
    return true;
  }

  // Hosts the editor before its open state is applied. `apply` sets that state
  // (breakout, floating and editor attributes) after the navbar has moved, so
  // the editor is styled once, inside the closed popup, instead of first in
  // the sidebar's top layer. Geometry comes from the layout twin, which shares
  // the command/editor rules without the editor (same box: x, y and width match
  // the in-place measurement). Returns false, with the navbar back in its slot
  // and `apply` possibly run, when hosting is not possible; the caller then
  // opens in place.
  openHosted(apply) {
    if (this.#disposed || this.#open) {
      return this.#open;
    }
    const window = this.#window;
    const navbar = this.urlbar.closest("#nav-bar");
    if (!navbar || !this.#layout.isConnected) {
      return false;
    }
    // Resting geometry, before anything about the editor changes.
    const original = navbar.getBoundingClientRect();
    if (original.width <= 0 || original.height <= 0) {
      return false;
    }
    const inherited = window.getComputedStyle(navbar);
    for (const name of ["--zen-min-toolbox-padding", "--zen-toolbox-padding"]) {
      this.panel.style.setProperty(name, inherited.getPropertyValue(name));
    }
    this.#anchor.style.width = `${original.width}px`;
    this.#anchor.style.height = `${original.height}px`;
    const label = this.#restingLabel();
    this.#ghost.toggleAttribute("placeholder", !label);
    this.#ghost.textContent = label || this.urlbar.inputField?.placeholder || "";
    navbar.before(this.#anchor);

    this.#open = true;
    try {
      this.urlbar.moveToolbarForNativePopover(this.panel);
      apply();
      this.#copyLayoutState();
      // The popup always presents the open command bar; the view may set
      // [open] on the editor only after this. The twin is zero-height by
      // design (HOST_CSS), so only its position and width are meaningful.
      this.#layout.setAttribute("open", "");
      const rect = this.#layout.getBoundingClientRect();
      const supported = window.getComputedStyle(this.#layout)
        .getPropertyValue("--arc-command-bar-width").trim();
      if (!supported || rect.width <= 0) {
        throw new Error("no command bar geometry");
      }
      this.panel.style.setProperty(
        "--zen-native-urlbar-radius",
        window.getComputedStyle(this.urlbar).borderRadius
      );
      const { x, y } = this.#setPlacement(rect);
      this.panel.openPopupAtScreen(x, y, false);
      this.#observeOpen();
    } catch (error) {
      this.hide();
      if (error?.message !== "no command bar geometry") {
        throw error;
      }
      return false;
    }
    return true;
  }

  #copyLayoutState() {
    for (const name of ["open", "breakout-extend", "zen-floating-urlbar", "zen-arc-url-editor"]) {
      if (this.urlbar.hasAttribute(name)) {
        this.#layout.setAttribute(name, this.urlbar.getAttribute(name));
      } else {
        this.#layout.removeAttribute(name);
      }
    }
    for (const name of ["--arc-url-editor-left", "--arc-url-editor-top"]) {
      this.#layout.style.setProperty(name, this.urlbar.style.getPropertyValue(name));
    }
  }

  #observeOpen() {
    const window = this.#window;
    this.#paintAttributes.observe(this.urlbar, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["style", "selected", "stale", "hidden", "zen-site-search", "zen-site-search-flash", "zen-site-search-bounce"] });
    this.#paintAttributes.observe(window.document.documentElement, { attributes: true,
      attributeFilter: ["style", "zen-has-empty-tab", "zen-should-be-dark-mode", "privatebrowsingmode"] });
    this.#paintSize.observe(this.urlbar);
    for (const type of ["pointerover", "pointerout", "scroll"])
      this.urlbar.addEventListener(type, this, { capture: true, passive: true });
  }

  hide() {
    this.#open = false;
    this.#paintAttributes.disconnect();
    this.#paintSize.disconnect();
    this.#window.cancelAnimationFrame(this.#paintFrame);
    this.#paintFrame = 0;
    this.panel.removeAttribute("native-command-fills");
    this.panel.removeAttribute("native-command-border");
    this.#surface?.clear();
    for (const type of ["pointerover", "pointerout", "scroll"])
      this.urlbar.removeEventListener(type, this, { capture: true });
    if (this.#layoutFrame) {
      this.#window.cancelAnimationFrame(this.#layoutFrame);
      this.#layoutFrame = 0;
    }
    this.panel.hidePopup();
    if (this.#anchor.parentNode) {
      this.urlbar.moveToolbarForNativePopover(this.#anchor.parentNode, this.#anchor);
      this.#anchor.remove();
    }
  }

  // Layout changes move the return position while the live editor stays in its
  // popup. Reparenting the navbar itself would reset its editing transaction.
  moveAnchor(parent, before = null) {
    if (!this.#open || !this.#anchor.isConnected) return false;
    parent.moveBefore(this.#anchor, before);
    return true;
  }

  #setPlacement(rect) {
    const x = this.#window.mozInnerScreenX + rect.x;
    const y = this.#window.mozInnerScreenY + rect.y;
    this.panel.style.setProperty("--zen-native-urlbar-width", `${rect.width}px`);
    this.panel.style.setProperty("--zen-native-urlbar-inset-left", `${x - Math.floor(x)}px`);
    this.panel.style.setProperty("--zen-native-urlbar-inset-top", `${y - Math.floor(y)}px`);
    return { x: Math.floor(x), y: Math.floor(y) };
  }

  #queueLayout() {
    if (this.#disposed || !this.#open || this.#layoutFrame) {
      return;
    }
    this.#layoutFrame = this.#window.requestAnimationFrame(() => {
      this.#layoutFrame = 0;
      this.#copyLayoutState();
      // The layout box shares the normal command/editor geometry rules. It has
      // no input and no native host overrides, so measuring it preserves undo.
      const rect = this.#layout.getBoundingClientRect();
      const supported = this.#window.getComputedStyle(this.#layout)
        .getPropertyValue("--arc-command-bar-width").trim();
      if (supported && rect.width > 0) {
        const { x, y } = this.#setPlacement(rect);
        this.panel.moveTo(x, y);
        this.#queuePaint();
      }
    });
  }

  #queuePaint() {
    if (this.#disposed || !this.#open || this.#paintFrame) return;
    this.#paintFrame = this.#window.requestAnimationFrame(() => {
      this.#paintFrame = 0;
      const painted = this.#surface?.sync(this.panel) === true;
      this.panel.toggleAttribute("native-command-fills", painted);
      this.panel.toggleAttribute("native-command-border", painted && this.#surface?.border === true);
      if (this.urlbar.getAnimations().some(animation => animation.playState === "running" || animation.pending))
        this.#queuePaint();
    });
  }

  handleEvent(event) {
    if (event.type === "unload") {
      this.destroy();
      return;
    }
    if (event.type === "resize") {
      this.#queueLayout();
      return;
    }
    if (["pointerover", "pointerout", "scroll", "change", "ZenNativeThemeReady",
      "ZenNativeThemeChanged", "ZenWorkspacesUIUpdate"].includes(event.type)) {
      this.#queuePaint();
      return;
    }
    if (event.target !== this.panel) {
      return;
    }
    if (event.type === "popupshown" && this.#open) {
      this.urlbar.inputField.focus();
      this.#queuePaint();
    } else if (event.type === "popuphidden" && this.#open) {
      this.hide();
      this.urlbar.view.close();
      this.#window.gBrowser.selectedBrowser.focus();
    }
  }

  destroy() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.urlbar.view.close();
    this.hide();
    this.#window.removeEventListener("unload", this);
    this.#window.removeEventListener("resize", this);
    this.#attributes.disconnect();
    this.#contrast.removeEventListener("change", this);
    for (const type of ["ZenNativeThemeReady", "ZenNativeThemeChanged", "ZenWorkspacesUIUpdate"])
      this.#window.removeEventListener(type, this);
    this.panel.removeEventListener("popupshown", this);
    this.panel.removeEventListener("popuphidden", this);
    this.panel.remove();
    this.#style.remove();
    this.#layout.remove();
    this.#window.windowUtils.removeSheetUsingURIString(
      this.#sheet,
      this.#window.windowUtils.USER_SHEET
    );
  }
}
