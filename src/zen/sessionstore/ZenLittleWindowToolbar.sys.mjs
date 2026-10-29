// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/** Loaded only for Little windows; owns their controls and observer lifetime. */
export class ZenLittleWindowToolbar {
  #window;
  #manager;
  #target;
  #rows = new Map();
  #visibleRows = [];
  #selected = 0;
  #spaceID;
  #destroyed = false;
  #inputShown = false;
  #spaceChanged = () => this.updateDestination();
  #activate = () => this.updateDestination();
  #inputEscape = (event) => {
    if (this.#window._zenLittleWindowInput && event.key === "Escape" && !event.isComposing) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.#window.close();
    }
  };
  #urlbarToggle = (event) => {
    const bar = this.#window.gURLBar;
    if (event.target === bar && event.newState === "open" && this.#window._zenLittleWindowInput) {
      this.#inputShown = true;
    }
    if (event.target === bar && event.newState === "open" && !bar.focused) {
      // A cold query opens asynchronously. OpenLocation's initial select()
      // cannot focus the editor while the sidebar is still hidden.
      bar.focus();
    }
  };

  constructor(window, manager) {
    this.#window = window;
    this.#manager = manager;
    const d = window.document;
    window.windowUtils.loadSheetUsingURIString(
      "chrome://browser/content/zen-styles/zen-little-window.css",
      window.windowUtils.AUTHOR_SHEET,
    );
    this.toolbar = d.createElement("div");
    this.toolbar.id = "zen-little-toolbar";
    this.toolbar.setAttribute("role", "toolbar");
    this.toolbar.setAttribute("aria-label", "Little Arc");
    const controls = d.querySelector(".titlebar-buttonbox-container");
    if (controls) {
      this.originalControls = {
        node: controls,
        parent: controls.parentNode,
        next: controls.nextSibling,
      };
      this.toolbar.append(controls);
    }
    this.back = this.#button(this.toolbar, "back", "Back", () => {
      const browser = window.gBrowser.selectedBrowser;
      if (browser?.canGoBack) browser.goBack();
    });
    this.back.hidden = true;
    const address = d.createElement("div");
    address.className = "zen-little-address";
    this.address = this.#button(
      address,
      "address",
      "Search or Enter URL…",
      () => {
        d.getElementById("Browser:OpenLocation").doCommand();
      },
    );
    const search = d.createElement("span");
    search.className = "zen-little-search-icon";
    search.setAttribute("aria-hidden", "true");
    this.host = d.createElement("span");
    this.host.className = "zen-little-host";
    this.address.append(search, this.host);
    this.extensions = this.#button(
      address,
      "extensions",
      "Extensions",
      (event) => {
        const sitePanel = window.gZenSiteDataPanel;
        const panel = sitePanel.extensionsPanel;
        if (panel.state === "open" || panel.state === "showing") {
          panel.hidePopup();
          return;
        }
        // Little windows hide the normal toolbars with CSS. Their pinned
        // extension buttons still need to be reachable in this panel, without
        // changing the user's stored toolbar placements in other windows.
        const { CustomizableUI } = ChromeUtils.importESModule(
          "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
        );
        window.gUnifiedExtensions._button = this.extensions;
        for (const area of CustomizableUI.areas) {
          if (
            CustomizableUI.getAreaType(area) === CustomizableUI.TYPE_TOOLBAR
          ) {
            window.gUnifiedExtensions.onToolbarVisibilityChange(
              area,
              false,
              panel,
            );
          }
        }
        void window.gUnifiedExtensions
          .togglePanel(
            event,
            undefined,
            panel,
            sitePanel.extensionsPanelView,
            this.extensions,
          )
          .then(() => {
            // Unpinned actions also default to the hidden sidebar anchor.
            for (const node of panel.querySelectorAll("[data-extensionid]")) {
              node.setAttribute("cui-anchorid", this.extensions.id);
            }
          });
      },
    );
    this.copy = this.#button(address, "copy", "Copy URL", () => {
      const uri = Services.io.createExposableURI(
        window.gBrowser.selectedBrowser.currentURI,
      );
      Cc["@mozilla.org/widget/clipboardhelper;1"]
        .getService(Ci.nsIClipboardHelper)
        .copyString(uri.displaySpec);
    });
    // Gecko's extension attention localization replaces aria-label on its
    // anchor. Keep this HTML icon button named after that asynchronous update.
    const extensionsLabel = d.createElement("span");
    extensionsLabel.id = "zen-little-extensions-label";
    extensionsLabel.hidden = true;
    extensionsLabel.textContent = "Extensions";
    this.extensions.append(extensionsLabel);
    this.extensions.setAttribute("aria-labelledby", extensionsLabel.id);
    this.toolbar.append(address);
    const actions = d.createElement("div");
    actions.className = "zen-little-open-actions";
    this.open = this.#button(actions, "open", "Open in Space", () => {
      void manager.moveToMainWindow(window, this.#spaceID);
    });
    this.openLabel = d.createElement("span");
    this.shortcut = d.createElement("kbd");
    this.shortcut.textContent = "⌘O";
    this.shortcut.setAttribute("aria-hidden", "true");
    this.open.append(this.openLabel, this.shortcut);
    this.spaces = this.#button(actions, "spaces", "Choose Space", () =>
      this.toggleSpaces(),
    );
    this.spaces.setAttribute("aria-haspopup", "dialog");
    this.spaces.setAttribute("aria-expanded", "false");
    this.toolbar.append(actions);
    d.getElementById("zen-main-app-wrapper").before(this.toolbar);
    this.#createPicker();
    this.inputClose = this.#button(window.gURLBar, "input-close", "Close", () => {
      if (window._zenLittleWindowInput) {
        window.close();
      } else {
        window.gURLBar.view.close();
        window.gURLBar.blur();
        window.gBrowser.selectedBrowser.focus();
      }
    });
    if (window._zenLittleWindowInput) {
      window.addEventListener("keydown", this.#inputEscape, true);
      this.inputSizeObserver = new window.ResizeObserver(() => {
        if (!window._zenLittleWindowInput || !window.gURLBar.view?.isOpen) return;
        const height = Math.ceil(window.gURLBar.getBoundingClientRect().height);
        if (height > 64 && (window.outerWidth !== 490 || window.outerHeight !== height)) {
          window.resizeTo(490, height);
        }
      });
      this.inputSizeObserver.observe(window.gURLBar);
      // Resolve the role's minimum-size rules before the window is shown.
      window.getComputedStyle(d.documentElement).minHeight;
      window.resizeTo(490, 329);
    }
    window.gBrowser.addTabsProgressListener(this);
    window.gBrowser.tabContainer.addEventListener("TabSelect", this);
    window.addEventListener("activate", this.#activate);
    window.gURLBar.addEventListener("toggle", this.#urlbarToggle);
    window.addEventListener("unload", () => this.destroy(), { once: true });
    this.updateLocation();
    this.updateDestination();
  }

  #button(parent, action, label, handler) {
    const button = this.#window.document.createElement("button");
    button.id = "zen-little-" + action;
    button.className = "zen-little-button";
    button.setAttribute("aria-label", label);
    button.addEventListener("click", (event) => {
      if (event.button === 0) handler(event);
    });
    parent.append(button);
    return button;
  }

  updateLocation() {
    const browser = this.#window.gBrowser.selectedBrowser;
    if (this.#window._zenLittleWindowInput && browser?.currentURI?.spec && browser.currentURI.spec !== "about:blank") {
      this.#expandInput();
    }
    const hideBack = !browser?.canGoBack;
    if (this.back.hidden !== hideBack) this.back.hidden = hideBack;
    let value = "Search or Enter URL…";
    try {
      const uri = Services.io.createExposableURI(
        browser.currentURI,
      );
      if (uri.spec !== "about:blank" || !this.#window._zenLittleWindowInput)
        value = uri.displayHost || uri.displaySpec;
    } catch {}
    if (this.host.textContent !== value) this.host.textContent = value;
  }

  updateDestination() {
    if (this.#destroyed) return;
    const target = this.#manager.getMainWindow(this.#window);
    if (target !== this.#target) {
      this.#target?.gZenWorkspaces?.removeChangeListeners(this.#spaceChanged);
      this.#target?.removeEventListener(
        "ZenWorkspaceDataChanged",
        this.#spaceChanged,
      );
      this.#target = target;
      target?.gZenWorkspaces?.addChangeListeners(this.#spaceChanged);
      target?.addEventListener("ZenWorkspaceDataChanged", this.#spaceChanged);
    }
    const workspaces = this.#workspaces();
    const active = target?.gZenWorkspaces?.activeWorkspace;
    const workspace =
      workspaces.find((s) => s.uuid === active) ||
      workspaces.find((s) => s.uuid === this.#spaceID) ||
      workspaces[0];
    this.#spaceID = workspace?.uuid;
    const label = workspace ? "Open in " + workspace.name : "Open in Arc";
    if (this.openLabel.textContent !== label) {
      this.openLabel.textContent = label;
      this.open.setAttribute("aria-label", label + " ⌘O");
    }
    if (this.isPickerOpen) this.#renderRows();
  }

  get destinationWorkspaceID() {
    return this.#spaceID;
  }

  #workspaces() {
    const main = this.#target?.gZenWorkspaces;
    return main
      ? main.getWorkspaces()
      : this.#window.gZenWorkspaces?.getWorkspaces(true) || [];
  }

  #createPicker() {
    const d = this.#window.document;
    this.panel = d.createElement("div");
    this.panel.id = "zen-little-space-picker";
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-label", "Open in Space");
    this.panel.setAttribute("popover", "auto");
    const content = d.createElement("div");
    content.className = "zen-little-picker-content";
    const header = d.createElement("div");
    header.className = "zen-little-picker-header";
    const search = d.createElement("span");
    search.className = "zen-little-search-icon";
    search.setAttribute("aria-hidden", "true");
    this.input = d.createElement("input");
    this.input.id = "zen-little-space-search";
    this.input.placeholder = "Search Spaces…";
    this.input.setAttribute("aria-label", "Search Spaces…");
    this.input.setAttribute("role", "combobox");
    this.input.setAttribute("aria-controls", "zen-little-space-list");
    this.input.setAttribute("aria-expanded", "true");
    header.append(search, this.input);
    this.#button(header, "collapse", "Close Space picker", () =>
      this.hidePicker(),
    );
    this.list = d.createElement("div");
    this.list.id = "zen-little-space-list";
    this.list.setAttribute("role", "listbox");
    this.empty = d.createElement("div");
    this.empty.className = "zen-little-picker-empty";
    this.empty.textContent = "No results";
    this.empty.setAttribute("role", "status");
    content.append(header, this.list, this.empty);
    this.panel.append(content);
    d.body.append(this.panel);
    this.input.addEventListener("input", () => {
      this.#selected = 0;
      this.#filterRows();
    });
    this.input.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      const count = this.#visibleRows.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (count)
          this.#selected =
            (this.#selected + (event.key === "ArrowDown" ? 1 : -1) + count) %
            count;
        this.#selectRow();
      } else if (event.key === "Enter") {
        event.preventDefault();
        this.#visibleRows[this.#selected]?.click();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.hidePicker();
      }
    });
    this.panel.addEventListener("toggle", (event) => {
      const open = event.newState === "open";
      this.spaces.setAttribute("aria-expanded", String(open));
      if (open) this.input.focus();
    });
  }

  get isPickerOpen() {
    return this.panel.matches(":popover-open");
  }

  hidePicker() {
    if (this.isPickerOpen) this.panel.hidePopover();
  }

  toggleSpaces() {
    if (this.isPickerOpen) {
      this.hidePicker();
      return;
    }
    this.updateDestination();
    this.input.value = "";
    this.#selected = 0;
    this.#renderRows();
    this.spaces.setAttribute("aria-expanded", "true");
    // Keep the picker in the window's top layer. No screen-coordinate layout
    // read is needed, and it remains accessible when native panels are open.
    this.panel.showPopover();
  }

  #renderRows() {
    const spaces = this.#workspaces();
    const ordered = spaces
      .filter((s) => s.uuid === this.#spaceID)
      .concat(spaces.filter((s) => s.uuid !== this.#spaceID));
    const keep = new Set(ordered.map((s) => s.uuid));
    for (const [id, row] of this.#rows) {
      if (!keep.has(id)) {
        row.remove();
        this.#rows.delete(id);
      }
    }
    ordered.forEach((space, index) => {
      let row = this.#rows.get(space.uuid);
      if (!row) {
        row = this.#window.document.createElement("button");
        row.className = "zen-little-space-row";
        row.id = "zen-little-space-" + space.uuid.replace(/[{}]/g, "");
        row.setAttribute("role", "option");
        row.dataset.workspaceId = space.uuid;
        const icon = this.#window.document.createElement("span");
        icon.className = "zen-little-space-icon";
        const name = this.#window.document.createElement("span");
        name.className = "zen-little-space-name";
        row.append(icon, name);
        row.addEventListener("click", () => {
          this.hidePicker();
          void this.#manager.moveToMainWindow(
            this.#window,
            row.dataset.workspaceId,
          );
        });
        row.addEventListener("mouseenter", () => {
          this.#selected = this.#visibleRows.indexOf(row);
          this.#selectRow();
        });
        this.#rows.set(space.uuid, row);
      }
      const [icon, name] = row.children;
      if (name.textContent !== space.name) name.textContent = space.name;
      row.setAttribute("aria-label", space.name);
      const symbol = space.icon || Array.from(space.name || " ")[0];
      if (icon.dataset.symbol !== symbol) {
        icon.replaceChildren();
        if (symbol.endsWith(".svg")) {
          const image = this.#window.document.createElement("img");
          image.src = symbol;
          image.alt = "";
          icon.append(image);
        } else {
          icon.textContent = symbol;
        }
        icon.dataset.symbol = symbol;
      }
      const colors = space.theme?.gradientColors || [];
      const color = (colors.find((c) => c.isPrimary) || colors[0])?.c;
      const background =
        color?.length === 3 && color.every((c) => Number.isFinite(c))
          ? "rgb(" + color.join(",") + ")"
          : "#777";
      if (icon.dataset.color !== background) {
        icon.style.backgroundColor = background;
        icon.dataset.color = background;
      }
      if (this.list.children[index] !== row)
        this.list.insertBefore(row, this.list.children[index] || null);
    });
    this.#filterRows();
  }

  #filterRows() {
    const query = this.input.value.trim().toLocaleLowerCase();
    this.#visibleRows = [...this.list.children].filter((row) => {
      row.hidden = !row
        .getAttribute("aria-label")
        .toLocaleLowerCase()
        .includes(query);
      return !row.hidden;
    });
    this.empty.hidden = !!this.#visibleRows.length;
    this.#selected = Math.min(
      Math.max(0, this.#selected),
      this.#visibleRows.length - 1,
    );
    this.#selectRow();
  }

  #selectRow() {
    this.#visibleRows.forEach((row, i) =>
      row.setAttribute("aria-selected", String(i === this.#selected)),
    );
    const row = this.#visibleRows[this.#selected];
    if (row) {
      this.input.setAttribute("aria-activedescendant", row.id);
      row.scrollIntoView({ block: "nearest" });
    } else {
      this.input.removeAttribute("aria-activedescendant");
    }
  }

  #expandInput() {
    this.inputSizeObserver?.disconnect();
    this.inputSizeObserver = null;
    this.#window.removeEventListener("keydown", this.#inputEscape, true);
    this.#manager.expandInputWindow(this.#window);
  }

  onLocationChange(browser, progress) {
    if (
      browser === this.#window.gBrowser.selectedBrowser &&
      progress.isTopLevel
    ) {
      // Explicit about:blank navigation must expand as well. Ignore the
      // startup blank load, which happens before the input has been shown.
      if (this.#inputShown && this.#window._zenLittleWindowInput) this.#expandInput();
      this.updateLocation();
    }
  }

  handleEvent() {
    this.updateLocation();
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    const w = this.#window;
    w.gBrowser.removeTabsProgressListener(this);
    w.gBrowser.tabContainer.removeEventListener("TabSelect", this);
    w.removeEventListener("activate", this.#activate);
    w.removeEventListener("keydown", this.#inputEscape, true);
    this.inputClose?.remove();
    this.inputSizeObserver?.disconnect();
    w.gURLBar.removeEventListener("toggle", this.#urlbarToggle);
    this.#target?.gZenWorkspaces?.removeChangeListeners(this.#spaceChanged);
    this.#target?.removeEventListener(
      "ZenWorkspaceDataChanged",
      this.#spaceChanged,
    );
    this.panel.remove();
    const controls = this.originalControls;
    if (controls?.parent.isConnected)
      controls.parent.insertBefore(
        controls.node,
        controls.next?.parentNode === controls.parent ? controls.next : null,
      );
    this.toolbar.remove();
    this.#rows.clear();
    this.#target = null;
  }
}
