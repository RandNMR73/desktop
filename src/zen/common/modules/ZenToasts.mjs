// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const DEFAULT_TOAST_TIMEOUT_MS = 2000;

/**
 * Shows short-lived toast messages in the window's toast container.
 */
export class nsZenToastManager {
  // One lifetime per visible message. Replacing a lifetime invalidates both
  // its timer and any animation completion that is already queued.
  #states = new Map();
  #container = null;
  #nativeCopySequence = 0;

  get #toastContainer() {
    if (!this.#container) {
      this.#container = document.getElementById("zen-toast-container");
    }
    return this.#container;
  }

  /**
   * @param {string} messageId - Fluent id of the toast label.
   * @param {object} [options]
   * @param {object} [options.l10nArgs] - Fluent args for the label.
   * @param {string} [options.descriptionId] - Fluent id of a second line.
   * @param {number} [options.timeout] - Auto-hide delay in milliseconds.
   * @param {{id: string, command: Function}} [options.button] - Action button.
   */
  async show(messageId, options = {}) {
    if (messageId === "zen-copy-current-url-confirmation" && options.nativeCopyURL) {
      const sequence = ++this.#nativeCopySequence;
      try {
        const { showNativeCopyToast } = ChromeUtils.importESModule("resource:///modules/zen/ZenNativeTheme.sys.mjs");
        const label = await document.l10n.formatValue(messageId, options.l10nArgs);
        const current = () => sequence === this.#nativeCopySequence;
        if (!current()) return;
        const shown = await showNativeCopyToast(window, {
          label, url: options.nativeCopyURL.url ?? null,
          height: window.innerHeight, timeout: options.timeout ?? DEFAULT_TOAST_TIMEOUT_MS,
          hold: Services.prefs.getBoolPref("ui.popup.disable_autohide", false),
        }, current);
        if (!current()) return;
        if (shown) {
          const old = this.#states.get(messageId);
          if (old) { this.#stop(old); old.toast.remove(); this.#states.delete(messageId); }
          if (this.#container && !this.#container.children.length) this.#container.setAttribute("hidden", true);
          return;
        }
      } catch { /* Missing library, unsupported window or locale: normal toast. */ }
      if (sequence !== this.#nativeCopySequence) return;
    }
    const previous = this.#states.get(messageId);
    if (previous) {
      this.#stop(previous);
    }
    const [toast, reused] = this.#createToastElement(messageId, options);
    const container = this.#toastContainer;
    container.removeAttribute("hidden");
    container.appendChild(toast);

    let cancelAnimation;
    const cancelled = new Promise((resolve) => {
      cancelAnimation = resolve;
    });
    const state = {
      toast,
      options,
      cancelAnimation,
      timer: null,
      animation: null,
      hovered: reused && !!previous?.hovered,
      timeout: options.timeout ?? DEFAULT_TOAST_TIMEOUT_MS,
      hiding: false,
      entering: true,
    };
    this.#states.set(messageId, state);
    state.hide = () => {
      state.timer = null;
      if (this.#states.get(messageId) === state && !toast.isConnected) {
        this.#states.delete(messageId);
      }
      if (
        this.#states.get(messageId) !== state ||
        state.hovered ||
        !toast.isConnected ||
        Services.prefs.getBoolPref("ui.popup.disable_autohide")
      ) {
        return;
      }
      state.hiding = true;
      state.animation = gZenUIManager.motion.animate(
        toast,
        { opacity: [1, 0], scale: [1, 0.5] },
        { duration: 0.2, bounce: 0, reduceMotion: false },
      );
      Promise.race([state.animation, cancelled]).then(() => {
        if (this.#states.get(messageId) !== state || !state.hiding) {
          return;
        }
        this.#states.delete(messageId);
        toast.remove();
        if (!container.children.length) {
          container.setAttribute("hidden", true);
        }
      });
    };

    if (!reused) {
      toast.addEventListener("mouseover", (event) => {
        if (toast.contains(event.relatedTarget)) {
          return;
        }
        const current = this.#states.get(messageId);
        if (current?.toast !== toast) {
          return;
        }
        current.hovered = true;
        this.#clearTimer(current);
        if (current.hiding) {
          this.show(messageId, current.options);
        }
      });
      toast.addEventListener("mouseout", (event) => {
        if (toast.contains(event.relatedTarget)) {
          return;
        }
        const current = this.#states.get(messageId);
        if (current?.toast === toast) {
          current.hovered = false;
          this.#scheduleHide(current);
        }
      });
    }

    if (reused) {
      // Repeated copies update immediately, without shrinking the current
      // notification or making its share button temporarily disappear.
      // Update Motion's cached values too: stopping an outgoing animation
      // and writing inline styles alone can leave its next frame half-faded.
      state.animation = gZenUIManager.motion.animate(
        toast,
        { scale: 1, opacity: 1 },
        { duration: 0, reduceMotion: false },
      );
    } else {
      toast.style.transform = "scale(0)";
      state.animation = gZenUIManager.motion.animate(
        toast,
        { scale: 1, opacity: 1 },
        { type: "spring", bounce: 0.2, duration: 0.5, reduceMotion: false },
      );
    }
    await Promise.race([state.animation, cancelled]);
    if (this.#states.get(messageId) === state) {
      state.entering = false;
      state.animation = null;
      this.#scheduleHide(state);
    }
  }

  #clearTimer(state) {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  #stop(state) {
    this.#clearTimer(state);
    state.hiding = false;
    state.cancelAnimation();
    state.animation?.stop();
  }

  #scheduleHide(state) {
    this.#clearTimer(state);
    if (!state.hovered && !state.entering) {
      state.timer = setTimeout(state.hide, state.timeout);
    }
  }

  /**
   * @param {string} messageId - Fluent id of the toast label.
   * @param {object} options - Options passed to show().
   * @returns {[Element, boolean]} The toast element and whether it was an
   *   already visible toast for the same message.
   */
  #createToastElement(messageId, options) {
    const createButton = () => {
      const button = document.createXULElement("button");
      button.id = options.button.id;
      button.classList.add("footer-button", "primary");
      button.addEventListener("command", options.button.command);
      return button;
    };

    const existing = [...this.#toastContainer.children].find(
      (child) => child._messageId === messageId,
    );
    const wrapper = existing || document.createXULElement("hbox");
    // Replace all content, including an action that is no longer available.
    // A non-shareable URL must never retain the preceding URL's share action.
    wrapper.replaceChildren();
    wrapper.removeAttribute("button");
    const element = document.createXULElement("vbox");
    const label = document.createXULElement("label");
    document.l10n.setAttributes(label, messageId, options.l10nArgs);
    element.appendChild(label);
    if (options.descriptionId) {
      const description = document.createXULElement("label");
      description.classList.add("description");
      document.l10n.setAttributes(description, options.descriptionId, options);
      element.appendChild(description);
    }
    wrapper.appendChild(element);
    if (options.button) {
      wrapper.appendChild(createButton());
      wrapper.setAttribute("button", true);
    }
    wrapper.classList.add("zen-toast");
    wrapper._messageId = messageId;
    wrapper.setAttribute("data-zen-toast-message", messageId);
    return [wrapper, !!existing];
  }
}
