/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

let library;
let backend;
const cache = new Map();
let cacheBytes = 0;

function native() {
  if (backend !== undefined) return backend;
  backend = null;
  if (Services.appinfo.OS !== "Darwin") return null;
  try {
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const executable = Services.dirsvc.get("XREExeF", Ci.nsIFile);
    library = ctypes.open(PathUtils.join(executable.parent.path, "libzen-native-theme.dylib"));
    const declare = (name, result, ...args) => library.declare(name, ctypes.default_abi, result, ...args);
    if (declare("zen_favorite_outline_version", ctypes.int)() !== 1) return null;
    const start = declare("zen_favorite_outline_request", ctypes.uint32_t,
      ctypes.uint8_t.ptr, ctypes.uint32_t, ctypes.double, ctypes.double);
    const read = declare("zen_favorite_outline_result", ctypes.int32_t,
      ctypes.uint32_t, ctypes.uint8_t.ptr, ctypes.uint32_t);
    const release = declare("zen_favorite_outline_release", ctypes.void_t, ctypes.uint32_t);
    backend = {
      start(bytes, size, scale) {
        const data = ctypes.uint8_t.array(bytes.length)(bytes);
        return start(data, bytes.length, size, scale);
      },
      read(id) {
        const count = read(id, null, 0);
        if (count <= 0) return count;
        if (count > 262144) return -1;
        const data = ctypes.uint8_t.array(count)();
        if (read(id, data, count) !== count) return -1;
        let binary = "";
        for (let i = 0; i < count; i++) binary += String.fromCharCode(data[i]);
        return `data:image/png;base64,${btoa(binary)}`;
      }, release,
    };
  } catch { /* Older or non-macOS bundles retain the neutral outline. */ }
  return backend;
}

function remember(key, image) {
  if (cache.has(key)) {
    cacheBytes -= (key.length + cache.get(key).length) * 2;
    cache.delete(key);
  }
  const bytes = (key.length + image.length) * 2;
  if (bytes > 8 * 1024 * 1024) return;
  while (cache.size && (cache.size >= 64 || cacheBytes + bytes > 8 * 1024 * 1024)) {
    const oldest = cache.keys().next().value;
    cacheBytes -= (oldest.length + cache.get(oldest).length) * 2;
    cache.delete(oldest);
  }
  cache.set(key, image);
  cacheBytes += bytes;
}

function cssURL(value) {
  const match = /^url\((".*")\)$/.exec(value);
  try { return match ? JSON.parse(match[1]) : ""; } catch { return ""; }
}

// Observe the icon actually displayed (including custom artwork and the daily
// Calendar image). No hostname, palette lookup, page read, or network request
// is needed to decide its border colors.
export class ZenFavoriteOutline {
  #window;
  #generation = 0;
  #request = 0;
  #timer = 0;
  #image = null;
  #active = null;
  #sources = new WeakMap();
  #destroyed = false;
  #onSelect = () => this.update(this.#window.gBrowser.selectedTab);
  #onClose = event => {
    if (this.#active?.tab === event.target) this.#cancel();
  };
  #onUnload = () => this.destroy();

  constructor(window) {
    this.#window = window;
    window.gBrowser.tabContainer.addEventListener("TabSelect", this.#onSelect);
    window.gBrowser.tabContainer.addEventListener("TabClose", this.#onClose);
    window.addEventListener("unload", this.#onUnload, { once: true });
  }

  #cancel() {
    this.#generation++;
    this.#window.clearTimeout(this.#timer);
    this.#timer = 0;
    if (this.#request) backend?.release(this.#request);
    this.#request = 0;
    if (this.#image) {
      this.#image.onload = this.#image.onerror = null;
      this.#image.src = "";
      this.#image = null;
    }
    this.#active = null;
  }

  invalidate(tab, source) {
    if (source !== undefined) this.#sources.set(tab, source);
    tab.style.removeProperty("--zen-favorite-outline-image");
    tab.removeAttribute("zen-favorite-outline-ready");
    if (this.#active?.tab === tab) this.#cancel();
    if (tab === this.#window.gBrowser.selectedTab) this.update(tab);
  }

  update(tab) {
    if (this.#destroyed) return;
    if (!tab?.isConnected || tab.closing || !tab.hasAttribute("zen-essential")) {
      this.#cancel();
      return;
    }
    const window = this.#window;
    const icon = tab.querySelector(".tab-icon-image");
    if (!icon) return;
    const style = window.getComputedStyle(icon);
    const override = cssURL(style.content);
    const source = override || (this.#sources.has(tab)
      ? this.#sources.get(tab) : tab.getAttribute("image"));
    const size = parseFloat(style.width) || 16;
    const scale = Math.min(4, Math.max(1, window.devicePixelRatio));
    const key = JSON.stringify([source, size, scale, style.filter]);
    if (this.#active?.tab === tab && this.#active.key === key) return;
    this.#cancel();
    tab.style.removeProperty("--zen-favorite-outline-image");
    tab.removeAttribute("zen-favorite-outline-ready");
    if (!source || source.length > 1400000 || !native()) return;
    this.#active = { tab, key };
    if (cache.has(key)) {
      const image = cache.get(key);
      cache.delete(key); cache.set(key, image);
      this.#apply(tab, image);
      return;
    }
    const generation = this.#generation;
    const image = new window.Image();
    this.#image = image;
    image.onerror = () => {
      if (generation === this.#generation) this.#cancel();
    };
    image.onload = () => {
      if (generation !== this.#generation) return;
      this.#image = null;
      image.onload = image.onerror = null;
      try {
        // Favicon bitmaps retain their source pixels. Vector artwork uses its
        // intrinsic canvas at display scale (e.g. a 46pt app-tray asset at 2x).
        const vector = /(?:\.svg(?:[?#]|$)|^data:image\/svg\+xml)/i.test(source);
        const factor = Math.min(vector ? scale : 1,
          512 / Math.max(image.naturalWidth, image.naturalHeight, 1));
        const width = Math.max(1, Math.min(512, Math.round(image.naturalWidth * factor)));
        const height = Math.max(1, Math.min(512, Math.round(image.naturalHeight * factor)));
        const canvas = window.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext("2d");
        if (style.filter !== "none") context.filter = style.filter;
        context.drawImage(image, 0, 0, width, height);
        const binary = window.atob(canvas.toDataURL("image/png").split(",")[1]);
        if (binary.length > 1048576) return;
        const bytes = Array.from(binary, char => char.charCodeAt(0));
        this.#request = backend.start(bytes, size, scale);
        if (!this.#request) { this.#cancel(); return; }
        const deadline = window.performance.now() + 5000;
        const poll = () => {
          this.#timer = 0;
          if (generation !== this.#generation) return;
          const result = backend.read(this.#request);
          if (result === 0 && window.performance.now() < deadline) {
            this.#timer = window.setTimeout(poll, 16);
            return;
          }
          backend.release(this.#request);
          this.#request = 0;
          if (typeof result === "string" && tab.isConnected && !tab.closing &&
              tab.hasAttribute("zen-essential")) {
            remember(key, result);
            this.#apply(tab, result);
          }
        };
        poll();
      } catch (error) {
        this.#cancel();
        console.error("Favorite outline:", error);
      }
    };
    image.src = source;
  }

  #apply(tab, image) {
    tab.style.setProperty("--zen-favorite-outline-image", `url("${image}")`);
    tab.setAttribute("zen-favorite-outline-ready", "true");
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#cancel();
    this.#window.gBrowser.tabContainer.removeEventListener("TabSelect", this.#onSelect);
    this.#window.gBrowser.tabContainer.removeEventListener("TabClose", this.#onClose);
    this.#window.removeEventListener("unload", this.#onUnload);
  }
}
