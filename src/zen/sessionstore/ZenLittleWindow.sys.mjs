// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "gEnabled",
  "zen.little-window.enabled",
  false
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "gExternalLinks",
  "zen.little-window.external-links",
  false
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "gWidth",
  "zen.little-window.width",
  900
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "gHeight",
  "zen.little-window.height",
  640
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

  /**
   * @param {Window} aWindow - A browser window.
   * @returns {boolean} Whether it was opened as a little window.
   */
  isLittleWindow(aWindow) {
    return !!aWindow?.document?.documentElement?.hasAttribute(
      LITTLE_WINDOW_ATTRIBUTE
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
      Ci.nsISupportsString
    );
    args.data = aURL || "about:blank";
    const win = lazy.BrowserWindowTracker.openWindow({
      openerWindow: aOpenerWindow,
      private: lazy.PrivateBrowsingUtils.isWindowPrivate(aOpenerWindow),
      features: `width=${lazy.gWidth},height=${lazy.gHeight},centerscreen`,
      args,
      zenSyncedWindow: false,
    });
    // zenSyncedWindow flips under zen.window-sync.prefer-unsynced-windows.
    win._zenStartupSyncFlag = "unsynced";
    // Read by gZenCompactModeManager.preInit, which starts this window in
    // compact mode (no sidebar) without touching the main windows' state.
    win._zenLittleWindow = true;
    const onBeforeShow = subject => {
      if (subject !== win) {
        return;
      }
      Services.obs.removeObserver(onBeforeShow, "browser-window-before-show");
      const root = win.document.documentElement;
      root.setAttribute(LITTLE_WINDOW_ATTRIBUTE, "true");
    };
    Services.obs.addObserver(onBeforeShow, "browser-window-before-show");
    if (!aURL) {
      win.addEventListener(
        "MozAfterPaint",
        () => win.document.getElementById("Browser:OpenLocation")?.doCommand(),
        { once: true }
      );
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
   * Moves the selected tab of a little window into the active space of the
   * most recent main window, then closes the little window.
   *
   * @param {Window} aWindow - The little window.
   */
  moveToMainWindow(aWindow) {
    const target = lazy.BrowserWindowTracker.getOrderedWindows({
      private: lazy.PrivateBrowsingUtils.isWindowPrivate(aWindow),
    }).find(
      win =>
        win !== aWindow &&
        !win.document.documentElement.hasAttribute("zen-unsynced-window")
    );
    if (!target) {
      // Nowhere to go: keep the tab and let this become an ordinary window.
      aWindow.document.documentElement.removeAttribute(LITTLE_WINDOW_ATTRIBUTE);
      return;
    }
    const tab = target.gBrowser.adoptTab(aWindow.gBrowser.selectedTab, {
      selectTab: true,
    });
    if (!tab) {
      return;
    }
    target.gZenWorkspaces.moveTabToWorkspace(
      tab,
      target.gZenWorkspaces.activeWorkspace
    );
    target.focus();
    aWindow.close();
  },
};
