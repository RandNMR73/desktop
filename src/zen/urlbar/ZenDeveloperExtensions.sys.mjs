// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  ExtensionParent: "resource://gre/modules/ExtensionParent.sys.mjs",
});

/** Per-pane presentation of real WebExtension actions; never moves their widgets. */
export class ZenDeveloperExtensions {
  #window;
  #panes = new Set();
  #queued = false;
  #destroyed = false;
  #request = 0;
  #popup;
  #menu;
  #context;
  #owner;

  constructor(window) {
    this.#window = window;
    window.CustomizableUI.addListener(this);
    lazy.AddonManager.addAddonListener(this);
  }

  #alive(pane) {
    return (
      !this.#destroyed &&
      this.#panes.has(pane) &&
      pane.tab.isConnected &&
      !pane.tab.closing &&
      pane.browser.isConnected &&
      pane.tab.linkedBrowser === pane.browser
    );
  }

  #current(pane) {
    return this.#alive(pane) && this.#window.gBrowser.selectedTab === pane.tab;
  }

  #policies() {
    // This applies Gecko's hidden-extension and private-window access filters.
    return this.#window.gUnifiedExtensions.getActivePolicies();
  }

  #api(id) {
    const policy = this.#policies().find((item) => item.id === id);
    return policy && this.#window.gUnifiedExtensions.browserActionFor(policy);
  }

  #pinned(api) {
    const ui = this.#window.CustomizableUI;
    const placement = api && ui.getPlacementOfWidget(api.id);
    return placement && ui.getAreaType(placement.area) === ui.TYPE_TOOLBAR;
  }

  attach(tab, browser, toolbar) {
    const d = this.#window.document;
    const group = d.createElement("span");
    group.className = "zen-developer-extensions";
    const menu = d.createElement("button");
    menu.type = "button";
    menu.className = "zen-developer-button";
    menu.dataset.action = "extensions";
    menu.setAttribute("aria-label", "Extensions Menu");
    menu.setAttribute("aria-haspopup", "menu");
    menu.setAttribute("aria-expanded", "false");
    menu.title = "Extensions Menu";
    menu.style.setProperty(
      "--zen-developer-icon",
      'url("chrome://mozapps/skin/extensions/extension.svg")',
    );
    const pane = { tab, browser, group, menu, buttons: new Map() };
    menu.addEventListener("click", (event) => {
      if (!this.#alive(pane)) return;
      this.#window.gBrowser.selectedTab = tab;
      this.#openMenu(pane, event);
    });
    group.append(menu);
    toolbar.append(group);
    this.#panes.add(pane);
    this.#update(pane);
    return () => {
      this.#panes.delete(pane);
      if (this.#owner === pane || this.#popup?.pane === pane) this.#close();
      group.remove();
    };
  }

  refresh() {
    if (this.#destroyed) return;
    if (
      (this.#owner && !this.#current(this.#owner)) ||
      (this.#popup &&
        (!this.#current(this.#popup.pane) ||
          this.#popup.location !==
            this.#popup.pane.browser.lastLocationChange ||
          this.#popup.url !== this.#popup.pane.browser.currentURI.spec ||
          !this.#api(this.#popup.id)))
    )
      this.#close();
    if (this.#queued) return;
    this.#queued = true;
    this.#window.queueMicrotask(() => {
      this.#queued = false;
      if (!this.#destroyed) for (const pane of this.#panes) this.#update(pane);
    });
  }

  #icon(api, policy, tab) {
    const icons =
      api?.action.getContextData(tab).icon ||
      policy.extension.manifest.icons ||
      {};
    const { icon } = lazy.ExtensionParent.IconDetails.getPreferredIcon(
      icons,
      policy.extension,
      16,
    );
    return typeof icon === "object" ? icon.light : icon;
  }

  #update(pane) {
    if (!this.#alive(pane)) return;
    const w = this.#window;
    const policies = this.#policies().filter((policy) =>
      this.#pinned(w.gUnifiedExtensions.browserActionFor(policy)),
    );
    policies.sort((a, b) => {
      const ui = w.CustomizableUI;
      const place = (policy) =>
        ui.getPlacementOfWidget(
          w.gUnifiedExtensions.browserActionFor(policy).id,
        );
      const left = place(a),
        right = place(b);
      return (
        left.area.localeCompare(right.area) || left.position - right.position
      );
    });
    const keep = new Set(policies.map((policy) => policy.id));
    for (const [id, button] of pane.buttons)
      if (!keep.has(id)) {
        button.remove();
        pane.buttons.delete(id);
      }
    let previous = pane.menu;
    for (const policy of policies) {
      const api = w.gUnifiedExtensions.browserActionFor(policy);
      const data = api.action.getContextData(pane.tab);
      let button = pane.buttons.get(policy.id);
      if (!button) {
        button = w.document.createElement("button");
        button.type = "button";
        button.className = "zen-developer-button zen-developer-extension";
        button.dataset.extensionId = policy.id;
        const icon = w.document.createElement("img");
        icon.alt = "";
        const badge = w.document.createElement("span");
        badge.className = "zen-developer-extension-badge";
        button.append(icon, badge);
        button.addEventListener("click", (event) => {
          if (!this.#alive(pane)) return;
          w.gBrowser.selectedTab = pane.tab;
          void this.#activate(pane, policy.id, button, event).catch(
            console.error,
          );
        });
        button.addEventListener("contextmenu", (event) =>
          this.#openContext(pane, policy.id, event),
        );
        pane.buttons.set(policy.id, button);
      }
      const set = (node, name, value) => {
        if (node.getAttribute(name) !== value) node.setAttribute(name, value);
      };
      const title = data.title || policy.extension.name;
      set(button, "aria-label", title);
      set(button, "title", title);
      if (button.disabled !== !data.enabled) button.disabled = !data.enabled;
      set(button.firstElementChild, "src", this.#icon(api, policy, pane.tab));
      const badge = button.lastElementChild;
      if (badge.textContent !== data.badgeText)
        badge.textContent = data.badgeText;
      const color = (rgba) =>
        `rgba(${rgba.slice(0, 3).join(",")},${rgba[3] / 255})`;
      const style = `background-color:${color(data.badgeBackgroundColor)};color:${color(api.action.getTextColor(data))}`;
      set(badge, "style", style);
      if (previous.nextElementSibling !== button) previous.after(button);
      previous = button;
    }
  }

  #newMenu() {
    const menu = this.#window.document.createXULElement("menupopup");
    // AppKit menus swallow secondary clicks on their entries. Keep this list in
    // chrome so each extension can expose its own context menu, as Arc does.
    menu.setAttribute("nonnative", "");
    menu.classList.add("zen-developer-extensions-menu");
    this.#window.document.getElementById("mainPopupSet").append(menu);
    return menu;
  }

  #item(menu, label, callback, image) {
    const item = this.#window.document.createXULElement("menuitem");
    item.setAttribute("label", label);
    if (image) {
      item.classList.add("menuitem-iconic");
      item.setAttribute("image", image);
    }
    item.addEventListener("command", (event) => {
      Promise.resolve(callback(event)).catch(console.error);
    });
    menu.append(item);
    return item;
  }

  #separator(menu) {
    menu.append(this.#window.document.createXULElement("menuseparator"));
  }

  #openMenu(pane, event) {
    if (this.#owner === pane && this.#menu?.state === "open") {
      this.#close();
      return;
    }
    this.#close();
    this.#owner = pane;
    const w = this.#window;
    const menu = (this.#menu ||= this.#newMenu());
    pane.menu.setAttribute("aria-expanded", "true");
    menu.addEventListener(
      "popuphidden",
      () => pane.menu.setAttribute("aria-expanded", "false"),
      { once: true },
    );
    menu.replaceChildren();
    const policies = this.#policies().sort((a, b) =>
      a.extension.name < b.extension.name
        ? -1
        : a.extension.name > b.extension.name
          ? 1
          : 0,
    );
    for (const policy of policies) {
      const api = w.gUnifiedExtensions.browserActionFor(policy);
      const item = this.#item(
        menu,
        policy.extension.name,
        (e) => this.#activate(pane, policy.id, pane.menu, e),
        this.#icon(api, policy, pane.tab),
      );
      item.disabled = api
        ? !api.action.getContextData(pane.tab).enabled
        : false;
      item.addEventListener("contextmenu", (e) =>
        this.#openContext(pane, policy.id, e),
      );
    }
    if (policies.length) this.#separator(menu);
    this.#item(menu, "Add Extension…", () => {
      if (this.#current(pane))
        w.switchToTabHavingURI(
          Services.urlFormatter.formatURLPref("extensions.getAddons.link.url"),
          true,
        );
    });
    this.#item(menu, "Manage Extensions…", () => {
      if (this.#current(pane))
        return w.BrowserAddonUI.openAddonsMgr("addons://list/extension");
    });
    menu.openPopup(pane.menu, "after_end", 0, 0, false, false, event);
  }

  #openContext(pane, id, event) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.#alive(pane)) return;
    const w = this.#window;
    w.gBrowser.selectedTab = pane.tab;
    this.#owner = pane;
    const policy = this.#policies().find((item) => item.id === id);
    if (!policy) return;
    const menu = (this.#context ||= this.#newMenu());
    menu.replaceChildren();
    this.#item(menu, policy.extension.name, () => {}).disabled = true;
    this.#separator(menu);
    const api = this.#api(id);
    if (api) {
      const pinned = this.#pinned(api);
      this.#item(menu, pinned ? "Unpin" : "Pin", () => {
        if (!this.#current(pane) || this.#api(id) !== api) return;
        // Preserve the real widget's placement, including Zen's collapsed toolbar bookkeeping.
        w.gUnifiedExtensions._maybeMoveWidgetNodeBack(api.id);
        return w.gUnifiedExtensions.pinToToolbar(api.id, !pinned);
      });
    }
    this.#item(menu, "Manage Extension", () => {
      if (this.#current(pane))
        return w.BrowserAddonUI.manageAddon(id, "unifiedExtensions");
    });
    this.#item(menu, "Remove Extension…", () => {
      if (this.#current(pane))
        return w.BrowserAddonUI.removeAddon(id, "unifiedExtensions");
    });
    menu.openPopupAtScreen(event.screenX, event.screenY, true, event);
  }

  async #activate(pane, id, anchor, event) {
    if (!this.#current(pane)) return;
    const w = this.#window;
    const api = this.#api(id);
    if (!api) {
      if (this.#policies().some((policy) => policy.id === id))
        await w.BrowserAddonUI.manageAddon(id, "unifiedExtensions");
      return;
    }
    if (!api.action.getContextData(pane.tab).enabled) return;
    if (this.#popup?.id === id && this.#popup.pane === pane && anchor.open) {
      this.#close();
      return;
    }
    this.#close();
    const request = ++this.#request;
    const modifiers = [];
    for (const [key, name] of [
      ["shiftKey", "Shift"],
      ["altKey", "Alt"],
      ["metaKey", "Command"],
      ["ctrlKey", "Ctrl"],
    ])
      if (event[key]) modifiers.push(name);
    const click = { button: 0, modifiers };
    if (!api.action.getPopupUrl(pane.tab)) {
      api.action.triggerClickOrPopup(pane.tab, click);
      return;
    }
    const view = w.document.getElementById(api.viewId);
    if (!view) return;
    const location = pane.browser.lastLocationChange;
    const url = pane.browser.currentURI.spec;
    this.#popup = { pane, id, view, location, url };
    // PanelMultiView may yield before ViewShowing. Check ownership before Gecko
    // grants activeTab permission or invokes the extension's view listener.
    const guard = (e) => {
      if (e.target !== view) return;
      if (
        request !== this.#request ||
        !this.#current(pane) ||
        location !== pane.browser.lastLocationChange ||
        url !== pane.browser.currentURI.spec ||
        this.#api(id) !== api ||
        !api.action.getContextData(pane.tab).enabled
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      api.lastClickInfo = click;
      api.openPopupWithoutUserInteraction = false;
    };
    view.addEventListener("ViewShowing", guard, { capture: true });
    anchor.setAttribute("tabspecific", "true");
    anchor.setAttribute("locationspecific", "true");
    try {
      await w.PanelUI.showSubView(api.viewId, anchor, event);
    } finally {
      view.removeEventListener("ViewShowing", guard, { capture: true });
    }
  }

  #close() {
    this.#request++;
    this.#menu?.hidePopup();
    this.#context?.hidePopup();
    const panel = this.#popup?.view.closest("panel");
    if (panel) this.#window.PanelMultiView.hidePopup(panel);
    this.#popup = null;
    this.#owner = null;
  }

  onWidgetAdded() {
    this.refresh();
  }
  onWidgetMoved() {
    this.refresh();
  }
  onWidgetRemoved() {
    this.refresh();
  }
  onWidgetAfterCreation() {
    this.refresh();
  }
  onInstalled() {
    this.refresh();
  }
  onEnabled() {
    this.refresh();
  }
  onDisabled() {
    this.#close();
    this.refresh();
  }
  onUninstalled() {
    this.#close();
    this.refresh();
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#close();
    this.#window.CustomizableUI.removeListener(this);
    lazy.AddonManager.removeAddonListener(this);
    for (const pane of this.#panes) pane.group.remove();
    this.#panes.clear();
    this.#menu?.remove();
    this.#context?.remove();
  }
}
