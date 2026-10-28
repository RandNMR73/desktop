// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

let actorRegistered = false;
function ensureActor() {
  if (actorRegistered) return;
  ChromeUtils.registerWindowActor("ZenWindowCapture", {
    child: { esModuleURI: "resource:///actors/ZenWindowCaptureChild.sys.mjs" },
    matches: ["http://*/*", "https://*/*"],
    allFrames: false,
    safeForUntrustedWebProcess: true,
  });
  actorRegistered = true;
}

/**
 * A page-only snapshot owned by one selected tab and one document. The portrait
 * preview/compositor will consume this service; it must never recapture a newer
 * page when the user accepts an older preview.
 *
 * No pixel capture until requested and no persistent screenshots. Call destroy() when
 * the owning UI is removed. A cancelled snapshot cannot copy to the clipboard.
 */
export class ZenWindowCapture {
  #window;
  #request;
  #destroyed = false;
  #onInvalidate;
  #workspaces;
  #spaceChanged = () => this.cancel();
  #events = ["TabSelect", "TabClose", "TabRemotenessChange"];
  #windowEvents = [
    "resize",
    "ZenWorkspacesUIUpdate",
    "ZenWorkspaceDataChanged",
  ];

  constructor(window, { onInvalidate = () => {} } = {}) {
    this.#window = window;
    this.#onInvalidate = onInvalidate;
    this.#workspaces = window.gZenWorkspaces;
    this.#workspaces?.addChangeListeners(this.#spaceChanged);
    for (const type of this.#events)
      window.gBrowser.tabContainer.addEventListener(type, this);
    for (const type of this.#windowEvents) window.addEventListener(type, this);
    window.gBrowser.addTabsProgressListener(this);
    window.addEventListener("unload", this, { once: true });
  }

  #current(request) {
    const { browser, tab, document, location, uri, width, height } = request;
    return (
      !this.#destroyed &&
      this.#request === request &&
      this.#workspaces?.activeWorkspace === request.space &&
      tab.isConnected &&
      !tab.closing &&
      tab.linkedBrowser === browser &&
      browser.isConnected &&
      this.#window.gBrowser.selectedTab === tab &&
      browser.browsingContext?.currentWindowGlobal === document &&
      browser.lastLocationChange === location &&
      browser.currentURI.spec === uri &&
      browser.clientWidth === width &&
      browser.clientHeight === height
    );
  }

  /** Returns null if ownership changes while waiting for bounds or pixels. */
  async capture(browser) {
    this.cancel();
    if (this.#destroyed) return null;
    const w = this.#window;
    const tab = w.gBrowser.getTabForBrowser(browser);
    const document = browser.browsingContext?.currentWindowGlobal;
    // Internal/extension pages use different security and capture policies.
    if (!tab || !document || !/^https?:$/.test(browser.currentURI.scheme + ":"))
      return null;
    const request = {
      browser,
      tab,
      document,
      location: browser.lastLocationChange,
      uri: browser.currentURI.spec,
      space: this.#workspaces?.activeWorkspace,
      width: browser.clientWidth,
      height: browser.clientHeight,
      canvas: null,
      encoding: null,
    };
    this.#request = request;
    if (!this.#current(request)) return this.#discard(request);
    let bitmap;
    try {
      ensureActor();
      const bounds = await document
        .getActor("ZenWindowCapture")
        .sendQuery("ZenWindowCapture:VisibleBounds");
      if (!this.#current(request)) return this.#discard(request);
      const region = visibleCaptureRegion(bounds);
      // A single document snapshot avoids stitching together different frames
      // of an animation. Viewport allocations are bounded before requesting it.
      bitmap = await document.drawSnapshot(
        new w.DOMRect(region.left, region.top, region.width, region.height),
        region.scale,
        "rgb(255,255,255)",
      );
      if (!this.#current(request)) return this.#discard(request);
      const canvas = new w.OffscreenCanvas(bitmap.width, bitmap.height);
      request.canvas = canvas;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      const valid = () => this.#current(request) && !!request.canvas;
      return Object.freeze({
        width: canvas.width,
        height: canvas.height,
        valid,
        // Return an immutable encoding, never the mutable owned canvas.
        png: () => this.#png(request),
        // A compositor may supply a PNG derived from this snapshot. Ownership
        // is checked again after encoding and after reading the blob's bytes.
        copy: async (composed = null) => {
          const blob = composed || (await this.#png(request));
          if (!blob || !valid()) return false;
          const buffer = await blob.arrayBuffer();
          if (!valid()) return false;
          const { copyPNGToClipboard } = ChromeUtils.importESModule(
            "resource:///modules/ZenImageClipboard.sys.mjs",
          );
          return copyPNGToClipboard(buffer, valid);
        },
        close: () => this.#discard(request),
      });
    } catch (error) {
      this.#discard(request);
      throw error;
    } finally {
      bitmap?.close();
    }
  }

  async #png(request) {
    if (!this.#current(request) || !request.canvas) return null;
    try {
      // Preview and copy share one encoding, even when requested concurrently.
      request.encoding ||= request.canvas.convertToBlob({ type: "image/png" });
      const blob = await request.encoding;
      return this.#current(request) ? blob : null;
    } catch (error) {
      if (!this.#current(request)) return null;
      request.encoding = null;
      throw error;
    }
  }

  #discard(request) {
    const current = this.#request === request;
    if (current) this.#request = null;
    if (request.canvas) {
      // Release the pixel backing promptly, including retained preview handles.
      request.canvas.width = request.canvas.height = 0;
      request.canvas = null;
    }
    request.encoding = null;
    if (current) this.#onInvalidate();
    return null;
  }

  cancel() {
    if (this.#request) this.#discard(this.#request);
  }

  onLocationChange(browser, progress) {
    if (progress.isTopLevel && browser === this.#request?.browser)
      this.cancel();
  }

  handleEvent(event) {
    if (event.type === "unload") this.destroy();
    else if (this.#windowEvents.includes(event.type)) this.cancel();
    else if (
      this.#request &&
      ((event.type !== "TabSelect" && event.target === this.#request.tab) ||
        !this.#current(this.#request))
    )
      this.cancel();
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.cancel();
    const w = this.#window;
    for (const type of this.#events)
      w.gBrowser.tabContainer.removeEventListener(type, this);
    for (const type of this.#windowEvents) w.removeEventListener(type, this);
    w.gBrowser.removeTabsProgressListener(this);
    this.#workspaces?.removeChangeListeners(this.#spaceChanged);
    w.removeEventListener("unload", this);
  }
}

/** Reject invalid/oversized bounds rather than silently cropping the viewport. */
export function visibleCaptureRegion(bounds) {
  const { left, top, right, bottom, devicePixelRatio: scale } = bounds;
  if (![left, top, right, bottom, scale].every(Number.isFinite) || scale <= 0)
    throw new RangeError("Invalid capture bounds");
  const width = Math.round(right) - Math.round(left);
  const height = Math.round(bottom) - Math.round(top);
  const pixelsWide = Math.ceil(width * scale);
  const pixelsHigh = Math.ceil(height * scale);
  if (
    width <= 0 ||
    height <= 0 ||
    pixelsWide > 16384 ||
    pixelsHigh > 16384 ||
    pixelsWide * pixelsHigh > 32 * 1024 * 1024
  )
    throw new RangeError("Capture exceeds the supported viewport size");
  return { left: Math.round(left), top: Math.round(top), width, height, scale };
}
