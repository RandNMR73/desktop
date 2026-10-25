// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/** Keep Gecko's per-tab finder, IME handling and focus lifecycle. Only adapt
 * its presentation; never search page DOM or add another finder listener. */
export function prepareCompactFindBar(bar) {
  if (!bar || bar.hasAttribute("zen-compact-findbar")) {
    return;
  }
  bar.setAttribute("zen-compact-findbar", "true");
  // Match visual and keyboard order (stock macOS places Close first).
  bar.appendChild(bar.getElement("find-closebutton"));
  const updateLink = bar._updateStatusUIBar;
  bar._updateStatusUIBar = function (url) {
    // A text match is not a pointer hover. Retain destination feedback for
    // Firefox's explicit links-only quick finder and ordinary pointer events.
    return updateLink.call(this, this.findMode === this.FIND_NORMAL ? "" : url);
  };
  const updateUI = bar._updateFindUI;
  bar._updateFindUI = function (...args) {
    const result = updateUI.apply(this, args);
    if (this.findMode === this.FIND_NORMAL) {
      this.ownerDocument.l10n.setAttributes(this._findField, "zen-findbar-input");
    }
    return result;
  };

  const updateStatus = bar._updateStatusUI;
  bar._updateStatusUI = function (...args) {
    const result = updateStatus.apply(this, args);
    if (this._findField.getAttribute("status") === "notfound") {
      this.removeAttribute("zen-findbar-has-matches");
      this.ownerDocument.l10n.setAttributes(this._findStatusDesc, "zen-findbar-not-found");
    } else if (!this._findField.value) {
      this.removeAttribute("zen-findbar-has-matches");
    }
    return result;
  };

  const matches = bar.onMatchesCountResult;
  bar.onMatchesCountResult = function (result) {
    matches.call(this, result);
    this.toggleAttribute("zen-findbar-has-matches", !!result.total);
    if (result.total) {
      this.ownerDocument.l10n.setAttributes(
        this._foundMatches,
        result.total === -1 ? "zen-findbar-count-limit" : "zen-findbar-count",
        result.total === -1
          ? { limit: result.limit }
          : { current: result.current, total: result.total },
      );
    }
  };
}

export function initCompactFindBars(win) {
  if (!Services.prefs.getBoolPref("zen.view.compact-findbar", true)) {
    return;
  }
  const initialized = event => prepareCompactFindBar(event.target._findBar);
  win.addEventListener("TabFindInitialized", initialized);
  // A startup command can create a bar before the UI manager initializes.
  for (const tab of win.gBrowser.tabs) {
    prepareCompactFindBar(tab._findBar);
  }
  win.addEventListener("unload", () => {
    win.removeEventListener("TabFindInitialized", initialized);
  }, { once: true });
}
