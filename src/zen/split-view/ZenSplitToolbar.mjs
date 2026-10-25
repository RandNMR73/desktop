// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/** A pane's controls always act on its browser, including inactive panes. */
export class ZenSplitToolbar {
  #window;
  #splitter;
  #panes = new Map();
  #listening = false;

  constructor(window, splitter) {
    this.#window = window;
    this.#splitter = splitter;
  }

  create(container) {
    const w = this.#window;
    const d = w.document;
    const browser = container.querySelector("browser");
    const tab = w.gBrowser.getTabForBrowser(browser);
    const header = d.createElement("div");
    header.className = "zen-view-splitter-header-container";
    header.setAttribute("role", "toolbar");
    header.setAttribute("aria-label", "Split pane");
    header.toggleAttribute("empty", tab.hasAttribute("zen-empty-tab"));
    const left = d.createElement("div");
    left.className = "zen-split-pane-navigation";
    const center = d.createElement("div");
    center.className = "zen-split-pane-address";
    const right = d.createElement("div");
    right.className = "zen-split-pane-actions";
    header.append(left, center, right);
    const button = (parent, action, label, callback) => {
      const node = d.createXULElement("toolbarbutton");
      node.className = `zen-split-pane-button zen-split-pane-${action}`;
      node.setAttribute("aria-label", label);
      node.setAttribute("tooltiptext", label);
      node.addEventListener("command", event => {
        w.gBrowser.selectedTab = tab;
        callback(event, node);
      });
      parent.append(node);
      return node;
    };
    const back = button(left, "back", "Go back", () => {
      if (browser.canGoBack) browser.goBack();
    });
    const forward = button(left, "forward", "Go forward", () => {
      if (browser.canGoForward) browser.goForward();
    });
    const reload = button(left, "reload", "Reload this page", () => {
      if (browser.webProgress.isLoadingDocument) {
        browser.stop(Ci.nsIWebNavigation.STOP_ALL);
      } else {
        browser.reload();
      }
    });
    button(center, "copy", "Copy Current URL", () => {
      const uri = Services.io.createExposableURI(browser.currentURI);
      Cc["@mozilla.org/widget/clipboardhelper;1"]
        .getService(Ci.nsIClipboardHelper).copyString(uri.displaySpec);
    });
    const address = d.createElement("span");
    address.className = "zen-split-pane-domain";
    center.append(address);
    button(right, "site", "Site Control Center", (event, anchor) => {
      w.gIdentityHandler._openPopup(event, anchor);
    });
    button(right, "menu", "Split View Menu", (event, anchor) => {
      this.#showMenu(tab, anchor, event);
    });
    const close = button(right, "close", "Close Split View Pane", () => {
      this.#splitter.closeSelectedPane();
    });
    close.disabled = tab.hasAttribute("zen-empty-tab");
    this.#panes.set(browser, { tab, container, header, address, back, forward, reload, actor: null });
    this.#update(browser);
    return header;
  }

  remove(container) {
    const browser = container.querySelector("browser");
    const pane = this.#panes.get(browser);
    if (!pane) return;
    this.#stopColor(pane);
    pane.header.remove();
    pane.container.style.removeProperty("--zen-split-page-background");
    pane.container.style.removeProperty("--zen-split-page-scheme");
    this.#panes.delete(browser);
    this.#listen([...this.#panes.values()].some(value => value.active));
  }

  setActive(tabs) {
    const visible = new Set(tabs.map(tab => tab.linkedBrowser));
    for (const [browser, pane] of this.#panes) {
      pane.active = visible.has(browser);
      if (pane.active) {
        this.#update(browser);
        this.#watchColor(browser, pane);
      } else {
        this.#stopColor(pane);
      }
    }
    this.#listen([...this.#panes.values()].some(pane => pane.active));
  }

  #listen(enabled) {
    if (this.#listening === enabled) return;
    const method = enabled ? "addTabsProgressListener" : "removeTabsProgressListener";
    this.#window.gBrowser[method](this);
    this.#listening = enabled;
  }

  #update(browser) {
    const pane = this.#panes.get(browser);
    if (!pane) return;
    let label = "Search or Enter URL…";
    try {
      const uri = Services.io.createExposableURI(browser.currentURI);
      label = uri.displayHost || uri.displaySpec;
      if (label === "about:blank") label = "Search or Enter URL…";
    } catch {}
    if (pane.address.textContent !== label) pane.address.textContent = label;
    if (pane.back.disabled === browser.canGoBack) pane.back.disabled = !browser.canGoBack;
    if (pane.forward.disabled === browser.canGoForward) pane.forward.disabled = !browser.canGoForward;
    const loading = browser.webProgress.isLoadingDocument;
    pane.reload.toggleAttribute("loading", loading);
    const action = loading ? "Stop loading" : "Reload this page";
    if (pane.reload.getAttribute("aria-label") !== action) {
      pane.reload.setAttribute("aria-label", action);
      pane.reload.setAttribute("tooltiptext", action);
    }
  }

  onLocationChange(browser, progress) {
    if (!progress.isTopLevel || !this.#panes.get(browser)?.active) return;
    this.#update(browser);
    const pane = this.#panes.get(browser);
    if (pane.active) this.#watchColor(browser, pane);
  }

  onStateChange(browser, progress, request, flags) {
    if (!progress.isTopLevel || !this.#panes.get(browser)?.active) return;
    if (flags & Ci.nsIWebProgressListener.STATE_IS_WINDOW) {
      this.#update(browser);
      const pane = this.#panes.get(browser);
      if (pane.active) this.#watchColor(browser, pane);
    }
  }

  #watchColor(browser, pane) {
    try {
      const actor = browser.browsingContext.currentWindowGlobal.getActor("ZenSplitToolbar");
      if (pane.actor === actor) return;
      this.#stopColor(pane);
      pane.actor = actor;
      actor.sendAsyncMessage("ZenSplitToolbar:Observe");
    } catch {
      // Internal pages and closing processes may not have a web actor.
    }
  }

  #stopColor(pane) {
    try { pane.actor?.sendAsyncMessage("ZenSplitToolbar:Stop"); } catch {}
    pane.actor = null;
  }

  updateColor(browser, actor, data) {
    if (!data || typeof data !== "object") return;
    const { color, scheme } = data;
    const pane = this.#panes.get(browser);
    if (!pane?.active || pane.actor !== actor || typeof color !== "string" ||
        color.length > 256 || !this.#window.CSS.supports("color", color)) return;
    if (pane.color !== color) {
      pane.container.style.setProperty("--zen-split-page-background", color);
      pane.color = color;
    }
    if (typeof scheme === "string" && scheme.length < 64 &&
        this.#window.CSS.supports("color-scheme", scheme) && pane.scheme !== scheme) {
      pane.container.style.setProperty("--zen-split-page-scheme", scheme);
      pane.scheme = scheme;
    }
  }

  #showMenu(tab, anchor, event) {
    const w = this.#window, d = w.document, splitter = this.#splitter;
    const group = splitter._data.find(data => data.tabs.includes(tab));
    if (!group) return;
    const stacked = group.layoutTree.direction === "column";
    const panes = [];
    const collect = node => node.children ? node.children.forEach(collect) : panes.push(node.tab);
    collect(group.layoutTree);
    const index = panes.indexOf(tab);
    const popup = d.createXULElement("menupopup");
    popup.className = "zen-split-pane-menu";
    const item = (label, callback, disabled = false) => {
      const node = d.createXULElement("menuitem");
      node.setAttribute("label", label);
      node.disabled = disabled;
      node.addEventListener("command", callback, { once: true });
      popup.append(node);
    };
    const move = offset => {
      splitter.swapNodes(splitter.getSplitNodeFromTab(tab), splitter.getSplitNodeFromTab(panes[index + offset]));
      splitter.syncPaneOrder(group);
      splitter.applyGridLayout(group.layoutTree);
    };
    item(stacked ? "Move Up" : "Move Left", () => move(-1), index === 0);
    item(stacked ? "Move Down" : "Move Right", () => move(1), index === panes.length - 1);
    const add = side => {
      w.gBrowser.selectedTab = tab;
      splitter.createEmptySplit(side);
    };
    item(stacked ? "Add Top Split" : "Add Right Split", () => add(stacked ? "top" : "right"), panes.length >= splitter.MAX_TABS);
    item(stacked ? "Add Bottom Split" : "Add Left Split", () => add(stacked ? "bottom" : "left"), panes.length >= splitter.MAX_TABS);
    item("Separate Tab from Split", () => {
      splitter.removeTabFromGroup(tab, undefined, { forUnsplit: true });
      w.gBrowser.selectedTab = tab;
    });
    item(stacked ? "Convert to Horizontal Split View" : "Convert to Vertical Split View", () => {
      group.gridType = stacked ? "vsep" : "hsep";
      group.layoutTree = splitter.calculateLayoutTree(panes, group.gridType);
      splitter.activateSplitView(group, true);
    });
    item("Share Split View…", () => w.gZenShareManager.shareSplitView(tab.group), !w.gZenShareManager.enabled);
    popup.addEventListener("popuphidden", () => popup.remove(), { once: true });
    d.getElementById("mainPopupSet").append(popup);
    popup.openPopup(anchor, "after_end", 0, 0, false, false, event);
  }
}
