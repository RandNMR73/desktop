/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ZenSpaceAddSwipe } from "resource:///modules/zen/ZenSpaceAddSwipe.mjs";

const lazy = {};

ChromeUtils.defineLazyGetter(lazy, "browserBackgroundElement", () => {
  return document.getElementById("zen-browser-background");
});

ChromeUtils.defineLazyGetter(lazy, "toolbarBackgroundElement", () => {
  return document.getElementById("zen-toolbar-background");
});

ChromeUtils.defineESModuleGetters(
  lazy,
  { ZenLibrary: "moz-src:///zen/library/ZenLibrary.mjs" },
  { global: "current" }
);

export class ZenSpacesSwipe {
  static ACTIONS = {
    LIBRARY: "library",
    ADD_SPACE: "add-space",
  };

  static SUCCESS_THRESHOLD = 0.25;
  static SUCCESS_VELOCITY_CONTRIBUTION = 0.5;

  static GESTURE_EVENTS = [
    "MozSwipeGestureMayStart",
    "MozSwipeGestureStart",
    "MozSwipeGestureUpdate",
    "MozSwipeGesture",
    "MozSwipeGestureEnd",
  ];

  #addSwipe = new ZenSpaceAddSwipe();

  #swipeState = {
    isGestureActive: false,
    direction: null,
    /** One of ACTIONS, or null while the swipe still only moves spaces. */
    action: null,
    /** Which of ACTIONS this swipe is allowed to turn into. */
    allowed: { library: false, addSpace: false },
  };

  constructor() {
    this.attachWorkspaceSwipeGestures(gNavToolbox);
  }

  /**
   * Tells the swipe tracker how the action this swipe turned out to be for
   * wants it judged, which it then holds the rest of the swipe to.
   *
   * @param {SimpleGestureEvent} event - The swipe event being handled
   */
  #applySwipeThreshold(event) {
    const addingSpace =
      this.#swipeState.action === ZenSpacesSwipe.ACTIONS.ADD_SPACE;
    event.swipeSuccessThreshold = addingSpace
      ? ZenSpaceAddSwipe.SUCCESS_THRESHOLD
      : ZenSpacesSwipe.SUCCESS_THRESHOLD;
    event.swipeSuccessVelocityContribution = addingSpace
      ? ZenSpaceAddSwipe.SUCCESS_VELOCITY_CONTRIBUTION
      : ZenSpacesSwipe.SUCCESS_VELOCITY_CONTRIBUTION;
  }

  attachWorkspaceSwipeGestures(element) {
    for (const type of ZenSpacesSwipe.GESTURE_EVENTS) {
      element.addEventListener(type, this, true);
    }
  }

  detachWorkspaceSwipeGestures(element) {
    for (const type of ZenSpacesSwipe.GESTURE_EVENTS) {
      element.removeEventListener(type, this, true);
    }
  }

  handleEvent(event) {
    switch (event.type) {
      case "MozSwipeGestureMayStart":
        this.#handleSwipeMayStart(event);
        break;
      case "MozSwipeGestureStart":
        this.#handleSwipeStart(event);
        break;
      case "MozSwipeGestureUpdate":
        this.#handleSwipeUpdate(event);
        break;
      case "MozSwipeGesture":
        this.#handleSwipeEnd(event);
        break;
      // A popup taking over mid-swipe ends the swipe just the same.
      case "MozSwipeGestureEnd":
      case "popupshown":
        this.#onSwipeAnimationEnd();
        break;
    }
  }

  #handleSwipeMayStart(event) {
    const ws = gZenWorkspaces;

    if (ws.privateWindowOrDisabled || ws.isChangingWorkspace) {
      return;
    }

    if (
      event.target.closest(
        '#urlbar[zen-floating-urlbar="true"], #zen-workspaces-button, #zen-library-download-list'
      )
    ) {
      return;
    }

    // Only handle horizontal swipes
    if (
      event.direction === event.DIRECTION_LEFT ||
      event.direction === event.DIRECTION_RIGHT
    ) {
      event.preventDefault();
      event.stopPropagation();

      // Set allowed directions based on available workspaces
      event.allowedDirections |= event.DIRECTION_LEFT | event.DIRECTION_RIGHT;
    }
  }

  #toggleSwipeGestureAttr(enable) {
    const elements = [
      "zen-workspace",
      "#zen-sidebar-foot-buttons",
      "#tabbrowser-arrowscrollbox",
      ".zen-browser-grain",
    ];
    elements.forEach(el =>
      document
        .querySelectorAll(el)
        .forEach(node => node?.toggleAttribute("swipe-gesture", enable))
    );
  }

  #handleSwipeStart(event) {
    const ws = gZenWorkspaces;

    if (!ws.workspaceEnabled) {
      return;
    }

    gZenFolders.cancelPopupTimer();

    this.#toggleSwipeGestureAttr(true);
    document.addEventListener("popupshown", this, { once: true });

    lazy.ZenLibrary.swipeReset();
    this.#addSwipe.swipeReset();

    event.preventDefault();
    event.stopPropagation();
    const libraryOpen = lazy.ZenLibrary.isLibraryOpen;
    this.#swipeState = {
      isGestureActive: true,
      direction: null,
      stripWidth: Math.max(
        1,
        window.windowUtils.getBoundsWithoutFlushing(
          ws.workspaceElement(ws.getActiveWorkspaceFromCache().uuid)
        ).width
      ),
      gesturePixels: Services.prefs.getIntPref("widget.swipe.pixel_size", 550),
      deltaMultiplier: Services.prefs.getIntPref(
        "zen.workspaces.swipe-actions.delta-multiplier"
      ),
      action: libraryOpen ? ZenSpacesSwipe.ACTIONS.LIBRARY : null,
      allowed: {
        library: libraryOpen || lazy.ZenLibrary.readySwipeOpenLibrary(),
        addSpace: this.#addSwipe.readySwipeAddSpace(),
      },
    };
    if (libraryOpen) {
      lazy.ZenLibrary.startSwipe();
    }
    this.#applySwipeThreshold(event);
  }

  #handleSwipeUpdate(event) {
    const ws = gZenWorkspaces;

    if (!ws.workspaceEnabled || !this.#swipeState?.isGestureActive) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // SwipeTracker supplies the absolute gesture progress, including the native
    // return animation. Accumulating it again makes travel depend on event count
    // and prevents a reversing gesture from following the fingers back to zero.
    // Arc's strip travels half the native pan distance. The workspace manager
    // takes twice the percentage translation (200 means one complete strip).
    const { stripWidth, gesturePixels, deltaMultiplier } = this.#swipeState;
    const translateX = Math.max(
      -200,
      Math.min(200, (event.delta * gesturePixels * deltaMultiplier) / stripWidth)
    );

    const direction = event.delta > 0 ? "left" : event.delta < 0 ? "right" : null;
    if (direction && direction !== this.#swipeState.direction) {
      delete ws._hasAnimatedBackgrounds;
      this.#swipeState.direction = direction;
    }

    const currentWorkspace = ws.getActiveWorkspaceFromCache();
    if (!this.#swipeState.action) {
      this.#decideAction(translateX);
    }
    this.#applySwipeThreshold(event);

    switch (this.#swipeState.action) {
      case ZenSpacesSwipe.ACTIONS.LIBRARY:
        lazy.ZenLibrary.swipeProgress(translateX / 200);
        ws._organizeWorkspaceStripLocations(currentWorkspace, true, 0);
        return;
      case ZenSpacesSwipe.ACTIONS.ADD_SPACE:
        this.#addSwipe.swipeProgress(event.delta);
        return;
    }

    // Apply a translateX to the tab strip to give the user feedback on the swipe
    ws._organizeWorkspaceStripLocations(currentWorkspace, true, translateX);
  }

  /**
   * Works out what the swipe is for, out of what it is allowed to do and the
   * way it is going, and hands it over to whatever takes it.
   *
   * @param {number} translateX - How far the strip has been dragged
   */
  #decideAction(translateX) {
    if (!translateX) {
      return;
    }
    const { allowed } = this.#swipeState;
    const towardsLibrary = lazy.ZenLibrary.libraryOnRight
      ? translateX < 0
      : translateX > 0;

    if (allowed.library && towardsLibrary) {
      this.#swipeState.action = ZenSpacesSwipe.ACTIONS.LIBRARY;
      lazy.ZenLibrary.startSwipe();
    } else if (allowed.addSpace && !towardsLibrary) {
      this.#swipeState.action = ZenSpacesSwipe.ACTIONS.ADD_SPACE;
      this.#addSwipe.startSwipe();
    }
  }

  async #handleSwipeEnd(event) {
    const ws = gZenWorkspaces;

    if (!ws.workspaceEnabled) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const isRTL = document.documentElement.matches(":-moz-locale-dir(rtl)");
    const moveForward =
      (event.direction === SimpleGestureEvent.DIRECTION_RIGHT) !== isRTL;

    const rawDirection = moveForward ? 1 : -1;
    const direction = ws.naturalScroll ? -1 : 1;

    switch (this.#swipeState.action) {
      case ZenSpacesSwipe.ACTIONS.LIBRARY:
        lazy.ZenLibrary.stopSwipe(rawDirection * direction);
        return;
      case ZenSpacesSwipe.ACTIONS.ADD_SPACE:
        this.#addSwipe.endSwipe();
        return;
    }

    // SwipeTracker sends MozSwipeGestureEnd on the next main-thread task,
    // before the Space spring has finished. Reserve presentation ownership
    // now, including the microtask before the switch queue starts running.
    const state = this.#swipeState;
    state.settling = (state.settling || 0) + 1;
    try {
      await ws.changeWorkspaceShortcut(rawDirection * direction, true);
    } finally {
      state.settling--;
    }
  }

  #onSwipeAnimationEnd() {
    const ws = gZenWorkspaces;
    if (!this.#swipeState.isGestureActive) {
      return;
    }
    const switchOwnsPresentation = this.#swipeState.settling || ws.isChangingWorkspace;

    switch (this.#swipeState.action) {
      case ZenSpacesSwipe.ACTIONS.LIBRARY:
        lazy.ZenLibrary.swipeAnimationEnd();
        break;
      case ZenSpacesSwipe.ACTIONS.ADD_SPACE:
        this.#addSwipe.onSwipeAnimationEnd();
        break;
    }

    // Reset swipe state
    this.#swipeState = {
      isGestureActive: false,
      direction: null,
      action: null,
      allowed: { library: false, addSpace: false },
    };

    this.#toggleSwipeGestureAttr(false);
    // The switch owns strip/theme progress until its spring settles. Resetting
    // either here flashes the destination color while the strip is in flight.
    if (!switchOwnsPresentation) {
      gZenUIManager.tabsWrapper.style.removeProperty("scrollbar-width");
      [lazy.browserBackgroundElement, lazy.toolbarBackgroundElement].forEach(
        element => {
          element.style.setProperty("--zen-background-opacity", "1");
        }
      );
      delete ws._hasAnimatedBackgrounds;
      ws.updateTabsContainers();
    }
    document.removeEventListener("popupshown", this, { once: true });
  }

  get isGestureActive() {
    return this.#swipeState?.isGestureActive;
  }
}
