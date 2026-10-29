// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { UrlbarShared } from "chrome://browser/content/urlbar/UrlbarShared.mjs";

const SEARCH_MODE_ANIMATION_RESET_MS = 1000;

/**
 * Zen's behaviour on top of Firefox's URL bar.
 */
export class nsZenUrlbarController {
  // The URL bar session that currently replaces a new tab.
  #prevUrlbarLabel = null;
  #lastSearch = "";
  #clearTimeout = null;
  #lastTab = null;
  #sessionCounter = 0;
  #owner = null;

  // Only the empty command bar owns this temporary tabs preview. Never clear
  // an explicit site/history/bookmark search mode on the user's behalf.
  #arcTabsMode = false;
  #clearingArcTabsMode = false;
  #arcSelectionPending = false;
  #arcSelectionFrame = 0;
  #arcSearchInfo = null;
  #sidebarAnchor = null;
  #editorPreview = false;

  // Search mode animation.
  #animatingSearchMode = false;
  #animatingSearchModeTimeout = null;

  // Site search chip: the engine it is being painted for, and the colours
  // derived from engine icons, keyed by icon URL.
  #siteSearchChipEngine = null;
  #iconColors = new Map();

  constructor() {
    XPCOMUtils.defineLazyPreferenceGetter(
      this,
      "waitToClear",
      "zen.urlbar.wait-to-clear",
      0,
    );
    XPCOMUtils.defineLazyPreferenceGetter(
      this,
      "showDomainOnly",
      "zen.urlbar.show-domain-only-in-sidebar",
      true,
    );
  }

  init() {
    const { registerZenUrlbarProviders } = ChromeUtils.importESModule(
      "resource:///modules/ZenUBProvider.sys.mjs",
    );
    const { nsZenSiteDataPanel: ZenSiteDataPanel } = ChromeUtils.importESModule(
      "resource:///modules/ZenSiteDataPanel.sys.mjs",
    );
    registerZenUrlbarProviders();
    window.gZenSiteDataPanel = new ZenSiteDataPanel(window);
    if (
      !window._zenLittleWindow &&
      !document.documentElement.hasAttribute("zen-little-window") &&
      Services.prefs.getBoolPref("zen.developer-mode.enabled", true)
    ) {
      const { ZenDeveloperMode } = ChromeUtils.importESModule(
        "resource:///modules/ZenDeveloperMode.sys.mjs",
      );
      window.gZenDeveloperMode = new ZenDeveloperMode(window);
    }
    gURLBar._zenTrimURL = this.trimURL.bind(this);
    gURLBar._setPlaceholder(null);
    this.#setArcPlaceholder();
    gURLBar.addEventListener("searchmodechanged", () => {
      if (this.#ownsOpenTabsMode()) {
        this.#setArcPlaceholder();
      }
    });
    gURLBar.controller.addListener({
      onQueryResults: (context) => this.#preselectFirstRow(context),
      onQueryFinished: (context) => this.#preselectFirstRow(context),
    });
    // Run before UrlbarInput handles the input and starts its query. Merely
    // removing our CSS attribute leaves Firefox restricted to tabs forever.
    gURLBar.addEventListener(
      "input",
      () => {
        this.#editorPreview = false;
        if ((gURLBar.value || "").trim()) {
          this.#leaveOpenTabsMode();
        } else if (gURLBar.view?.isOpen) {
          this.#showOpenTabsIfEmpty(false);
        }
      },
      { capture: true },
    );
    gURLBar.addEventListener(
      "keydown",
      (event) => {
        if (
          ["ArrowDown", "ArrowUp", "Tab", "Escape", "Enter"].includes(event.key)
        ) {
          this.#cancelArcSelection();
        }
      },
      { capture: true },
    );
    gURLBar.addEventListener("pointerdown", (event) => {
      this.#cancelArcSelection();
      if (event.button === 0 && !gURLBar.view?.isOpen &&
          event.target.closest?.(".urlbar-input-container") &&
          !event.target.closest?.("button, .identity-box-button, .urlbar-page-action")) {
        const rect = gURLBar.getBoundingClientRect();
        this.#sidebarAnchor = { left: rect.left, top: rect.top };
      }
    }, { capture: true });
    window.addEventListener("unload", () => this.#cancelArcSelection(), {
      once: true,
    });

    window.addEventListener("Zen:UrlbarSearchModeChanged", (event) => {
      this.#onSearchModeChanged(event);
      this.#updateSiteSearchChip(event.detail.searchMode);
    });
    gURLBar.addEventListener("keydown", (event) => this.#onTabToSearch(event), {
      capture: true,
    });
  }

  get #newtabButtons() {
    return gNavToolbox.querySelectorAll("#tabs-newtab-button");
  }

  // Section: new tab replacement

  /**
   * Whether closeSeq is the URL bar session currently replacing a new tab.
   *
   * @param {number} closeSeq
   * @returns {boolean}
   */
  isOwner(closeSeq) {
    return this.#owner === closeSeq;
  }

  /**
   * Opens the floating URL bar instead of a new tab when the preference
   * allows it.
   *
   * @param {boolean} werePassedURL - Whether the new tab already has a URL.
   * @param {boolean} searchClipboard - Whether the clipboard is being searched.
   * @param {string} where - Where the tab would open ("tab", "window", ...).
   * @param {boolean} [overridePreferance] - Open regardless of the preference.
   * @param {object} [closeToken] - Receives the session id for matchesCloseToken.
   * @returns {boolean} Whether the URL bar handled the new tab.
   */
  handleNewTab(
    werePassedURL,
    searchClipboard,
    where,
    overridePreferance = false,
    closeToken = {},
  ) {
    // Keep this here. It's better to make sure every
    // call has a different token rather then forgetting
    // to increment it in one of the early returns.
    const closeSeq = ++this.#sessionCounter;
    closeToken.id = closeSeq;

    if (gZenUIManager.testingEnabled && !overridePreferance) {
      return false;
    }

    if (document.documentElement.hasAttribute("zen-welcome-stage")) {
      return false;
    }

    const shouldOpenURLBar =
      overridePreferance ||
      (gZenVerticalTabsManager._canReplaceNewTab &&
        !werePassedURL &&
        !searchClipboard &&
        where === "tab");

    if (!shouldOpenURLBar) {
      return false;
    }

    // Cmd+T can arrive while the sidebar editor is already open, without a
    // second popover-open notification. Start a centered new-tab session.
    this.#editorPreview = false;
    this.#sidebarAnchor = null;
    gURLBar.removeAttribute("zen-arc-url-editor");
    gURLBar.removeAttribute("zen-little-url-editor");

    // Close the new tab popup on cmd/ctrl + t
    if (!overridePreferance && gURLBar.hasAttribute("zen-newtab")) {
      // The _zenHandleUrlbarClose holds a token in it's closure.
      // Call that instead.
      if (gURLBar._zenHandleUrlbarClose) {
        gURLBar._zenHandleUrlbarClose();
      } else {
        this.handleUrlbarClose(closeSeq);
      }
      return true;
    }

    if (this.#clearTimeout) {
      clearTimeout(this.#clearTimeout);
      this.#clearTimeout = null;
    }

    this.#lastTab = gBrowser.selectedTab;
    if (!this.#lastTab) {
      console.warn("No selected tab found when creating new tab");
      return false;
    }

    // Arc keeps the active Favorite tile selected behind its new-tab picker.
    // Ordinary sidebar tabs still hand their visual selection to New Tab.
    if (!this.#lastTab.closing && !this.#lastTab.hasAttribute("zen-essential")) {
      this.#lastTab._visuallySelected = false;
    }

    this.#prevUrlbarLabel = gURLBar._untrimmedValue || "";

    gURLBar._zenHandleUrlbarClose = (onSwitch, onElementPicked) =>
      this.handleUrlbarClose(closeSeq, onSwitch, onElementPicked);
    this.#owner = closeSeq;
    gURLBar.setAttribute("zen-newtab", true);

    for (const button of this.#newtabButtons) {
      button.setAttribute("in-urlbar", true);
    }

    try {
      this.#showOpenTabsIfEmpty(false, this.#lastSearch || "");
      gURLBar.search(this.#lastSearch || "");
      document.getElementById("Browser:OpenLocation").doCommand();
    } catch (e) {
      console.error("Error opening location in new tab:", e);
      this.handleUrlbarClose(closeSeq, false, false);
      return false;
    }
    return true;
  }

  /**
   * Check whether the closeToken given by handleNewTab
   * corresponds to a close event.
   *
   * @param {object} closeToken - Token previously passed to handleNewTab.
   * @param {CustomEvent} event - A ZenURLBarClosed event.
   * @returns {boolean}
   */
  matchesCloseToken(closeToken, event) {
    return (
      typeof closeToken?.id === "number" &&
      event?.detail?.closeSeq === closeToken.id
    );
  }

  #clearSessionData() {
    this.#prevUrlbarLabel = null;
    this.#lastSearch = "";
  }

  /**
   * Closes the URL bar session started by handleNewTab and restores the tab
   * and URL bar state it replaced.
   *
   * @param {number} closeSeq - Session id from handleNewTab.
   * @param {boolean} [onSwitch] - Closing because the user switched tabs.
   * @param {boolean} [onElementPicked] - Closing because a result was picked.
   */
  handleUrlbarClose(closeSeq, onSwitch = false, onElementPicked = false) {
    if (gURLBar._zenHandleUrlbarClose) {
      gURLBar._zenHandleUrlbarClose = null;
    }

    const isFocusedBefore = gURLBar.focused;
    setTimeout(() => {
      /* If someone else opened the url bar in the meantime don't be
       * stingy and leave it open for them.*/
      if (this.isOwner(closeSeq)) {
        // We use this attribute on Tabbrowser::addTab
        gURLBar.removeAttribute("zen-newtab");

        const lastTab = this.#lastTab;
        if (
          lastTab &&
          !lastTab.closing &&
          lastTab.documentGlobal &&
          !lastTab.documentGlobal.closed &&
          gBrowser.selectedTab === lastTab
        ) {
          lastTab._visuallySelected = true;
          this.#lastTab = null;
        }

        for (const button of this.#newtabButtons) {
          button.removeAttribute("in-urlbar");
        }

        if (onSwitch) {
          this.#clearSessionData();
        } else {
          this.#lastSearch = gURLBar._untrimmedValue || "";
          if (this.#clearTimeout) {
            clearTimeout(this.#clearTimeout);
          }
          this.#clearTimeout = setTimeout(
            () => this.#clearSessionData(),
            this.waitToClear,
          );
        }

        if (this.#prevUrlbarLabel) {
          gURLBar.setURI({
            uri: this.#prevUrlbarLabel,
            dueToTabSwitch: onSwitch,
            isSameDocument: !onSwitch,
          });
        }

        gURLBar.handleRevert();
      }

      if (isFocusedBefore) {
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("ZenURLBarClosed", {
              detail: { onSwitch, onElementPicked, closeSeq },
            }),
          );

          if (!this.isOwner(closeSeq)) {
            return;
          }
          this.#owner = null;

          gURLBar.view.close({ elementPicked: onElementPicked });
          gURLBar.updateTextOverflow();

          if (onElementPicked && onSwitch) {
            gURLBar.setURI({ dueToTabSwitch: onSwitch });
          }

          const selectedTab = gBrowser.selectedTab;
          if (
            selectedTab &&
            selectedTab.linkedBrowser &&
            !selectedTab.closing &&
            onSwitch
          ) {
            const browserState = gURLBar.getBrowserState(
              selectedTab.linkedBrowser,
            );
            if (browserState) {
              browserState.urlbarFocused = false;
            }
          }
        }, 0);
      } else if (this.isOwner(closeSeq)) {
        this.#owner = null;
      }
    }, 0);
  }

  // Section: open and close

  onUrlbarOpen() {
    const edit = !window._zenLittleWindow && !gURLBar.hasAttribute("zen-newtab") &&
      gURLBar.focusedViaMousedown && gZenVerticalTabsManager._hasSetSingleToolbar;
    const littleEdit = window._zenLittleWindow && !window._zenLittleWindowInput &&
      !gURLBar.hasAttribute("zen-newtab");
    gURLBar.toggleAttribute("zen-arc-url-editor", edit);
    gURLBar.toggleAttribute("zen-little-url-editor", littleEdit);
    this.#editorPreview = edit || littleEdit;
    if (edit) {
      const rect = this.#sidebarAnchor || document.getElementById("nav-bar").getBoundingClientRect();
      gURLBar.style.setProperty("--arc-url-editor-left", `${Math.max(8, rect.left)}px`);
      gURLBar.style.setProperty("--arc-url-editor-top", `${Math.max(8, rect.top)}px`);
    }
    if (edit || littleEdit) {
      const icon = gBrowser.selectedTab?.image;
      gURLBar.style.setProperty("--arc-url-editor-icon", icon ? `url(${JSON.stringify(icon)})` : 'url("chrome://global/skin/icons/defaultFavicon.svg")');
    }
    this.#sidebarAnchor = null;
    if (
      gZenVerticalTabsManager._hasSetSingleToolbar &&
      this.showDomainOnly &&
      !gURLBar.hasAttribute("zen-newtab") &&
      !gURLBar.valueIsTyped &&
      !gURLBar.searchMode &&
      gURLBar.getAttribute("pageproxystate") === "valid"
    ) {
      // Firefox's prefix-only untrim flags do not describe a host-only label.
      // Restore the actual page address synchronously, before typing can begin.
      // displaySpec keeps escaped path/query bytes and Gecko's IDN policy;
      // createExposableURI keeps credentials out of the address editor.
      try {
        const uri = Services.io.createExposableURI(gBrowser.selectedBrowser.currentURI);
        if (uri.schemeIs("http") || uri.schemeIs("https")) {
          gURLBar.setValue(uri.displaySpec, { allowTrim: false, valueIsTyped: false });
          gURLBar.setSelectionRange(0, gURLBar.value.length);
        }
      } catch {
        // Keep the existing editor value if the selected page has no usable URI.
      }
    }
    setTimeout(() => {
      // A fast Escape/blur can close the bar before this callback runs.
      if (!gURLBar.view?.isOpen) {
        return;
      }
      const hadValid = gURLBar.getAttribute("pageproxystate") === "valid";
      if (!this.#editorPreview) {
        gURLBar.setPageProxyState("invalid", false);
      }
      gURLBar.setAttribute("had-proxystate", hadValid);
      this.#ensureSearchInfo();
      this.#showOpenTabsIfEmpty(true, this.#editorPreview ? "" : gURLBar.value);
    }, 0);
  }

  onUrlbarClose() {
    this.#editorPreview = false;
    this.#sidebarAnchor = null;
    gURLBar.removeAttribute("zen-arc-url-editor");
    gURLBar.removeAttribute("zen-little-url-editor");
    for (const name of ["left", "top", "icon"]) {
      gURLBar.style.removeProperty(`--arc-url-editor-${name}`);
    }
    if (gURLBar.getAttribute("had-proxystate") == "true") {
      gURLBar.setPageProxyState("valid", false);
    }
    gURLBar.removeAttribute("had-proxystate");
    this.#arcSearchInfo?.hide();
    this.#leaveOpenTabsMode();
  }

  #ensureSearchInfo() {
    const dismissed = Services.prefs.getBoolPref(
      "zen.urlbar.search-info.dismissed",
      false,
    );
    gURLBar.toggleAttribute("zen-search-info-dismissed", dismissed);
    if (dismissed) {
      this.#arcSearchInfo?.hide();
      return;
    }
    if (this.#arcSearchInfo) {
      return;
    }
    const make = (tag, id, l10n) => {
      const element = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        tag,
      );
      element.id = id;
      if (l10n) document.l10n.setAttributes(element, l10n);
      if (tag === "button") element.type = "button";
      return element;
    };
    const button = make(
      "button",
      "zen-urlbar-search-info",
      "zen-urlbar-search-info",
    );
    const panel = make("div", "zen-urlbar-search-info-panel");
    const text = make(
      "span",
      "zen-urlbar-search-info-description",
      "zen-urlbar-search-info-description",
    );
    const settings = make(
      "button",
      "zen-urlbar-search-settings",
      "zen-urlbar-search-settings",
    );
    const dismiss = make(
      "button",
      "zen-urlbar-search-info-dismiss",
      "zen-urlbar-search-info-dismiss",
    );
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-labelledby", text.id);
    panel.append(text, settings, dismiss);
    button.setAttribute("aria-controls", panel.id);
    const show = (visible) => {
      panel.hidden = !visible;
      button.setAttribute("aria-expanded", String(visible));
      gURLBar.toggleAttribute("zen-search-info-open", visible);
    };
    show(false);
    button.addEventListener("click", () => show(panel.hidden));
    dismiss.addEventListener("click", () => {
      Services.prefs.setBoolPref("zen.urlbar.search-info.dismissed", true);
      gURLBar.setAttribute("zen-search-info-dismissed", "true");
      show(false);
      gURLBar.inputField.focus();
    });
    settings.addEventListener("click", () => {
      gURLBar.view.close();
      window.openPreferences("paneSearch");
    });
    for (const control of [button, panel]) {
      // Pointer activation keeps the input focused. Keyboard users can focus
      // the real buttons without triggering result navigation on Enter.
      control.addEventListener("mousedown", (event) => event.preventDefault());
      control.addEventListener("click", (event) => event.stopPropagation());
      control.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          show(false);
          gURLBar.inputField.focus();
        }
      });
      control.addEventListener("keyup", (event) => event.stopPropagation());
    }
    // Native UrlbarInput otherwise closes its view when focus moves from the
    // input to an information control within the same command bar.
    gURLBar.addEventListener(
      "blur",
      (event) => {
        if (
          event.relatedTarget === button ||
          panel.contains(event.relatedTarget)
        ) {
          event.stopImmediatePropagation();
        }
      },
      { capture: true },
    );
    gURLBar.append(button, panel);
    gURLBar.setAttribute("zen-search-info-ready", "true");
    this.#arcSearchInfo = { hide: () => show(false) };
  }

  #setArcPlaceholder() {
    if (
      gURLBar.inputField &&
      (!gURLBar.searchMode || this.#ownsOpenTabsMode())
    ) {
      document.l10n.setAttributes(
        gURLBar.inputField,
        "zen-singletoolbar-urlbar-placeholder-with-name",
      );
    }
  }

  /**
   * Arc's empty command bar lists open tabs by recency and preselects the
   * first row. Firefox would show top sites / history instead.
   */
  #showOpenTabsIfEmpty(startQuery = true, value = gURLBar.value) {
    this.#setArcPlaceholder();
    if ((value || "").trim()) {
      this.#leaveOpenTabsMode();
      return;
    }
    if (this.#ownsOpenTabsMode() || gURLBar.searchMode) {
      return;
    }
    this.#arcTabsMode = true;
    this.#arcSelectionPending = true;
    gURLBar.setAttribute("zen-arc-open-tabs", "true");
    // Keep the address editor's URL intact. Local search mode clears the
    // input, so the recent-tab provider recognizes this preview explicitly.
    if (!this.#editorPreview && !window._zenLittleWindow) {
      gURLBar.searchMode = {
        source: UrlbarShared.RESULT_SOURCE.TABS,
        isPreview: true,
      };
    }
    if (startQuery) {
      gURLBar.startQuery({ allowAutofill: false });
    }
  }

  #ownsOpenTabsMode() {
    const mode = gURLBar.searchMode;
    return (
      this.#arcTabsMode &&
      (((this.#editorPreview || window._zenLittleWindow) && !mode) ||
        (mode?.source === UrlbarShared.RESULT_SOURCE.TABS && !mode.engineName))
    );
  }

  #cancelArcSelection() {
    this.#arcSelectionPending = false;
    if (this.#arcSelectionFrame) {
      window.cancelAnimationFrame(this.#arcSelectionFrame);
      this.#arcSelectionFrame = 0;
    }
  }

  #leaveOpenTabsMode() {
    const ownsMode = this.#ownsOpenTabsMode();
    this.#arcTabsMode = false;
    this.#cancelArcSelection();
    gURLBar.removeAttribute("zen-arc-open-tabs");
    if (ownsMode) {
      // Clearing a temporary preview is part of ordinary typing, not a
      // deliberate search-mode switch. Its null-mode notification is
      // synchronous; suppress only that transition's scale animation.
      this.#clearingArcTabsMode = true;
      try {
        gURLBar.searchMode = null;
      } finally {
        this.#clearingArcTabsMode = false;
      }
    }
  }

  #applyArcSelection(context) {
    const view = gURLBar.view;
    if (
      !this.#arcSelectionPending ||
      !this.#ownsOpenTabsMode() ||
      (!this.#editorPreview && (gURLBar.value || "").trim()) ||
      !view?.isOpen ||
      !view.visibleRowCount ||
      view.queryContext !== context
    ) {
      return false;
    }
    if (view.selectedRowIndex < 0) {
      view.zenSelectDefaultResult();
    }
    return true;
  }

  #preselectFirstRow(context) {
    if (
      !this.#arcSelectionPending ||
      !this.#ownsOpenTabsMode() ||
      context?.searchString?.trim()
    ) {
      return;
    }
    // The view listener normally runs first. Select immediately when ready,
    // avoiding a blank frame and background-window rAF throttling. If opening
    // is still asynchronous, retry once at paint. Never paint fake selected
    // attributes: the view owns keyboard selection and accessibility state.
    if (this.#applyArcSelection(context) || this.#arcSelectionFrame) {
      return;
    }
    this.#arcSelectionFrame = window.requestAnimationFrame(() => {
      this.#arcSelectionFrame = 0;
      this.#applyArcSelection(context);
    });
    // Keep the default pending across batches that rebuild the result rows;
    // keyboard/pointer interaction, typing and closing cancel it instead.
  }

  // Section: search mode

  #onSearchModeChanged(event) {
    if (this.#clearingArcTabsMode || this.#ownsOpenTabsMode() || gReduceMotion) {
      return;
    }
    const { searchMode } = event.detail;
    if (!gURLBar.hasAttribute("breakout-extend") || this.#animatingSearchMode) {
      return;
    }
    this.#animatingSearchMode = true;
    gZenUIManager.motion
      .animate(gURLBar, { scale: [1, 0.98, 1] }, { duration: 0.25 })
      .then(() => {
        this.#animatingSearchMode = false;
      });
    if (searchMode) {
      gURLBar.setAttribute("animate-searchmode", "true");
      this.#animatingSearchModeTimeout = setTimeout(() => {
        requestAnimationFrame(() => {
          gURLBar.removeAttribute("animate-searchmode");
          this.#animatingSearchModeTimeout = null;
        });
      }, SEARCH_MODE_ANIMATION_RESET_MS);
    }
  }

  /**
   * Tab on a site search's alias (or a domain autofilled to it) enters that
   * engine's search mode and clears the input, like Arc's site search.
   *
   * @param {KeyboardEvent} event
   */
  #onTabToSearch(event) {
    if (
      event.key != "Tab" ||
      event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.isComposing ||
      !Services.prefs.getBoolPref("zen.urlbar.tab-to-search", true) ||
      (gURLBar.searchMode && !gURLBar.searchMode.isPreview)
    ) {
      return;
    }
    const engine = this.siteSearchEngineFor(gURLBar.value);
    if (!engine) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.#leaveOpenTabsMode();
    gURLBar.searchMode = {
      engineName: engine.name,
      entry: "tabtosearch",
      isPreview: false,
    };
    gURLBar.search("", { searchModeEntry: "tabtosearch" });
  }

  /**
   * @param {string} value - The URL bar's text, including any autofill.
   * @returns {?object} The engine with an alias equal to the value, ignoring
   *   case, the scheme, "www." and trailing slashes.
   */
  siteSearchEngineFor(value) {
    const store = gURLBar.controller?.engineStore;
    const typed = value
      .trim()
      .toLowerCase()
      .replace(/^[a-z]+:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "");
    if (!store?.initialized || !typed || /\s/.test(typed)) {
      return null;
    }
    return (
      store
        .getEngines()
        .find((e) => e.aliases.some((alias) => alias.toLowerCase() == typed)) ??
      null
    );
  }

  /**
   * Paints the search mode chip with the engine's icon and colour: the
   * `zen.urlbar.site-search.colors` entry for its name or first alias, or
   * else its icon's dominant colour.
   *
   * @param {?object} searchMode
   */
  async #updateSiteSearchChip(searchMode) {
    const store = gURLBar.controller?.engineStore;
    const engine =
      searchMode?.engineName && store?.getEngineByName(searchMode.engineName);
    this.#siteSearchChipEngine = engine || null;
    if (!engine) {
      gURLBar.removeAttribute("zen-site-search");
      gURLBar.style.removeProperty("--zen-site-search-color");
      this.#siteSearchChipIcon.hidden = true;
      return;
    }
    const colors = new Map(
      Services.prefs
        .getStringPref("zen.urlbar.site-search.colors", "")
        .split(",")
        .map((entry) => entry.split("=").map((part) => part.trim()))
        .filter(([key, value]) => key && value),
    );
    const iconURL = await engine.getIconURL();
    const color =
      colors.get(engine.name) ??
      colors.get(engine.aliases[0]) ??
      (iconURL ? await this.#dominantColor(iconURL) : null);
    if (this.#siteSearchChipEngine != engine) {
      return;
    }
    gURLBar.setAttribute("zen-site-search", "true");
    if (color) {
      gURLBar.style.setProperty("--zen-site-search-color", color);
    } else {
      gURLBar.style.removeProperty("--zen-site-search-color");
    }
    const icon = this.#siteSearchChipIcon;
    icon.src = iconURL ?? "";
    icon.hidden = !iconURL;
  }

  /**
   * The engine icon at the start of the search mode chip, created on first use.
   *
   * @returns {HTMLImageElement}
   */
  get #siteSearchChipIcon() {
    let icon = document.getElementById("zen-site-search-chip-icon");
    if (!icon) {
      icon = document.createElementNS("http://www.w3.org/1999/xhtml", "img");
      icon.id = "zen-site-search-chip-icon";
      icon.setAttribute("role", "presentation");
      icon.hidden = true;
      document.getElementById("urlbar-search-mode-indicator").prepend(icon);
    }
    return icon;
  }

  /**
   * The most frequent colour in an icon, weighted towards saturated pixels
   * and ignoring transparent and near-white ones.
   *
   * @param {string} url
   * @returns {Promise<?string>} A CSS colour, or null if the icon is blank.
   */
  async #dominantColor(url) {
    if (this.#iconColors.has(url)) {
      return this.#iconColors.get(url);
    }
    let color = null;
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const size = 32;
      const canvas = document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "canvas",
      );
      canvas.width = canvas.height = size;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, size, size);
      const { data } = context.getImageData(0, 0, size, size);
      const buckets = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b, a] = data.subarray(i, i + 4);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (a < 128 || min > 230) {
          continue;
        }
        const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
        const bucket = buckets.get(key) ?? {
          weight: 0,
          n: 0,
          r: 0,
          g: 0,
          b: 0,
        };
        bucket.weight += 1 + (2 * (max - min)) / (max || 1);
        bucket.n++;
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
        buckets.set(key, bucket);
      }
      let best = null;
      for (const bucket of buckets.values()) {
        if (!best || bucket.weight > best.weight) {
          best = bucket;
        }
      }
      if (best) {
        const channel = (c) => Math.round(c / best.n);
        color = `rgb(${channel(best.r)}, ${channel(best.g)}, ${channel(best.b)})`;
      }
    } catch (e) {
      console.warn("Zen: couldn't read a search engine icon's colour", e);
    }
    this.#iconColors.set(url, color);
    return color;
  }

  /**
   * Switches the floating URL bar into Zen's commands search mode.
   *
   * @param {Event} event - The keyboard event that requested commands mode.
   */
  enableCommandsMode(event) {
    event.preventDefault();
    if (!gURLBar.hasAttribute("breakout-extend") || this.#animatingSearchMode) {
      return;
    }
    const currentSearchMode = gURLBar.getSearchMode(gBrowser.selectedBrowser);
    let searchMode = null;
    if (!currentSearchMode) {
      searchMode = {
        source: UrlbarShared.RESULT_SOURCE.ZEN_ACTIONS,
        isPreview: true,
      };
    }
    gURLBar.removeAttribute("animate-searchmode");
    if (this.#animatingSearchModeTimeout) {
      clearTimeout(this.#animatingSearchModeTimeout);
      this.#animatingSearchModeTimeout = null;
    }
    gURLBar.searchMode = searchMode;
    gURLBar.startQuery({
      allowAutofill: false,
      event,
    });
  }

  // Section: URL display and link handling

  /**
   * Trims the URL shown in the URL bar. In the single toolbar layout only
   * the domain is shown unless the URL bar is expanded.
   *
   * @param {string} aURL
   * @returns {string}
   */
  trimURL(aURL) {
    if (gURLBar.hasAttribute("breakout-extend")) {
      return aURL;
    }
    if (gZenVerticalTabsManager._hasSetSingleToolbar && this.showDomainOnly) {
      const url = BrowserUIUtils.removeSingleTrailingSlashFromURL(aURL);
      try {
        const uri = Services.io.newURI(url);
        if (uri.schemeIs("http") || uri.schemeIs("https")) {
          // Match Arc's compact host label without credentials, port, path or
          // query. Gecko's displayHost retains its IDN display protections.
          // The expanded editor still receives the complete original URL.
          return uri.displayHost.replace(/^www\./, "");
        }
      } catch {
        // Partially entered or non-URI text keeps its existing display.
      }
      return url;
    }
    return BrowserUIUtils.trimURL(aURL);
  }

  #urlStringsDomainMatch(url1, url2) {
    if (!url1.startsWith("http") || !url2?.startsWith("http")) {
      return false;
    }
    return Services.io.newURI(url1).host === Services.io.newURI(url2).host;
  }

  /**
   * Opens links to other domains from a pinned tab in a new tab, when the
   * preference asks for it.
   *
   * @param {string} url - The URL about to load.
   * @param {MozBrowser} browser - The browser the load was requested in.
   * @param {string} openUILinkWhere - Firefox's choice of where to open.
   * @returns {string} Where the link should open.
   */
  getOpenUILinkWhere(url, browser, openUILinkWhere) {
    try {
      const tab = gBrowser.getTabForBrowser(browser);
      if (
        openUILinkWhere === "current" &&
        !this.#urlStringsDomainMatch(url, browser.currentURI.spec) &&
        tab.pinned &&
        Services.prefs.getBoolPref("zen.tabs.open-pinned-in-new-tab")
      ) {
        return "tab";
      }
    } catch (e) {
      console.error("Error in getOpenUILinkWhere:", e);
    }
    return openUILinkWhere;
  }
}
