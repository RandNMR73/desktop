// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { nsZenDOMOperatedFeature } from "chrome://browser/content/zen-components/ZenCommonUtils.mjs";

const lazy = {};

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "enabled",
  "zen.tabs.auto-archive.enabled",
  false
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "idleMinutes",
  "zen.tabs.auto-archive.minutes",
  720
);

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

/**
 * Arc's Auto Archive: unpinned tabs nobody has looked at for a while are
 * closed into the archive, which is Firefox's closed tabs (listed by the
 * Library and reopened with ⌘⇧T). Selecting a tab resets its timer. Pins,
 * Essentials, folders and tabs that are playing, sharing or in
 * picture-in-picture are never archived.
 */
class nsZenTabAutoArchive extends nsZenDOMOperatedFeature {
  #timer = null;

  init() {
    if (PrivateBrowsingUtils.isWindowPrivate(window)) {
      return;
    }
    gZenWorkspaces.promiseInitialized.then(() => {
      this.#timer = setInterval(
        () => this.archiveIdleTabs(),
        CHECK_INTERVAL_MS
      );
    });
    window.addEventListener("unload", () => clearInterval(this.#timer), {
      once: true,
    });
  }

  /**
   * Closes every tab in this window that has been idle for longer than
   * zen.tabs.auto-archive.minutes.
   *
   * @param {number} [now] - The current time in ms, for tests.
   * @returns {MozTabbrowserTab[]} The archived tabs.
   */
  archiveIdleTabs(now = Date.now()) {
    if (!lazy.enabled || lazy.idleMinutes <= 0) {
      return [];
    }
    const cutoff = now - lazy.idleMinutes * MS_PER_MINUTE;
    const tabs = gBrowser.tabs.filter(tab => this.#isIdle(tab, cutoff));
    if (tabs.length) {
      gBrowser.removeTabs(tabs, { animate: false, skipPermitUnload: true });
    }
    return tabs;
  }

  #isIdle(tab, cutoff) {
    if (!this.#canArchive(tab)) {
      return false;
    }
    const group = tab.group;
    if (!group) {
      return tab.lastAccessed < cutoff;
    }
    // A split view is archived whole, once none of its panes has been used.
    return (
      group.hasAttribute("split-view-group") &&
      group.tabs.every(
        pane => this.#canArchive(pane) && pane.lastAccessed < cutoff
      )
    );
  }

  #canArchive(tab) {
    return !(
      tab.pinned ||
      tab.selected ||
      tab.multiselected ||
      tab.closing ||
      tab.hasAttribute("zen-essential") ||
      tab.hasAttribute("zen-empty-tab") ||
      tab.hasAttribute("zen-glance-tab") ||
      tab.hasAttribute("pictureinpicture") ||
      tab.hasAttribute("sharing") ||
      (tab.hasAttribute("soundplaying") && !tab.hasAttribute("muted"))
    );
  }
}

window.gZenTabAutoArchive = new nsZenTabAutoArchive();
