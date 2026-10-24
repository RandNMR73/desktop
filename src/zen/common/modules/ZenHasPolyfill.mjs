// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

class nsHasPolyfill {
  constructor() {
    this.observers = [];
    this.idStore = 0;
  }

  /**
   * @param {HTMLElement} element
   * @param {Array<{selector: string}>} descendantSelectors
   * @param {string} stateAttribute
   * @param {Array<string>} attributeFilter
   */
  observeSelectorExistence(
    element,
    descendantSelectors,
    stateAttribute,
    attributeFilter = []
  ) {
    let raf = 0;
    const applyState = () => {
      raf = 0;
      let matched = null;
      for (const { selector } of descendantSelectors) {
        const selected = element.querySelector(selector);
        if (!selected || selected.tagName?.toLowerCase() === "menu") {
          continue;
        }
        matched = selector;
        break;
      }

      if (matched) {
        if (gZenCompactModeManager._canDebugLog) {
          gZenCompactModeManager.log(
            `Selector "${matched}" exists for: `,
            element
          );
        }
        if (!element.hasAttribute(stateAttribute)) {
          gZenCompactModeManager._setElementExpandAttribute(
            element,
            true,
            stateAttribute
          );
        }
      } else if (element.hasAttribute(stateAttribute)) {
        gZenCompactModeManager._setElementExpandAttribute(
          element,
          false,
          stateAttribute
        );
      }
    };

    // Compact-mode observers fire on every chrome mutation. One query per
    // frame is enough: the attribute only needs to match the current tree.
    const updateState = () => {
      if (raf) {
        return;
      }
      const win = element.ownerGlobal || window;
      raf = win.requestAnimationFrame(applyState);
    };

    const observer = new MutationObserver(updateState);
    const observerId = this.idStore++;
    this.observers.push({
      id: observerId,
      observer,
      element,
      attributeFilter,
      cancel() {
        if (raf) {
          const win = element.ownerGlobal || window;
          win.cancelAnimationFrame(raf);
          raf = 0;
        }
      },
    });
    return observerId;
  }

  disconnectObserver(observerId) {
    const index = this.observers.findIndex(o => o.id === observerId);
    if (index !== -1) {
      this.observers[index].cancel?.();
      this.observers[index].observer.disconnect();
    }
  }

  connectObserver(observerId) {
    const observer = this.observers.find(o => o.id === observerId);
    if (observer) {
      observer.observer.observe(observer.element, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: observer.attributeFilter.length
          ? observer.attributeFilter
          : undefined,
      });
    }
  }

  destroy() {
    this.observers.forEach(observer => {
      observer.cancel?.();
      observer.observer.disconnect();
    });
    this.observers = [];
  }
}

const hasPolyfillInstance = new nsHasPolyfill();
window.addEventListener("unload", () => hasPolyfillInstance.destroy(), {
  once: true,
});

window.ZenHasPolyfill = hasPolyfillInstance;
