/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A native sidebar surface sits above the main window's web-rendered chrome.
// Its expanded address bar therefore needs a native popup of its own. Keep the
// existing navbar and editor: replacing either loses selection and undo state.
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
  transform: none !important;
  margin: 0 !important;
  width: var(--zen-native-urlbar-width) !important;
  max-width: var(--zen-native-urlbar-width) !important;
  min-width: 0 !important;
}`;

export class ZenUrlbarNativeHost {
  #window;
  #anchor;
  #sheet;
  #style;
  #layout;
  #layoutFrame = 0;
  #attributes;
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
    this.#anchor = document.createXULElement("spacer");
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
  }

  get isOpen() {
    return this.#open;
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
    navbar.before(this.#anchor);
    const { x, y } = this.#setPlacement(rect);

    this.#open = true;
    try {
      this.urlbar.hidePopover();
      this.urlbar.moveToolbarForNativePopover(this.panel);
      this.panel.openPopupAtScreen(x, y, false);
    } catch (error) {
      this.hide();
      this.urlbar.showPopover();
      throw error;
    }
    return true;
  }

  hide() {
    this.#open = false;
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
      // The layout box shares the normal command/editor geometry rules. It has
      // no input and no native host overrides, so measuring it preserves undo.
      const rect = this.#layout.getBoundingClientRect();
      const supported = this.#window.getComputedStyle(this.#layout)
        .getPropertyValue("--arc-command-bar-width").trim();
      if (supported && rect.width > 0) {
        const { x, y } = this.#setPlacement(rect);
        this.panel.moveTo(x, y);
      }
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
    if (event.target !== this.panel) {
      return;
    }
    if (event.type === "popupshown" && this.#open) {
      this.urlbar.inputField.focus();
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
