/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";

const ADDONS_BUTTONS_HIDDEN = Services.prefs.getBoolPref(
  "zen.theme.hide-unified-extensions-button",
  true
);

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  FeatureCallout: "resource:///modules/asrouter/FeatureCallout.sys.mjs",
  gZenBoostsManager: "resource:///modules/zen/boosts/ZenBoostsManager.sys.mjs",
  ZenWindowCapture: "resource:///modules/ZenWindowCapture.sys.mjs",
  ZenAutoPictureInPicture: "resource:///modules/ZenAutoPictureInPicture.sys.mjs",
});

export class nsZenSiteDataPanel {
  #fullPageCapture;
  #portionCaptures = new WeakSet();
  #iconMap = {
    install: "extension",
    "site-protection": "shield",
    "3rdPartyStorage": "cookie",
  };

  constructor(window) {
    this.window = window;
    this.document = window.document;
    // Little windows have a dedicated Extensions control, independent of the
    // sidebar preference that combines extensions with site controls.
    this.hideAddonsButton = ADDONS_BUTTONS_HIDDEN && !window._zenLittleWindow;

    this.unifiedPanel = this.#initUnifiedPanel();
    this.unifiedPanelView = window._zenLittleWindow
      ? "zen-little-unused-unified-extensions-view"
      : "unified-extensions-view";
    this.extensionsPanelView = window._zenLittleWindow
      ? "unified-extensions-view"
      : "original-unified-extensions-view";

    if (this.hideAddonsButton) {
      this.window.gUnifiedExtensions._panel = this.unifiedPanel;

      // Remove the old permissions dialog
      this.document
        .getElementById("unified-extensions-panel-template")
        ?.remove();
    } else {
      this.extensionsPanel = this.#initExtensionsPanel();
    }

    this.#init();
  }

  #init() {
    // Add a new button to the urlbar popup
    const button = this.window.MozXULElement.parseXULToFragment(`
      <box id="zen-site-data-icon-button" role="button" align="center" class="identity-box-button" delegatesanchor="true">
        <image />
        <box class="zen-site-data-boost-animation"><box class="zen-site-data-boost-strip"/></box>
      </box>
    `);
    this.anchor = button.querySelector("#zen-site-data-icon-button");
    this.document.getElementById("identity-icon-box").before(button);

    this.extensionsPanelButton = this.document.getElementById(
      "unified-extensions-button"
    );
    this.window.gUnifiedExtensions._button = this.hideAddonsButton
      ? this.anchor
      : this.extensionsPanelButton;

    this.document
      .getElementById("nav-bar")
      .setAttribute("addon-webext-overflowbutton", "zen-site-data-icon-button");

    this.#initCopyUrlButton();
    this.#initEventListeners();
    this.#initBrowserListeners();
    this.#initUnifiedExtensionsManageHook();
    this.#maybeShowFeatureCallout();
  }

  #initEventListeners() {
    this.window.addEventListener("keydown", this, true);
    this.unifiedPanel.addEventListener("popupshowing", this);
    const syncAppearance = event => {
      if (event.target !== this.unifiedPanel) return;
      const { syncNativePopupAppearance } = ChromeUtils.importESModule(
        "resource:///modules/zen/ZenNativeTheme.sys.mjs"
      );
      void syncNativePopupAppearance(this.window, this.unifiedPanel);
    };
    this.unifiedPanel.addEventListener("popupshown", syncAppearance);
    // On the first opening, popupshown can precede creation of the native
    // popover (its screen bounds are still empty). Synchronize when Gecko
    // reports the actual position, including extension-grid resizing.
    this.unifiedPanel.addEventListener("popuppositioned", syncAppearance);
    this.document
      .getElementById("zen-site-data-manage-addons")
      .addEventListener("click", this);
    this.document
      .getElementById("zen-site-data-settings-more")
      .addEventListener("click", this);
    this.anchor.addEventListener("click", this);
    const kCommandIDs = [
      "zen-site-data-header-share",
      "zen-site-data-header-capture-portion",
      "zen-site-data-header-capture-full-page",
      "zen-site-data-security-info",
      "zen-site-data-header-boost",
      "zen-site-data-actions",
      "zen-site-data-new-addon-button",
    ];

    for (let id of kCommandIDs) {
      this.document.getElementById(id).addEventListener("command", this);
    }

    this.#initContextMenuEventListener();
  }

  #initBrowserListeners() {
    Services.obs.addObserver(this, "zen-boosts-update");
    this.window.gBrowser.addProgressListener({
      onLocationChange: aWebProgress => {
        if (aWebProgress.isTopLevel) {
          this.checkIfTabIsBoosted();
        }
      },
    });
    this.window.addEventListener(
      "unload",
      () => {
        Services.obs.removeObserver(this, "zen-boosts-update");
        this.#fullPageCapture?.destroy();
        this.window.removeEventListener("keydown", this, true);
      },
      { once: true }
    );
  }

  observe(subject, topic) {
    switch (topic) {
      case "zen-boosts-update":
        this.checkIfTabIsBoosted();
        break;
    }
  }

  #getCurrentDomain() {
    try {
      return this.window.gBrowser.currentURI.host;
    } catch {
      return "";
    }
  }

  checkIfTabIsBoosted() {
    const domain = this.#getCurrentDomain();
    const isBoosted = lazy.gZenBoostsManager.registeredBoostForDomain(domain);
    if (isBoosted) {
      this.anchor.setAttribute("boosting", "true");
    } else {
      this.anchor.removeAttribute("boosting");
    }
    // Force a reflow to ensure the attribute change is applied before any potential animation.
    if (this.unifiedPanel.state === "open") {
      this.anchor.getBoundingClientRect();
    }
  }

  #initCopyUrlButton() {
    // This function is a bit out of place, but it's related enough to the panel
    // that it's easier to do it here than in a separate module.
    const container = this.document.getElementById("page-action-buttons");
    const fragment = this.window.MozXULElement.parseXULToFragment(`
      <hbox id="zen-copy-url-button"
            class="urlbar-page-action"
            role="button"
            data-l10n-id="zen-urlbar-copy-url-button"
            disabled="true">
        <image class="urlbar-icon"/>
      </hbox>
    `);
    container.after(fragment);

    const aElement = this.document.getElementById("zen-copy-url-button");
    aElement.addEventListener("click", () => {
      if (aElement.hasAttribute("disabled")) {
        return;
      }
      this.document.getElementById("cmd_zenCopyCurrentURL").doCommand();
    });

    this.window.gBrowser.addProgressListener({
      onLocationChange: (aWebProgress, aRequest, aLocation) => {
        if (aWebProgress.isTopLevel) {
          const disabled = !this.#canCopyUrl(aLocation);
          if (disabled) {
            aElement.setAttribute("disabled", true);
          } else {
            aElement.removeAttribute("disabled");
          }
        }
      },
    });
  }

  #initContextMenuEventListener() {
    const kCommands = {
      context_zenClearSiteData: event => {
        this.window.gIdentityHandler.clearSiteData(event);
      },
      context_zenOpenGetAddons: () => {
        this.#openGetAddons();
      },
      context_zenOpenSiteSettings: () => {
        const { BrowserCommands } = this.window;
        BrowserCommands.pageInfo(null, "permTab");
      },
      context_zenTrackingProtection: event => {
        const item = event.currentTarget;
        const browser = this.window.gBrowser.selectedBrowser;
        if (item.disabled || browser !== item._siteBrowser ||
            browser.browsingContext.currentWindowGlobal?.innerWindowId !== item._siteDocumentId) return;
        const protections = this.window.gProtectionsHandler;
        if (protections.hasException) protections.enableForCurrentPage();
        else protections.disableForCurrentPage();
      },
    };

    for (let [id, handler] of Object.entries(kCommands)) {
      this.document.getElementById(id).addEventListener("command", handler);
    }
    const popup = this.document.getElementById("zenSiteDataActions");
    popup.addEventListener("popupshowing", event => {
      if (event.target !== popup) return;
      const protections = this.document.getElementById("context_zenTrackingProtection");
      const browser = this.window.gBrowser.selectedBrowser;
      protections._siteBrowser = browser;
      protections._siteDocumentId = browser.browsingContext.currentWindowGlobal?.innerWindowId;
      protections.disabled = !this.#canCopyUrl(browser.currentURI);
      protections.setAttribute("checked", String(!this.window.gProtectionsHandler.hasException));
    });
  }

  #initUnifiedExtensionsManageHook() {
    const manageExtensionItem = this.document.getElementById(
      "unified-extensions-context-menu-manage-extension"
    );

    manageExtensionItem.addEventListener("command", () => {
      this.unifiedPanel.hidePopup();
    });
  }

  #initExtensionsPanel() {
    const panel = this.window.gUnifiedExtensions.panel;

    const extensionsView = panel?.querySelector("#unified-extensions-view");
    extensionsView.setAttribute("id", this.extensionsPanelView);

    const panelMultiView = panel?.querySelector("panelmultiview");
    panelMultiView.setAttribute("mainViewId", this.extensionsPanelView);

    return panel;
  }

  #initUnifiedPanel() {
    const panel = this.document.getElementById("zen-unified-site-data-panel");
    if (this.window._zenLittleWindow) {
      // Register only the dedicated extension area in a Little window. The
      // combined panel otherwise claims its widgets first and leaves the
      // visible extension panel empty. Its duplicate IDs also shadow the
      // dedicated panel in Gecko's document-level lookups.
      for (const node of panel.querySelectorAll(
        '[id^="unified-extensions-"], #overflowed-extensions-list'
      )) {
        node.id = "zen-little-unused-" + node.id;
      }
      panel.querySelector("panelmultiview").setAttribute(
        "mainViewId",
        "zen-little-unused-unified-extensions-view"
      );
      return panel;
    }
    this.window.gUnifiedExtensions.initializePanel(panel);
    return panel;
  }

  #preparePanel() {
    this.#resetSiteOptionsList();
    this.#setSiteBoost();
    this.#setSitePermissions();
    this.#setSiteSecurityInfo();
    this.#setSiteHeader();
    this.#setAddonsOverflow();
  }

  #setSiteBoost() {
    const domain = this.#getCurrentDomain();
    const uri = this.window.gBrowser.currentURI;
    const canBoostSite = Services.prefs.getBoolPref("zen.boosts.enabled", true) &&
      lazy.gZenBoostsManager.canBoostSite(uri);

    const list = this.document.getElementById("zen-site-data-boost-list");
    const section = list.closest(".zen-site-data-section");
    section.hidden = true;

    const boostButton = this.document.getElementById("zen-site-data-header-boost");
    if (!canBoostSite) {
      boostButton.removeAttribute("boosting");
      boostButton.setAttribute("disabled", "true");
      return;
    }

    boostButton.removeAttribute("disabled");

    if (lazy.gZenBoostsManager.registeredBoostForDomain(domain)) {
      boostButton.setAttribute("boosting", "true");
    } else {
      boostButton.removeAttribute("boosting");
    }

    /* Boosts panel */

    const boosts = lazy.gZenBoostsManager.loadBoostsFromStore(domain);
    let validBoostCount = 0;

    if (boosts) {
      const activeBoostId = lazy.gZenBoostsManager.getActiveBoostId(domain);
      boosts.forEach(boost => {
        const boostData = boost.boostEntry.boostData;
        if (!boostData.changeWasMade) {
          return;
        }
        validBoostCount++;

        const enabled = boost.id === activeBoostId;
        list.appendChild(
          this.#createBoostPanelItem(
            "boost-brush",
            boostData.boostName,
            "zen-site-data-toggle-boost",
            boost,
            enabled
          )
        );
      });
    }
    section.hidden = validBoostCount === 0;
  }

  #updateSiteBoost() {
    const boostList = this.document.getElementById("zen-site-data-boost-list");
    boostList.innerHTML = "";

    this.#setSiteBoost();
  }

  #createBoostPanelItem(
    iconClass,
    title,
    actionId,
    boost = null,
    enabled = false
  ) {
    const container = this.document.createXULElement("hbox");
    container.classList.add("permission-popup-boost-item");

    container.setAttribute("align", "center");
    container.setAttribute("role", "group");
    container.setAttribute("data-action-id", actionId);
    container.setAttribute("state", "enabled");

    if (boost) {
      container.setAttribute("data-boost-id", boost.id);
      container.setAttribute("state", enabled ? "enabled" : "disabled");
    }

    const img = this.document.createXULElement("toolbarbutton");
    img.classList.add(
      "permission-popup-boost-icon",
      "zen-site-data-boost-icon"
    );
    img.setAttribute("closemenu", "none");
    img.classList.add(iconClass);

    const labelContainer = this.document.createXULElement("vbox");
    labelContainer.setAttribute("flex", "1");
    labelContainer.setAttribute("align", "start");
    labelContainer.classList.add("permission-popup-boost-label-container");

    const nameLabel = this.document.createXULElement("label");
    nameLabel.setAttribute("flex", "1");
    nameLabel.setAttribute("class", "permission-popup-boost-label");
    nameLabel.textContent = title || "";
    labelContainer.appendChild(nameLabel);

    const stateLabel = this.document.createXULElement("label");
    stateLabel.setAttribute("class", "zen-permission-popup-boost-state-label");
    const stateLabelId = enabled
      ? "zen-site-data-protections-enabled"
      : "zen-site-data-protections-disabled";
    this.document.l10n.formatMessages([stateLabelId]).then(([labelContent]) => {
      stateLabel.textContent = labelContent.value;
    });
    labelContainer.appendChild(stateLabel);

    container.appendChild(img);
    container.appendChild(labelContainer);

    if (boost) {
      const editorButton = this.document.createXULElement("toolbarbutton");
      editorButton.setAttribute("data-action-id", "zen-site-data-edit-boost");
      editorButton.setAttribute("data-boost-id", boost.id);
      editorButton.classList.add("zen-permission-popup-boost-editor-button");
      container.appendChild(editorButton);

      editorButton.addEventListener("click", event => {
        event.stopPropagation(); // Prevents the container event
        this.#onBoostClick(event);
      });
    }

    container.addEventListener("click", this.#onBoostClick.bind(this));

    return container;
  }

  #setAddonsOverflow() {
    const addons = this.document.getElementById("zen-site-data-addons");
    if (addons.getBoundingClientRect().height > 420) {
      addons.setAttribute("overflowing", "true");
    } else {
      addons.removeAttribute("overflowing");
    }
  }

  #setSiteHeader() {
    const available = this.#canCopyUrl(this.window.gBrowser.currentURI);
    for (const id of [
      "zen-site-data-header-share",
      "zen-site-data-header-capture-portion",
      "zen-site-data-header-capture-full-page",
    ]) {
      this.document.getElementById(id).disabled = !available;
    }
  }

  async #copyFullPage() {
    const browser = this.window.gBrowser.selectedBrowser;
    this.#fullPageCapture?.destroy();
    const capture = this.#fullPageCapture = new lazy.ZenWindowCapture(this.window);
    this.unifiedPanel.hidePopup();
    let shot;
    try {
      shot = await capture.capture(browser, { fullPage: true });
      return shot ? await shot.copy() : false;
    } finally {
      shot?.close();
      capture.destroy();
      if (this.#fullPageCapture === capture) this.#fullPageCapture = null;
    }
  }

  async #reportCaptureError(error) {
    console.error("Page capture failed", error);
    if (this.window.closed) return;
    const [title, message] = await this.document.l10n.formatValues([
      { id: "zen-site-data-capture-error-title" },
      { id: "zen-site-data-capture-error-message" },
    ]);
    if (!this.window.closed) this.window.ScreenshotsUtils.showAlertMessage(title, message);
  }

  /**
   * Determines whether the copy URL button should be hidden for the given URI.
   *
   * @param {nsIURI} uri - The URI to check.
   * @returns {boolean} True if the button should be hidden, false otherwise.
   */
  #canCopyUrl(uri) {
    if (!uri) {
      return false;
    }

    return uri.scheme.startsWith("http");
  }

  #resetSiteOptionsList() {
    const settingsList = this.document.getElementById(
      "zen-site-data-settings-list"
    );
    settingsList.innerHTML = "";
    const boostList = this.document.getElementById("zen-site-data-boost-list");
    boostList.innerHTML = "";
  }

  #setSiteSecurityInfo() {
    const { gIdentityHandler } = this.window;
    const button = this.document.getElementById("zen-site-data-security-info");

    if (gIdentityHandler._isSecureInternalUI) {
      button.parentNode.hidden = true;
      return;
    }

    let identity;
    if (gIdentityHandler._pageExtensionPolicy) {
      this.document.l10n.setAttributes(
        button,
        "zen-site-data-security-info-extension"
      );
      identity = "extension";
    } else if (
      gIdentityHandler._uriHasHost &&
      gIdentityHandler._isSecureConnection &&
      !gIdentityHandler._isCertUserOverridden &&
      !gIdentityHandler._isCertErrorPage &&
      !gIdentityHandler._isAboutHttpsOnlyErrorPage
    ) {
      this.document.l10n.setAttributes(
        button,
        "zen-site-data-security-info-secure"
      );
      identity = "secure";
    } else {
      this.document.l10n.setAttributes(
        button,
        "zen-site-data-security-info-not-secure"
      );
      identity = "not-secure";
    }

    button.parentNode.hidden = false;
    button.setAttribute("identity", identity);
  }

  #setSitePermissions() {
    const { gBrowser, SitePermissions } = this.window;
    const list = this.document.getElementById("zen-site-data-settings-list");
    const section = list.closest(".zen-site-data-section");

    // show permission icons
    let permissions = SitePermissions.getAllPermissionDetailsForBrowser(
      gBrowser.selectedBrowser
    );

    // Don't display origin-keyed 3rdPartyStorage permissions that are covered by
    // site-keyed 3rdPartyFrameStorage permissions.
    let thirdPartyStorageSites = new Set(
      permissions
        .map(function (permission) {
          let [id, key] = permission.id.split(
            SitePermissions.PERM_KEY_DELIMITER
          );
          if (id == "3rdPartyFrameStorage" || id == "3rdPartyStorage") {
            return key;
          }
          return null;
        })
        .filter(function (key) {
          return key != null;
        })
    );
    permissions = permissions.filter(function (permission) {
      let [id, key] = permission.id.split(SitePermissions.PERM_KEY_DELIMITER);
      if (id != "3rdPartyStorage") {
        return true;
      }
      try {
        let origin = Services.io.newURI(key);
        let site = Services.eTLD.getSite(origin);
        return !thirdPartyStorageSites.has(site);
      } catch {
        return false;
      }
    });

    this._sharingState = gBrowser.selectedTab._sharingState;

    if (this._sharingState?.geo) {
      let geoPermission = permissions.find(perm => perm.id === "geo");
      if (!geoPermission) {
        permissions.push({
          id: "geo",
          state: SitePermissions.ALLOW,
          scope: SitePermissions.SCOPE_REQUEST,
          sharingState: true,
        });
      }
    }

    if (this._sharingState?.xr) {
      let xrPermission = permissions.find(perm => perm.id === "xr");
      if (!xrPermission) {
        permissions.push({
          id: "xr",
          state: SitePermissions.ALLOW,
          scope: SitePermissions.SCOPE_REQUEST,
          sharingState: true,
        });
      }
    }

    if (this._sharingState?.webRTC) {
      let webrtcState = this._sharingState.webRTC;
      // If WebRTC device or screen are in use, we need to find
      // the associated ALLOW permission item to set the sharingState field.
      for (let id of ["camera", "microphone", "screen"]) {
        if (webrtcState[id]) {
          let found = false;
          for (let permission of permissions) {
            let [permId] = permission.id.split(
              SitePermissions.PERM_KEY_DELIMITER
            );
            if (permId != id || permission.state != SitePermissions.ALLOW) {
              continue;
            }
            found = true;
          }
          if (!found) {
            // If the ALLOW permission item we were looking for doesn't exist,
            // the user has temporarily allowed sharing and we need to add
            // an item in the permissions array to reflect this.
            permissions.push({
              id,
              state: SitePermissions.ALLOW,
              scope: SitePermissions.SCOPE_REQUEST,
              sharingState: webrtcState[id],
            });
          }
        }
      }
    }

    const separator = this.document.createXULElement("toolbarseparator");
    list.appendChild(separator);
    const settingElements = [];
    const developerMode = this.window.gZenDeveloperMode;
    const browser = gBrowser.selectedBrowser;
    if (developerMode?.available(browser)) {
      const documentId = browser.browsingContext.currentWindowGlobal?.innerWindowId;
      const item = this.document.createElement("button");
      item.type = "button";
      item.className = "zen-site-developer-mode permission-popup-permission-item";
      const icon = this.document.createElement("span");
      icon.className = "zen-site-developer-mode-icon";
      icon.setAttribute("aria-hidden", "true");
      const labels = this.document.createElement("span");
      labels.className = "permission-popup-permission-label-container";
      const title = this.document.createElement("span");
      title.className = "permission-popup-permission-label";
      this.document.l10n.setAttributes(title, "zen-site-data-setting-developer-mode");
      const status = this.document.createElement("span");
      status.className = "zen-site-developer-mode-status";
      labels.append(title, status);
      item.append(icon, labels);
      const update = () => {
        const enabled = developerMode.enabled(browser);
        this.document.l10n.setAttributes(status,
          enabled ? "zen-site-data-setting-on" : "zen-site-data-setting-off");
        item.setAttribute("aria-pressed", String(enabled));
        item.setAttribute("state", enabled ? "allow" : "block");
      };
      update();
      item.addEventListener("click", () => {
        if (!browser.isConnected || gBrowser.selectedBrowser !== browser ||
            browser.browsingContext.currentWindowGlobal?.innerWindowId !== documentId) return;
        developerMode.setEnabled(browser, !developerMode.enabled(browser));
        update();
      });
      settingElements.push(item);
    }
    const automaticPiP = this.#createAutomaticPiPItem(gBrowser.selectedBrowser);
    if (automaticPiP) settingElements.push(automaticPiP);
    const crossSiteCookieElements = [];
    for (let permission of permissions) {
      let [id, key] = permission.id.split(SitePermissions.PERM_KEY_DELIMITER);

      if (id == "storage-access") {
        // Ignore storage access permissions here, they are made visible inside
        // the Content Blocking UI.
        continue;
      }

      if (permission.state == SitePermissions.PROMPT) {
        // We don't display "ask" permissions in the site data panel.
        continue;
      }

      let [item, isCrossSiteCookie] = this.#createPermissionItem(
        id,
        key,
        permission
      );
      if (item) {
        if (isCrossSiteCookie) {
          crossSiteCookieElements.push(item);
        } else {
          settingElements.push(item);
        }
      }
    }

    for (let elem of settingElements) {
      separator.before(elem);
    }
    for (let elem of crossSiteCookieElements) {
      separator.after(elem);
    }

    separator.hidden =
      !settingElements.length || !crossSiteCookieElements.length;
    section.hidden = list.childElementCount < 2; // only the separator
  }

  #createAutomaticPiPItem(browser) {
    const policy = lazy.ZenAutoPictureInPicture;
    if (!policy.state(browser).available) return null;
    const documentId = browser.browsingContext.currentWindowGlobal?.innerWindowId;
    const item = this.document.createElement("button");
    item.type = "button";
    item.className = "zen-site-auto-pip permission-popup-permission-item";
    const icon = this.document.createElement("span");
    icon.className = "zen-site-auto-pip-icon";
    icon.setAttribute("aria-hidden", "true");
    const labels = this.document.createElement("span");
    labels.className = "permission-popup-permission-label-container";
    const title = this.document.createElement("span");
    title.className = "permission-popup-permission-label";
    this.document.l10n.setAttributes(title, "zen-site-data-setting-automatic-pip");
    const status = this.document.createElement("span");
    status.className = "zen-permission-popup-permission-state-label";
    labels.append(title, status);
    item.append(icon, labels);
    const update = () => {
      const state = policy.state(browser);
      item.disabled = !state.globallyEnabled;
      item.setAttribute("aria-pressed", String(state.allowed));
      item.setAttribute("state", state.allowed ? "allow" : "block");
      this.document.l10n.setAttributes(status,
        state.allowed ? "zen-site-data-setting-allow" : "zen-site-data-setting-block");
    };
    item.addEventListener("click", () => {
      if (!browser.isConnected || this.window.gBrowser.selectedBrowser !== browser ||
          browser.browsingContext.currentWindowGlobal?.innerWindowId !== documentId) return;
      policy.setAllowed(browser, !policy.allowed(browser));
      update();
    });
    update();
    return item;
  }

  #getPermissionStateLabelId(permission) {
    const { SitePermissions } = this.window;
    switch (permission.state) {
      // There should only be these types being displayed in the panel.
      case SitePermissions.ALLOW:
        if (permission.id === "site-protection") {
          return "zen-site-data-protections-enabled";
        }
        return "zen-site-data-setting-allow";
      case SitePermissions.BLOCK:
      case SitePermissions.AUTOPLAY_BLOCKED_ALL:
        if (permission.id === "site-protection") {
          return "zen-site-data-protections-disabled";
        }
        return "zen-site-data-setting-block";
      default:
        return null;
    }
  }

  #createPermissionItem(id, key, permission) {
    const { SitePermissions } = this.window;
    const isCrossSiteCookie = id === "3rdPartyStorage";

    // Create a permission item for the site data panel.
    let container = this.document.createXULElement("hbox");
    const idNoSuffix = permission.id;
    container.classList.add(
      "permission-popup-permission-item",
      `permission-popup-permission-item-${idNoSuffix}`
    );
    container.setAttribute("align", "center");
    container.setAttribute("role", "group");

    container.setAttribute(
      "state",
      permission.state == SitePermissions.ALLOW ? "allow" : "block"
    );

    let img = this.document.createXULElement("toolbarbutton");
    img.classList.add(
      "permission-popup-permission-icon",
      "zen-site-data-permission-icon"
    );
    img.setAttribute("closemenu", "none");
    if (this.#iconMap[id]) {
      img.classList.add(`zen-permission-${this.#iconMap[id]}-icon`);
    }

    let labelContainer = this.document.createXULElement("vbox");
    labelContainer.setAttribute("flex", "1");
    labelContainer.setAttribute("align", "start");
    labelContainer.classList.add("permission-popup-permission-label-container");
    labelContainer._permission = permission;

    let nameLabel = this.document.createXULElement("label");
    nameLabel.setAttribute("flex", "1");
    nameLabel.setAttribute("class", "permission-popup-permission-label");
    if (isCrossSiteCookie) {
      this.document.l10n.setAttributes(
        nameLabel,
        "zen-site-data-setting-cross-site"
      );
    } else {
      let label = SitePermissions.getPermissionLabel(permission.id);
      if (label) {
        nameLabel.textContent = label;
      } else {
        this.document.l10n.setAttributes(
          nameLabel,
          "zen-site-data-setting-" + idNoSuffix
        );
      }
    }
    labelContainer.appendChild(nameLabel);

    let stateLabel = this.document.createXULElement("label");
    stateLabel.setAttribute(
      "class",
      "zen-permission-popup-permission-state-label"
    );
    if (isCrossSiteCookie) {
      // The key should be the site for cross-site cookies.
      stateLabel.textContent = key;
    } else {
      stateLabel.setAttribute(
        "data-l10n-id",
        this.#getPermissionStateLabelId(permission)
      );
    }
    labelContainer.appendChild(stateLabel);

    container.appendChild(img);
    container.appendChild(labelContainer);

    container.addEventListener("click", this);
    return [container, isCrossSiteCookie];
  }

  #openGetAddons() {
    const { switchToTabHavingURI } = this.window;
    let amoUrl = Services.urlFormatter.formatURLPref(
      "extensions.getAddons.link.url"
    );
    switchToTabHavingURI(amoUrl, true);
  }

  #onCommandEvent(event) {
    const id = event.target.id;
    switch (id) {
      case "zen-site-data-new-addon-button": {
        this.#openGetAddons();
        break;
      }
      case "zen-site-data-security-info": {
        this.window.gIdentityHandler._openPopup(event);
        break;
      }
      case "zen-site-data-header-boost": {
        const domain = this.#getCurrentDomain();
        const uri = this.window.gBrowser.currentURI;
        if (!Services.prefs.getBoolPref("zen.boosts.enabled", true) ||
            !lazy.gZenBoostsManager.canBoostSite(uri)) break;
        const boost = lazy.gZenBoostsManager.createNewBoost(domain);
        lazy.gZenBoostsManager.openBoostWindow(this.window, boost, uri);
        this.unifiedPanel.hidePopup();
        break;
      }
      case "zen-site-data-actions": {
        const button = this.document.getElementById("zen-site-data-actions");
        const popup = this.document.getElementById("zenSiteDataActions");
        popup.openPopup(
          button,
          "after_start",
          0,
          0,
          /* context menu */ true,
          false,
          this.window.event
        );
        break;
      }
      case "zen-site-data-header-capture-portion": {
        const browser = this.window.gBrowser.selectedBrowser;
        if (!this.#canCopyUrl(browser.currentURI)) break;
        this.unifiedPanel.hidePopup();
        this.#portionCaptures.add(browser);
        this.window.ScreenshotsUtils.toggle(browser, "toolbar");
        break;
      }
      case "zen-site-data-header-capture-full-page": {
        this.#copyFullPage().catch(error => this.#reportCaptureError(error));
        break;
      }
      case "zen-site-data-header-share": {
        /* eslint-disable mozilla/valid-services */
        if (Services.zen.canShare()) {
          const buttonRect = event.target.getBoundingClientRect();
          const currentUrl = this.window.gBrowser.currentURI;
          /* eslint-disable mozilla/valid-services */
          Services.zen.share(
            currentUrl,
            "",
            "",
            buttonRect.left,
            this.window.innerHeight - buttonRect.bottom,
            buttonRect.width,
            buttonRect.height
          );
        } else {
          this.window.gZenCommonActions.copyCurrentURLToClipboard();
        }
        if (AppConstants.platform !== "macosx") {
          this.unifiedPanel.hidePopup();
        }
      }
    }
  }

  #onPermissionClick(label) {
    const { SitePermissions, gBrowser } = this.window;
    const permission = label._permission;

    let newState;
    switch (permission.state) {
      case SitePermissions.ALLOW:
        newState = SitePermissions.BLOCK;
        break;
      case SitePermissions.BLOCK:
      case SitePermissions.AUTOPLAY_BLOCKED_ALL:
        newState = SitePermissions.ALLOW;
        break;
      default:
        return;
    }

    if (permission.id === "site-protection") {
      const { gProtectionsHandler } = this.window;
      if (newState === SitePermissions.BLOCK) {
        gProtectionsHandler.disableForCurrentPage();
      } else {
        gProtectionsHandler.enableForCurrentPage();
      }
    } else {
      SitePermissions.setForPrincipal(
        gBrowser.contentPrincipal,
        permission.id,
        newState
      );
    }

    const isCrossSiteCookie = permission.id.startsWith("3rdPartyStorage");
    label.parentNode.setAttribute(
      "state",
      newState == SitePermissions.ALLOW ? "allow" : "block"
    );
    label._permission.state = newState;
    if (!isCrossSiteCookie) {
      label
        .querySelector(".zen-permission-popup-permission-state-label")
        .setAttribute(
          "data-l10n-id",
          this.#getPermissionStateLabelId(label._permission)
        );
    }
  }

  #onBoostClick(event) {
    const target = event.target.closest("[data-action-id]");
    if (!target) {
      return;
    }

    const actionId = target.getAttribute("data-action-id");
    const domain = this.#getCurrentDomain();

    switch (actionId) {
      case "zen-site-data-toggle-boost": {
        const boostId = target.getAttribute("data-boost-id");

        lazy.gZenBoostsManager.toggleBoostActiveForDomain(domain, boostId);
        this.#updateSiteBoost();
        break;
      }
      case "zen-site-data-edit-boost": {
        const boostId = target.getAttribute("data-boost-id");
        const uri = this.window.gBrowser.currentURI;
        const boost = lazy.gZenBoostsManager.loadBoostFromStore(
          domain,
          boostId
        );
        lazy.gZenBoostsManager.openBoostWindow(this.window, boost, uri);
        this.unifiedPanel.hidePopup();
        break;
      }
    }
  }

  #onClickEvent(event) {
    const id = event.target.id;
    switch (id) {
      case "zen-site-data-manage-addons": {
        const { BrowserAddonUI } = this.window;
        BrowserAddonUI.openAddonsMgr("addons://list/extension");
        this.unifiedPanel.hidePopup();
        break;
      }
      case "zen-site-data-settings-more": {
        const { BrowserCommands } = this.window;
        BrowserCommands.pageInfo(null, "permTab");
        break;
      }
      case "zen-site-data-icon-button": {
        this.toggle(event);
        break;
      }
      default: {
        const item = event.target.closest(".permission-popup-permission-item");
        if (!item) {
          break;
        }
        const label = item.querySelector(
          ".permission-popup-permission-label-container"
        );
        if (label?._permission) {
          this.#onPermissionClick(label);
        }
        break;
      }
    }
  }

  toggle(event, anchor = this.anchor) {
    // Arc keeps site controls attached to the sidebar even when opened from
    // Developer Mode. Use its button as a fallback only while the sidebar is
    // hidden or outside the window (compact mode and Little windows).
    if (anchor !== this.anchor) {
      const rect = this.anchor.getBoundingClientRect();
      // The icon itself is collapsed until hover or popup-open. Its visible
      // URL-bar host is the relevant check; opening reveals the anchor.
      const host = this.anchor.closest("#urlbar");
      const style = host && this.window.getComputedStyle(host);
      if (rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 &&
          rect.right <= this.window.innerWidth && rect.bottom <= this.window.innerHeight &&
          style?.visibility === "visible") {
        anchor = this.anchor;
      }
    }
    return this.window.gUnifiedExtensions.togglePanel(
      event, null, this.unifiedPanel, this.unifiedPanelView, anchor
    );
  }

  handleEvent(event) {
    const type = event.type;
    switch (type) {
      case "keydown": {
        if (event.key !== "Escape") break;
        const browser = this.window.gBrowser.selectedBrowser;
        if (!this.#portionCaptures.has(browser)) break;
        const screenshots = this.window.ScreenshotsUtils;
        // The capture controls live in nested shadow roots. Gecko's direct
        // parent check misses the retargeted screenshots-buttons element.
        if (screenshots.panelForBrowser(browser)?.contains(event.target)) {
          screenshots.cancel(browser, "Escape");
          this.#portionCaptures.delete(browser);
          event.preventDefault();
          event.stopPropagation();
        }
        break;
      }
      case "click":
        this.#onClickEvent(event);
        break;
      case "command":
        this.#onCommandEvent(event);
        break;
      case "popupshowing":
        this.#preparePanel();
        break;
    }
  }

  async #maybeShowFeatureCallout() {
    const kPref = "zen.site-data-panel.show-callout";
    if (!Services.prefs.getBoolPref(kPref, false)) {
      return;
    }
    Services.prefs.setBoolPref(kPref, false);
    const { gBrowser, gZenWorkspaces } = this.window;
    await gZenWorkspaces.promiseInitialized;
    await new Promise(resolve => {
      const checkEmptyTab = () => {
        if (!gBrowser.selectedTab.hasAttribute("zen-empty-tab")) {
          resolve();
          return;
        }
        this.window.addEventListener("TabSelect", checkEmptyTab, {
          once: true,
        });
      };
      checkEmptyTab();
    });
    const callout = new lazy.FeatureCallout({
      win: this.window,
      location: "chrome",
      context: "chrome",
      browser: gBrowser.selectedBrowser,
      theme: { preset: "chrome" },
    });
    this.window.setTimeout(() => {
      callout.showFeatureCallout({
        id: "ZEN_EXTENSIONS_PANEL_MOVE_CALLOUT",
        template: "feature_callout",
        groups: ["cfr"],
        content: {
          id: "ZEN_EXTENSIONS_PANEL_MOVE_CALLOUT",
          template: "multistage",
          backdrop: "transparent",
          transitions: true,
          screens: [
            {
              id: "ZEN_EXTENSIONS_PANEL_MOVE_CALLOUT",
              anchors: [
                {
                  selector: "#zen-site-data-icon-button",
                  panel_position: {
                    anchor_attachment: "bottomcenter",
                    callout_attachment: "topleft",
                  },
                },
              ],
              content: {
                position: "callout",
                width: "355px",
                title: {
                  string_id: "zen-site-data-panel-feature-callout-title",
                },
                subtitle: {
                  string_id: "zen-site-data-panel-feature-callout-subtitle",
                },
                dismiss_button: {
                  action: {
                    dismiss: true,
                  },
                  background: true,
                  size: "small",
                },
              },
            },
          ],
        },
      });
    }, 1000);
  }
}
