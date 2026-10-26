// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  ZenLittleWindowToolbar:
    "resource:///modules/zen/ZenLittleWindowToolbar.sys.mjs",
});

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "gEnabled",
  "zen.little-window.enabled",
  false,
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "gExternalLinks",
  "zen.little-window.external-links",
  false,
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "gWidth",
  "zen.little-window.width",
  900,
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "gHeight",
  "zen.little-window.height",
  640,
);

const LITTLE_WINDOW_ATTRIBUTE = "zen-little-window";

/**
 * Little windows, after Arc's Little Arc: a small unsynced window without the
 * sidebar, for a quick search or a link handed over by another app. Its tab
 * can then be moved into the current space of the main window.
 */
export const ZenLittleWindow = {
  get enabled() {
    return lazy.gEnabled;
  },

  get windowFeatures() {
    return `width=${lazy.gWidth},height=${lazy.gHeight},centerscreen`;
  },

  /** Set the window role before startup can restore the main window's tabs. */
  prepareWindow(win) {
    win._zenStartupSyncFlag = "unsynced";
    win._zenLittleWindow = true;
    let observing = true;
    const cleanup = () => {
      if (observing) {
        Services.obs.removeObserver(onWindow, "browser-window-before-show");
        Services.obs.removeObserver(onWindow, "domwindowclosed");
        observing = false;
      }
    };
    const onWindow = (subject, topic) => {
      if (subject !== win) {
        return;
      }
      cleanup();
      if (topic === "browser-window-before-show") {
        win.document.documentElement.setAttribute(
          LITTLE_WINDOW_ATTRIBUTE,
          "true",
        );
        win.gZenLittleWindowToolbar = new lazy.ZenLittleWindowToolbar(
          win,
          this,
        );
      }
    };
    Services.obs.addObserver(onWindow, "browser-window-before-show");
    // The initial about:blank document unloads during browser startup. Listen
    // for the outer window closing so that unload cannot cancel preparation.
    Services.obs.addObserver(onWindow, "domwindowclosed");
  },

  canOpenContextLink(context) {
    return (
      !!context.onLink &&
      (context.linkURI?.schemeIs("http") || context.linkURI?.schemeIs("https"))
    );
  },

  /** Match Arc's opening group without replacing Gecko's link-load metadata. */
  updateLinkContextMenu(context) {
    const { document, window } = context;
    let item = document.getElementById("context-zenOpenLinkInLittleWindow");
    if (!item) {
      item = document.createXULElement("menuitem");
      item.id = "context-zenOpenLinkInLittleWindow";
      item.setAttribute("label", "Open Link in Little Arc");
      item.addEventListener("command", () =>
        this.openContextLink(window.gContextMenu),
      );
      document.getElementById("context-sep-open").before(item);
    }
    context.showItem(item, context.onLink);
    const isPrivate = lazy.PrivateBrowsingUtils.isWindowPrivate(window);
    item.disabled =
      !this.enabled || isPrivate || !this.canOpenContextLink(context);
    if (context.onLink) {
      // The ordinary action retains the source container without adding a
      // second container-specific opening group to Arc's menu.
      const openTab = document.getElementById("context-openlinkintab");
      openTab.setAttribute(
        "data-usercontextid",
        context.contentData.userContextId,
      );
      context.showItem(openTab, true);
      context.showItem("context-openlinkincontainertab", false);
      context.showItem("context-openlink", true);
      context.showItem(
        "context-openlinkprivate",
        lazy.PrivateBrowsingUtils.enabled,
      );
    }
    context.showItem("context-openlinkinsplitview", false);
    const split = document.getElementById("context-zenSplitLink");
    context.showItem(split, context.onLink);
    split.disabled =
      !this.canOpenContextLink(context) ||
      !window.gZenViewSplitter.canOpenLinkInSplitView();
    split.removeAttribute("data-l10n-id");
    split.setAttribute("label", "Open Link in Split View");
    context.showItem("context-zenOpenLinkInGlance", false);
    context.showItem("context-openlinkinusercontext-menu", false);
    const privateItem = document.getElementById("context-openlinkprivate");
    privateItem.removeAttribute("data-l10n-id");
    privateItem.setAttribute("label", "Open Link in Incognito Window");
    privateItem.disabled = isPrivate;
    // Reorder only when necessary: reopening the menu does not reparent nodes.
    if (
      split.nextElementSibling !== item ||
      item.nextElementSibling !== privateItem
    ) {
      privateItem.before(split, item);
    }
  },

  openContextLink(context) {
    if (
      !context ||
      !this.enabled ||
      lazy.PrivateBrowsingUtils.isWindowPrivate(context.window) ||
      !this.canOpenContextLink(context)
    ) {
      return false;
    }
    context.window.openLinkIn(
      context.linkURL,
      "window",
      context._openLinkInParameters({
        ...context._getGlobalHistoryOptions(),
        userContextId: context.contentData.userContextId,
        private: lazy.PrivateBrowsingUtils.isWindowPrivate(context.window),
        zenLittleWindow: true,
      }),
    );
    return true;
  },

  /**
   * @param {Window} aWindow - A browser window.
   * @returns {boolean} Whether it was opened as a little window.
   */
  isLittleWindow(aWindow) {
    return !!aWindow?.document?.documentElement?.hasAttribute(
      LITTLE_WINDOW_ATTRIBUTE,
    );
  },

  /**
   * Opens a little window.
   *
   * @param {Window} aOpenerWindow - The window it is opened from.
   * @param {string} [aURL] - The page to load. Without one, the window opens
   *   on a blank tab with the address bar focused.
   * @returns {Window|null} The new window, or null when disabled.
   */
  open(aOpenerWindow, aURL = null) {
    if (!this.enabled) {
      return null;
    }
    const args = Cc["@mozilla.org/supports-string;1"].createInstance(
      Ci.nsISupportsString,
    );
    args.data = aURL || "about:blank";
    const win = lazy.BrowserWindowTracker.openWindow({
      openerWindow: aOpenerWindow,
      private: lazy.PrivateBrowsingUtils.isWindowPrivate(aOpenerWindow),
      features: this.windowFeatures,
      args,
      zenSyncedWindow: false,
    });
    this.prepareWindow(win);
    if (!aURL) {
      void this.waitForStartup(win).then((ready) => {
        if (ready && !win.closed) {
          win.focus();
          win.document.getElementById("Browser:OpenLocation").doCommand();
        }
      });
    }
    return win;
  },

  /**
   * Opens a link from another app in a little window, unless a space route
   * claims it (routes win, as in Arc).
   *
   * @param {nsIURI} aURI - The link.
   * @param {number} aWhere - The nsIBrowserDOMWindow location it asked for.
   * @param {Window} aTopWindow - The window it would otherwise open in.
   * @param {string} aRoute - What space routing picked for the link.
   * @returns {boolean} True when a little window took the link.
   */
  openExternalURI(aURI, aWhere, aTopWindow, aRoute) {
    if (
      !this.enabled ||
      !lazy.gExternalLinks ||
      aWhere !== Ci.nsIBrowserDOMWindow.OPEN_DEFAULTWINDOW ||
      aRoute !== "most-recent-space" ||
      !(aURI.schemeIs("http") || aURI.schemeIs("https")) ||
      lazy.PrivateBrowsingUtils.isWindowPrivate(aTopWindow)
    ) {
      return false;
    }
    return !!this.open(aTopWindow, aURI.spec);
  },

  /**
   * Finds the most recent main window with matching privacy.
   * @param {Window} aWindow - The little window.
   */
  getMainWindow(aWindow) {
    return lazy.BrowserWindowTracker.getOrderedWindows({
      private: lazy.PrivateBrowsingUtils.isWindowPrivate(aWindow),
    }).find(
      (win) =>
        win !== aWindow &&
        !win.closed &&
        !win._zenLittleWindow &&
        !win.document.documentElement.hasAttribute("zen-unsynced-window"),
    );
  },

  moveToMainWindow(aWindow, workspaceID = null) {
    if (aWindow._zenLittleMovePromise) return aWindow._zenLittleMovePromise;
    aWindow._zenLittleMovePromise = this._moveToMainWindow(
      aWindow,
      workspaceID,
    ).finally(() => delete aWindow._zenLittleMovePromise);
    return aWindow._zenLittleMovePromise;
  },

  /** Wait for browser focus/session initialization, or an early close. */
  waitForStartup(win) {
    if (win.closed) return Promise.resolve(false);
    if (win.gBrowserInit?.delayedStartupFinished) return Promise.resolve(true);
    return new Promise((resolve) => {
      const finish = (subject, topic) => {
        if (subject !== win) return;
        Services.obs.removeObserver(finish, "browser-delayed-startup-finished");
        Services.obs.removeObserver(finish, "domwindowclosed");
        resolve(topic === "browser-delayed-startup-finished");
      };
      Services.obs.addObserver(finish, "browser-delayed-startup-finished");
      Services.obs.addObserver(finish, "domwindowclosed");
    });
  },

  async _moveToMainWindow(aWindow, workspaceID) {
    const sourceTab = aWindow.gBrowser.selectedTab;
    let target = this.getMainWindow(aWindow);
    if (!target) {
      target = lazy.BrowserWindowTracker.openWindow({
        openerWindow: aWindow,
        private: lazy.PrivateBrowsingUtils.isWindowPrivate(aWindow),
        zenSyncedWindow: true,
      });
      // Promotion creates a main window even when ordinary New Window prefers
      // unsynced windows. The page is adopted only after its Spaces exist.
      target._zenStartupSyncFlag = "synced";
      if (!(await this.waitForStartup(target))) return false;
    }
    if (target.closed || aWindow.closed || !sourceTab.isConnected) return false;
    await target.gZenWorkspaces.promiseInitialized;
    const destination =
      workspaceID ||
      target.gZenWorkspaces.activeWorkspace ||
      aWindow.gZenLittleWindowToolbar?.destinationWorkspaceID;
    if (destination && !target.gZenWorkspaces.getWorkspaceFromId(destination))
      return false;
    if (destination !== target.gZenWorkspaces.activeWorkspace) {
      await target.gZenWorkspaces.changeWorkspaceWithID(destination);
    }
    if (target.closed || aWindow.closed || !sourceTab.isConnected) return false;
    const tab = target.gBrowser.adoptTab(sourceTab, { selectTab: true });
    if (!tab) return false;
    target.gZenWorkspaces.moveTabToWorkspace(
      tab,
      target.gZenWorkspaces.activeWorkspace,
    );
    target.focus();
    aWindow.close();
    return true;
  },
};
