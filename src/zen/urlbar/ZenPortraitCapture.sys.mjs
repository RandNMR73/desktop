// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { ZenWindowCapture } from "./ZenWindowCapture.sys.mjs";
import {
  drawPortrait,
  PORTRAIT_COLOR_STOPS,
} from "./ZenPortraitCaptureImage.mjs";
import { PrivateBrowsingUtils } from "resource://gre/modules/PrivateBrowsingUtils.sys.mjs";

/** Owns one preview and the exact document snapshot that will be copied. */
export class ZenPortraitCapture {
  #window;
  #capture;
  #panel;
  #preview;
  #accept;
  #status;
  #session;
  #sequence = 0;
  #frame = 0;
  #destroyed = false;
  #private;
  #job;

  constructor(window) {
    this.#window = window;
    this.#private = PrivateBrowsingUtils.isWindowPrivate(window);
    this.#capture = new ZenWindowCapture(window, {
      onInvalidate: () => this.close(),
    });
  }

  async open(browser, anchor, { quick = false } = {}) {
    this.close();
    if (this.#destroyed) return false;
    const sequence = ++this.#sequence;
    let shot, image;
    try {
      shot = await this.#capture.capture(browser);
      if (!shot || sequence !== this.#sequence) {
        shot?.close();
        return false;
      }
      const png = await shot.png();
      if (!png || !shot.valid()) return false;
      image = await this.#window.createImageBitmap(png);
      if (!shot.valid() || sequence !== this.#sequence) {
        image.close();
        shot.close();
        return false;
      }
      const session = (this.#session = {
        shot,
        image,
        busy: false,
        settings: {
          color:
            Math.max(
              0,
              Math.min(
                1000,
                Services.prefs.getIntPref("zen.portrait-capture.color", 875),
              ),
            ) / 1000,
          watermark: Services.prefs.getBoolPref(
            "zen.portrait-capture.watermark",
            true,
          ),
        },
      });
      if (quick) return await this.copy();
      this.#createPanel();
      this.#panel.querySelector("input[type=range]").value =
        session.settings.color * 1000;
      this.#panel.querySelector("input[type=checkbox]").checked =
        session.settings.watermark;
      this.#status.textContent = "";
      this.#accept.disabled = false;
      this.#render();
      this.#panel.openPopup(anchor, "after_end", 0, 4, false, false);
      return true;
    } catch (error) {
      if (sequence === this.#sequence) this.close();
      else {
        image?.close();
        shot?.close();
      }
      throw error;
    }
  }

  #createPanel() {
    if (this.#panel) return;
    const d = this.#window.document;
    const panel = (this.#panel = d.createXULElement("panel"));
    panel.id = "zen-portrait-capture-panel";
    panel.setAttribute("type", "arrow");
    panel.setAttribute("orient", "vertical");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Capture Window");
    const content = d.createElement("div");
    content.className = "zen-portrait-capture-content";
    const accept = (this.#accept = d.createElement("button"));
    accept.className = "zen-portrait-capture-accept";
    accept.textContent = "Capture in Portrait Mode";
    accept.addEventListener(
      "click",
      () => void this.copy().catch((error) => this.#error(error)),
    );
    const preview = (this.#preview = d.createElement("canvas"));
    preview.setAttribute("role", "img");
    preview.setAttribute("aria-label", "Capture preview");
    const controls = d.createElement("div");
    controls.className = "zen-portrait-capture-controls";
    const color = d.createElement("input");
    color.type = "range";
    color.min = "0";
    color.max = "1000";
    color.step = "1";
    color.setAttribute("aria-label", "Capture background color");
    color.style.setProperty(
      "--portrait-palette",
      `linear-gradient(to right, ${PORTRAIT_COLOR_STOPS.join(",")})`,
    );
    color.addEventListener("input", () =>
      this.#change("color", color.valueAsNumber / 1000),
    );
    const label = d.createElement("label");
    const watermark = d.createElement("input");
    watermark.type = "checkbox";
    watermark.addEventListener("change", () =>
      this.#change("watermark", watermark.checked),
    );
    label.append(watermark, "Watermark");
    controls.append(color, label);
    this.#status = d.createElement("div");
    this.#status.className = "zen-portrait-capture-status";
    this.#status.setAttribute("role", "status");
    content.append(accept, preview, controls, this.#status);
    panel.append(content);
    panel.addEventListener("popuphidden", (event) => {
      if (event.target === panel) this.close();
    });
    panel.addEventListener("popupshown", () => this.#accept.focus());
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      } else if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        void this.copy().catch((error) => this.#error(error));
      }
    });
    d.getElementById("mainPopupSet").append(panel);
  }

  #change(key, value) {
    if (!this.#session || this.#session.busy) return;
    this.#session.settings[key] = value;
    if (!this.#private) {
      if (key === "color")
        Services.prefs.setIntPref(
          "zen.portrait-capture.color",
          Math.round(value * 1000),
        );
      else Services.prefs.setBoolPref("zen.portrait-capture.watermark", value);
    }
    if (!this.#frame)
      this.#frame = this.#window.requestAnimationFrame(() => {
        this.#frame = 0;
        this.#render();
      });
  }

  #render() {
    const session = this.#session;
    if (session?.shot.valid())
      drawPortrait(this.#preview, session.image, session.settings, 280);
  }

  #error(error) {
    console.error(error);
    if (this.#session && this.#status)
      this.#status.textContent = "Capture failed. Please try again.";
  }

  async copy() {
    const session = this.#session;
    if (!session || session.busy || !session.shot.valid()) return false;
    session.busy = true;
    if (this.#accept) this.#accept.disabled = true;
    if (this.#status) this.#status.textContent = "";
    this.#panel?.setAttribute("aria-busy", "true");
    for (const control of this.#panel?.querySelectorAll("input") || [])
      control.disabled = true;
    try {
      const blob = await this.#compose(session);
      if (!blob || this.#session !== session || !session.shot.valid())
        return false;
      const copied = await session.shot.copy(blob);
      if (this.#session === session) this.close();
      return copied;
    } finally {
      session.busy = false;
      if (this.#session === session) {
        if (this.#accept) this.#accept.disabled = false;
        this.#panel?.removeAttribute("aria-busy");
        for (const control of this.#panel?.querySelectorAll("input") || [])
          control.disabled = false;
      }
    }
  }

  async #compose(session) {
    const image = await this.#window.createImageBitmap(session.image);
    if (this.#session !== session || !session.shot.valid()) {
      image.close();
      return null;
    }
    let worker;
    try {
      worker = new this.#window.Worker(
        "resource:///modules/ZenPortraitCaptureWorker.mjs",
        { type: "module" },
      );
    } catch (error) {
      image.close();
      throw error;
    }
    return new Promise((resolve, reject) => {
      const finish = (blob, error) => {
        worker.terminate();
        if (this.#job?.worker === worker) this.#job = null;
        if (error) reject(error);
        else resolve(blob);
      };
      this.#job = { worker, cancel: () => finish(null) };
      worker.onmessage = ({ data }) =>
        finish(data.blob, data.error ? new Error(data.error) : null);
      worker.onerror = (event) => {
        event.preventDefault();
        finish(null, new Error(event.message || "Portrait worker failed"));
      };
      try {
        worker.postMessage({ image, settings: session.settings }, [image]);
      } catch (error) {
        image.close();
        finish(null, error);
      }
    });
  }

  close() {
    ++this.#sequence;
    const session = this.#session;
    this.#session = null;
    this.#job?.cancel();
    if (this.#frame) this.#window.cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    if (this.#panel?.state === "open" || this.#panel?.state === "showing")
      this.#panel.hidePopup();
    if (this.#preview) this.#preview.width = this.#preview.height = 0;
    this.#panel?.removeAttribute("aria-busy");
    for (const control of this.#panel?.querySelectorAll("input") || [])
      control.disabled = false;
    session?.image.close();
    session?.shot.close();
    this.#capture.cancel();
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.close();
    this.#capture.destroy();
    this.#panel?.remove();
  }
}
