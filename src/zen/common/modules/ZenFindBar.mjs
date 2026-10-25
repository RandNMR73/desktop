// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

/** Keep Gecko's per-tab finder, IME handling and focus lifecycle. Adapt the
 * compact UI; never search page DOM or add another finder listener. */
const typedQueries = new WeakMap();

function queryHistory(bar) {
  const win = bar.ownerDocument.defaultView;
  if (!typedQueries.has(win)) {
    typedQueries.set(win, { value: "" });
  }
  return typedQueries.get(win);
}

export function prepareCompactFindBar(bar) {
  if (!bar || bar.hasAttribute("zen-compact-findbar")) {
    return;
  }
  bar.setAttribute("zen-compact-findbar", "true");
  // Match visual and keyboard order (stock macOS places Close first).
  bar.appendChild(bar.getElement("find-closebutton"));
  // Arc shares typed queries between tabs in one window. A selected-text
  // preview (including its Return activation) must not replace that history.
  // Read the owning document at use time so adopting a tab uses its new window's
  // history; weak window keys also keep private/closed windows separate.
  const rememberQuery = () => {
    if (bar.findMode === bar.FIND_NORMAL && !bar._isIMEComposing) {
      queryHistory(bar).value = bar._findField.value;
    }
  };
  for (const event of ["input", "compositionend", "drop"]) {
    bar._findField.addEventListener(event, rememberQuery);
  }
  bar._zenNextSelectionPreview = 0;
  for (const method of ["_find", "_findAgain", "close"]) {
    const original = bar[method];
    bar[method] = function (...args) {
      this._zenSelectionPreview = null;
      return original.apply(this, args);
    };
  }
  const currentSelection = bar.onCurrentSelection;
  bar.onCurrentSelection = function (selection, initial) {
    // Respect Gecko's guard against a late selection replacing typed input.
    const accepted = initial && this._startFindDeferred &&
      this.findMode === this.FIND_NORMAL && !this.hidden && !this._isIMEComposing;
    const preview = accepted && selection;
    if (accepted && !selection) {
      // Assign even an empty value: clearing the field is an explicit choice.
      this._findField.value = queryHistory(this).value;
    }
    const result = currentSelection.call(this, selection, initial);
    if (preview) {
      const word = this._findField.value;
      this._updateCaseSensitivity(word);
      this._updateDiacriticMatching(word);
      this._setEntireWord();
      this._updateStatusUI();
      // Keep navigation in the keyboard order while the asynchronous count
      // arrives. The selected query is actionable even before it is counted.
      this._foundMatches.hidden = true;
      this.setAttribute("zen-findbar-has-matches", "true");
      const previewId = ++this._zenNextSelectionPreview;
      this._zenSelectionPreview = previewId;
      // Use the existing shared finder iterator. Preview all matches without
      // moving the selection/viewport; Return performs the first actual find.
      this.browser.finder.prepareSelectionPreview();
      this.browser.finder.highlight(this._highlightAll, word, false);
      this.browser.finder.requestMatchesCount(word, {
        linksOnly: false,
        selectionPreviewId: previewId,
      });
    } else if (accepted) {
      // Reopen the remembered query through Gecko so count/highlights cannot
      // describe a previous selection or another tab's query.
      this._findFailedString = null;
      this._find(this._findField.value, { fromStart: true });
    }
    return result;
  };
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
    if (result.searchString !== undefined && result.searchString !== this._findField.value) {
      return;
    }
    if (result.selectionPreviewId &&
        (this.hidden || result.selectionPreviewId !== this._zenSelectionPreview)) {
      return;
    }
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
