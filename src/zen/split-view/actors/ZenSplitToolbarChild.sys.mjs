// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

export class ZenSplitToolbarChild extends JSWindowActorChild {
  #observer = null;
  #frame = null;
  #media = null;
  #last = null;

  receiveMessage({ name }) {
    if (name === "ZenSplitToolbar:Stop") this.#stop();
    if (name !== "ZenSplitToolbar:Observe" || this.#observer) return;
    this.#observer = new this.contentWindow.MutationObserver(this.#schedule);
    this.#media = this.contentWindow.matchMedia("(prefers-color-scheme: dark)");
    this.#media.addEventListener("change", this.#schedule);
    this.contentWindow.addEventListener("DOMContentLoaded", this.#ready);
    this.contentWindow.addEventListener("load", this.#stylesheetLoaded, true);
    this.#observeRoots();
    this.#publish();
  }

  #ready = () => {
    this.#schedule();
  };

  #stylesheetLoaded = event => {
    if (event.target.localName === "link" && event.target.relList?.contains("stylesheet")) {
      this.#schedule();
    }
  };

  #observeRoots() {
    const d = this.document;
    this.#observer.disconnect();
    if (d.documentElement) this.#observer.observe(d.documentElement, {
      attributes: true, attributeFilter: ["class", "style"], childList: true,
    });
    if (d.body) this.#observer.observe(d.body, {
      attributes: true, attributeFilter: ["class", "style"],
    });
    if (d.head) this.#observer.observe(d.head, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ["href", "media", "disabled", "rel"],
    });
  }

  #schedule = () => {
    if (!this.#observer || this.#frame !== null) return;
    this.#frame = this.contentWindow.requestAnimationFrame(() => {
      this.#frame = null;
      if (!this.#observer) return;
      this.#observeRoots();
      this.#publish();
    });
  };

  #publish() {
    if (!this.document.documentElement) return;
    const root = this.contentWindow.getComputedStyle(this.document.documentElement);
    const transparent = color => color === "rgba(0, 0, 0, 0)" || color === "transparent";
    let color = root.backgroundColor;
    if (transparent(color) && this.document.body) {
      color = this.contentWindow.getComputedStyle(this.document.body).backgroundColor;
    }
    if (transparent(color)) color = "Canvas";
    const value = { color, scheme: root.colorScheme };
    const key = JSON.stringify(value);
    if (this.#last === key) return;
    this.#last = key;
    this.sendAsyncMessage("ZenSplitToolbar:Color", value);
  }

  #stop() {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#media?.removeEventListener("change", this.#schedule);
    this.#media = null;
    this.contentWindow.removeEventListener("DOMContentLoaded", this.#ready);
    this.contentWindow.removeEventListener("load", this.#stylesheetLoaded, true);
    if (this.#frame !== null) this.contentWindow.cancelAnimationFrame(this.#frame);
    this.#frame = null;
    this.#last = null;
  }

  didDestroy() {
    try { this.#stop(); } catch {}
  }
}
