// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import {
  developerSite,
  DeveloperModeSettings,
  DeveloperNavigation,
} from "./ZenDeveloperModeState.mjs";
import { PrivateBrowsingUtils } from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";
import { ZenDeveloperExtensions } from "./ZenDeveloperExtensions.sys.mjs";
import { ZenDeveloperSidebar } from "./ZenDeveloperSidebar.sys.mjs";

const SETTINGS_PREF = "zen.developer-mode.sites";
const CHANGE_TOPIC = "zen-developer-mode-changed";
let settings;

function getSettings() {
  if (!settings) {
    const read = () => Services.prefs.getStringPref(SETTINGS_PREF, "[]");
    settings = new DeveloperModeSettings(read, (value) =>
      Services.prefs.setStringPref(SETTINGS_PREF, value),
    );
    Services.prefs.addObserver(SETTINGS_PREF, () => {
      settings.reload(read());
      Services.obs.notifyObservers(null, CHANGE_TOPIC);
    });
    Services.obs.addObserver(
      () => settings.clearPrivate(),
      "last-pb-context-exited",
    );
  }
  return settings;
}

/** Per-site Developer Mode; ordinary sites stay unchanged until enabled. */
export class ZenDeveloperMode {
  #window;
  #panes = new Map();
  #navigation = new DeveloperNavigation();
  #captures = new WeakSet();
  #destroyed = false;
  #private;
  #sheetURI;
  #extensions;
  #portraitCapture;
  #sidebar;
  #refresh = () => {
    this.#refreshSidebar();
    this.refresh();
  };
  #events = [
    "TabOpen",
    "SSTabRestored",
    "TabSelect",
    "TabClose",
    "TabRemotenessChange",
  ];
  #splitEvents = [
    "ZenViewSplitter:SplitViewActivated",
    "ZenViewSplitter:SplitViewDeactivated",
  ];

  constructor(
    window,
    {
      sheetURI = "chrome://browser/content/zen-styles/zen-developer-mode.css",
    } = {},
  ) {
    this.#window = window;
    this.#sheetURI = sheetURI;
    this.#private = PrivateBrowsingUtils.isWindowPrivate(window);
    this.#sidebar = new ZenDeveloperSidebar(window);
    getSettings();
    window.windowUtils.loadSheetUsingURIString(
      sheetURI,
      window.windowUtils.AUTHOR_SHEET,
    );
    for (const type of this.#events)
      window.gBrowser.tabContainer.addEventListener(type, this);
    for (const type of this.#splitEvents) window.addEventListener(type, this);
    window.addEventListener("unload", this, { once: true });
    window.document.addEventListener("keydown", this, { capture: true });
    window.gBrowser.addTabsProgressListener(this);
    Services.obs.addObserver(this.#refresh, CHANGE_TOPIC);
    this.#refresh();
  }

  #updateSidebar(tab) {
    if (!tab?.linkedBrowser) return;
    const browser = tab.linkedBrowser;
    let host = "";
    if (this.#alive(tab, browser) && this.enabled(browser)) {
      host = new URL(browser.currentURI.spec).host;
    }
    this.#sidebar.update(tab, host);
  }

  #refreshSidebar() {
    if (this.#destroyed) return;
    const w = this.#window;
    for (const tab of w.gZenWorkspaces?.allStoredTabs ||
      w.gBrowser.tabContainer.allTabs || [w.gBrowser.selectedTab])
      this.#updateSidebar(tab);
  }

  #site(browser) {
    return developerSite(
      browser.currentURI.spec,
      browser.getAttribute("usercontextid"),
    );
  }

  enabled(browser) {
    return getSettings().enabled(this.#site(browser), this.#private);
  }
  available(browser) {
    return !!this.#site(browser);
  }

  addressEditorAnchor(browser) {
    const pane = this.#panes.get(browser);
    return pane && this.#alive(pane.tab, browser) && this.enabled(browser)
      ? pane.toolbar
      : null;
  }

  setEnabled(browser, enabled) {
    getSettings().set(this.#site(browser), enabled, this.#private);
    // Persistent writes already notify synchronously through the pref observer.
    if (this.#private) Services.obs.notifyObservers(null, CHANGE_TOPIC);
  }

  #alive(tab, browser) {
    return (
      !this.#destroyed &&
      tab.isConnected &&
      !tab.closing &&
      tab.linkedBrowser === browser &&
      browser.isConnected
    );
  }

  refresh() {
    if (this.#destroyed) return;
    const w = this.#window;
    const splitter = w.gZenViewSplitter;
    const tabs = splitter?.splitViewActive
      ? splitter._data[splitter.currentView]?.tabs || [w.gBrowser.selectedTab]
      : [w.gBrowser.selectedTab];
    const visible = new Set(tabs.map((tab) => tab.linkedBrowser));
    for (const [browser, pane] of this.#panes) {
      if (
        !visible.has(browser) ||
        !this.enabled(browser) ||
        !this.#alive(pane.tab, browser)
      )
        this.#remove(browser);
    }
    for (const tab of tabs) {
      const browser = tab.linkedBrowser;
      if (!this.#alive(tab, browser) || !this.enabled(browser)) continue;
      if (!this.#panes.has(browser)) this.#create(tab, browser);
      this.#update(browser);
    }
    this.#extensions?.refresh();
  }

  extensionsChanged() {
    this.#extensions?.refresh();
  }

  #create(tab, browser) {
    const w = this.#window;
    const d = w.document;
    const container = browser.closest(".browserContainer");
    if (!container) return;
    const toolbar = d.createElement("div");
    toolbar.className = "zen-developer-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Developer Mode");
    const button = (action, label, icon, callback) => {
      const node = d.createElement("button");
      node.type = "button";
      node.className = "zen-developer-button";
      node.dataset.action = action;
      node.setAttribute("aria-label", label);
      node.title = label;
      node.style.setProperty("--zen-developer-icon", `url("${icon}")`);
      node.addEventListener("click", (event) => {
        if (!this.#alive(tab, browser)) return;
        w.gBrowser.selectedTab = tab;
        Promise.resolve(callback(event, node)).catch((error) =>
          console.error(error),
        );
      });
      toolbar.append(node);
      return node;
    };
    button(
      "site",
      "Site Settings",
      "chrome://browser/content/zen-images/split/site.svg",
      (event, anchor) => {
        w.gZenSiteDataPanel.toggle(event, anchor);
      },
    );
    const address = d.createElement("input");
    address.className = "zen-developer-address";
    address.type = "text";
    address.setAttribute("aria-label", "URL");
    address.setAttribute("autocomplete", "off");
    address.setAttribute("spellcheck", "false");
    address.addEventListener("focus", () => address.select());
    address.addEventListener("blur", () => this.#update(browser));
    address.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        address.value = Services.io.createExposableURI(
          browser.currentURI,
        ).displaySpec;
        browser.focus();
      } else if (event.key === "Enter") {
        event.preventDefault();
        void this.navigate(browser, address.value).catch((error) =>
          console.error(error),
        );
      }
    });
    toolbar.append(address);
    button(
      "copy",
      "Copy Link",
      "chrome://browser/content/zen-images/split/link.svg",
      () => {
        w.gZenCommonActions.copyCurrentURLToClipboard();
      },
    );
    button(
      "capture-window",
      "Capture Window",
      "chrome://browser/content/zen-images/split/capture-window.svg",
      async (event, anchor) => {
        const { ZenPortraitCapture } = ChromeUtils.importESModule(
          "resource:///modules/ZenPortraitCapture.sys.mjs",
        );
        this.#portraitCapture ||= new ZenPortraitCapture(w);
        await this.#portraitCapture.open(browser, anchor, {
          quick: event.altKey,
        });
      },
    );
    button("capture", "Capture", "chrome://browser/skin/screenshot.svg", () => {
      this.#captures.add(browser);
      w.ScreenshotsUtils.toggle(browser, "toolbar");
    });
    button(
      "console",
      "Toggle Console",
      "chrome://devtools/skin/images/tool-webconsole.svg",
      () => this.#tool(tab, browser, "webconsole"),
    );
    button(
      "network",
      "Toggle Network Panel",
      "chrome://devtools/skin/images/tool-network.svg",
      () => this.#tool(tab, browser, "netmonitor"),
    );
    button(
      "inspect",
      "Inspect Element",
      "resource://devtools/shared/images/command-pick.svg",
      () => this.#inspect(tab, browser),
    );
    this.#extensions ||= new ZenDeveloperExtensions(w);
    const detachExtensions = this.#extensions.attach(tab, browser, toolbar);
    button(
      "split",
      "Split View Menu",
      "chrome://browser/content/zen-images/split/split.svg",
      (event, anchor) => {
        w.gZenViewSplitter.paneToolbar.showMenu(tab, anchor, event);
      },
    );
    container.prepend(toolbar);
    container.setAttribute("zen-developer-mode", "true");
    container.parentElement.setAttribute("zen-developer-mode", "true");
    this.#panes.set(browser, {
      tab,
      container,
      toolbar,
      address,
      detachExtensions,
    });
  }

  #update(browser) {
    const pane = this.#panes.get(browser);
    if (pane && this.#window.document.activeElement !== pane.address) {
      const value = Services.io.createExposableURI(
        browser.currentURI,
      ).displaySpec;
      if (pane.address.value !== value) pane.address.value = value;
    }
  }

  /** Use Firefox's resolver and load machinery, without any stale command-bar selection. */
  async navigate(browser, value) {
    const w = this.#window;
    const tab = w.gBrowser.getTabForBrowser(browser);
    const searchString = value.trim();
    if (!searchString || !tab || !this.#alive(tab, browser)) return false;
    const browserId = browser.browserId;
    const { UrlbarShared } = ChromeUtils.importESModule(
      "chrome://browser/content/urlbar/UrlbarShared.mjs",
    );
    return this.#navigation.run(
      browser,
      () => this.#alive(tab, browser),
      () =>
        w.gURLBar.controller.resolveFallbackNavigation({
          searchString,
          where: "current",
          searchMode: null,
          browserId,
        }),
      async ({ heuristicResult, fixup }) => {
        const loadRequest = heuristicResult
          ? UrlbarShared.getLoadRequestFromResult(heuristicResult)
          : fixup
            ? { urlLoad: { url: fixup.url, postData: fixup.postData } }
            : null;
        if (!loadRequest) return false;
        await w.gURLBar.parentController.loadURL({
          loadRequest,
          where: "current",
          browserId,
          userTypedValue: searchString,
          params: {
            allowInheritPrincipal:
              heuristicResult?.type === UrlbarShared.RESULT_TYPE.KEYWORD,
            allowThirdPartyFixup: true,
            allowPinnedTabHostChange: true,
            indicateErrorPageLoad: true,
            private: this.#private,
            avoidBrowserFocus: w.gBrowser.selectedTab !== tab,
          },
        });
      },
    );
  }

  #devtools() {
    const { require } = ChromeUtils.importESModule(
      "resource://devtools/shared/loader/Loader.sys.mjs",
    );
    return require("devtools/client/framework/devtools").gDevTools;
  }

  async #tool(tab, browser, toolId) {
    const devtools = this.#devtools();
    const toolbox = devtools.getToolboxForTab(tab);
    if (
      toolbox &&
      (toolbox.currentToolId === toolId ||
        (toolId === "webconsole" && toolbox.splitConsole))
    ) {
      if (toolbox.hostType === "window") await toolbox.raise();
      else await toolbox.destroy();
    } else if (this.#alive(tab, browser)) {
      await devtools.showToolboxForTab(tab, { toolId });
    }
  }

  async #inspect(tab, browser) {
    const toolbox = await this.#devtools().showToolboxForTab(tab, {
      toolId: "inspector",
    });
    // Never start a picker in a different pane after an asynchronous toolbox open.
    if (
      this.#alive(tab, browser) &&
      this.#window.gBrowser.selectedTab === tab
    ) {
      await toolbox.nodePicker.togglePicker(true);
    }
  }

  onLocationChange(browser, progress) {
    if (!progress.isTopLevel) return;
    this.#navigation.cancel(browser);
    this.#updateSidebar(this.#window.gBrowser.getTabForBrowser(browser));
    this.refresh();
  }

  handleEvent(event) {
    if (event.type === "keydown") {
      const browser = this.#window.gBrowser.selectedBrowser;
      if (event.key !== "Escape" || !this.#captures.has(browser)) return;
      const screenshots = this.#window.ScreenshotsUtils;
      const panel = screenshots.panelForBrowser(browser);
      // The capture buttons live inside nested shadow roots. Gecko's direct
      // parent check misses the retargeted screenshots-buttons element.
      // Only intercept Escape from this pane's capture panel, never the page.
      if (panel?.contains(event.target)) {
        screenshots.cancel(browser, "Escape");
        this.#captures.delete(browser);
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (event.type === "unload") {
      this.destroy();
      return;
    }
    if (event.type === "TabClose") {
      this.#sidebar.remove(event.target);
      this.#navigation.cancel(event.target.linkedBrowser);
      this.#remove(event.target.linkedBrowser);
      return;
    }
    if (this.#events.includes(event.type)) this.#updateSidebar(event.target);
    this.refresh();
  }

  #remove(browser) {
    const pane = this.#panes.get(browser);
    if (!pane) return;
    this.#portraitCapture?.closeForBrowser(browser);
    pane.detachExtensions();
    pane.toolbar.remove();
    pane.container.removeAttribute("zen-developer-mode");
    pane.container.parentElement?.removeAttribute("zen-developer-mode");
    this.#panes.delete(browser);
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    const w = this.#window;
    for (const type of this.#events)
      w.gBrowser.tabContainer.removeEventListener(type, this);
    for (const type of this.#splitEvents) w.removeEventListener(type, this);
    w.removeEventListener("unload", this);
    w.document.removeEventListener("keydown", this, { capture: true });
    w.gBrowser.removeTabsProgressListener(this);
    Services.obs.removeObserver(this.#refresh, CHANGE_TOPIC);
    this.#navigation.clear();
    this.#sidebar.destroy();
    for (const browser of this.#panes.keys()) this.#remove(browser);
    this.#extensions?.destroy();
    this.#portraitCapture?.destroy();
    // Recreating a controller in the same window must not leave a duplicate
    // sheet behind; Gecko rejects loading the same sheet a second time.
    try {
      w.windowUtils.removeSheetUsingURIString(
        this.#sheetURI,
        w.windowUtils.AUTHOR_SHEET,
      );
    } catch {
      // During window teardown Gecko may already have discarded its sheets.
    }
  }
}
