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
  #active = null;
  #queue = new Map();
  #sources = new WeakMap();
  #desired = new WeakMap();
  #applied = new WeakMap();
  #decoded = new Map();
  #destroyed = false;
  #appearanceObserver;
  #appearanceMedia;
  #onSelect = () => this.update(this.#window.gBrowser.selectedTab);
  #onAppearance = () => {
    this.#onSelect();
    for (const tab of this.#window.gBrowser.tabs) {
      if (tab.hasAttribute("zen-essential")) this.update(tab);
    }
  };
  #onClose = event => { this.#forget(event.target); this.#pump(); };
  #onUnload = () => this.destroy();

  constructor(window) {
    this.#window = window;
    window.gBrowser.tabContainer.addEventListener("TabSelect", this.#onSelect);
    window.gBrowser.tabContainer.addEventListener("TabClose", this.#onClose);
    window.addEventListener("unload", this.#onUnload, { once: true });
    this.#appearanceObserver = new window.MutationObserver(this.#onAppearance);
    this.#appearanceObserver.observe(window.document.documentElement, {
      attributes: true, attributeFilter: ["zen-should-be-dark-mode"],
    });
    this.#appearanceMedia = window.matchMedia("(prefers-color-scheme: dark)");
    this.#appearanceMedia.addEventListener("change", this.#onAppearance);
  }

  #release(job) {
    this.#window.clearTimeout(job.timer);
    if (job.request) backend?.release(job.request);
    job.request = 0;
    if (job.image) {
      job.image.onload = job.image.onerror = null;
      job.image.src = "";
      job.image = null;
    }
  }

  #forget(tab) {
    this.#desired.delete(tab);
    for (const [key, job] of this.#queue) {
      job.tabs.delete(tab);
      if (!job.tabs.size) this.#queue.delete(key);
    }
    if (this.#active) {
      this.#active.tabs.delete(tab);
      if (!this.#active.tabs.size) {
        this.#release(this.#active);
        this.#active = null;
      }
    }
  }

  invalidate(tab, source) {
    if (source !== undefined) this.#sources.set(tab, source);
    // Repeated favicon notifications must not erase an already prepared border.
    this.update(tab);
  }

  update(tab) {
    if (this.#destroyed || !tab) return;
    if (!tab.isConnected || tab.closing || !tab.hasAttribute("zen-essential")) {
      this.#forget(tab);
      tab.style.removeProperty("--zen-favorite-outline-image");
      tab.removeAttribute("zen-favorite-outline-ready");
      this.#applied.delete(tab);
      this.#pump();
      return;
    }
    const window = this.#window;
    const icon = tab.querySelector(".tab-icon-image");
    if (!icon) return;
    const style = window.getComputedStyle(icon);
    const source = cssURL(style.content) || (this.#sources.has(tab)
      ? this.#sources.get(tab) : tab.getAttribute("image"));
    const size = parseFloat(style.width) || 16;
    const scale = Math.min(4, Math.max(1, window.devicePixelRatio));
    const key = JSON.stringify([source, size, scale, style.filter]);
    if (this.#desired.get(tab) === key && (this.#applied.get(tab) === key ||
        this.#active?.tabs.has(tab) || this.#queue.get(key)?.tabs.has(tab))) return;
    this.#forget(tab);
    if (!source || source.length > 1400000 || !native()) {
      tab.style.removeProperty("--zen-favorite-outline-image");
      tab.removeAttribute("zen-favorite-outline-ready");
      this.#applied.delete(tab);
      this.#pump(); return;
    }
    this.#desired.set(tab, key);
    if (cache.has(key) && this.#decoded.has(key)) {
      const image = cache.get(key);
      cache.delete(key); cache.set(key, image);
      this.#apply(tab, image, key);
    } else if (this.#active?.key === key) {
      this.#active.tabs.add(tab);
    } else if (this.#queue.has(key)) {
      this.#queue.get(key).tabs.add(tab);
    } else {
      while (this.#queue.size >= 64) this.#queue.delete(this.#queue.keys().next().value);
      this.#queue.set(key, { key, source, size, scale, filter: style.filter, tabs: new Set([tab]),
        timer: 0, request: 0, image: null });
    }
    this.#pump();
  }

  #finish(job, result = null) {
    if (this.#active !== job) return;
    if (result && job.image) {
      const decoded = job.image;
      decoded.onload = decoded.onerror = null;
      job.image = null;
      // Keep the decode alive. Clearing Image.src here discarded the pixels
      // before the selected-only CSS background first tried to paint them.
      this.#decoded.delete(job.key);
      while (this.#decoded.size >= 64) this.#decoded.delete(this.#decoded.keys().next().value);
      this.#decoded.set(job.key, decoded);
    }
    this.#release(job);
    this.#active = null;
    if (result) {
      remember(job.key, result);
      for (const tab of job.tabs) {
        if (this.#desired.get(tab) === job.key && tab.isConnected && !tab.closing &&
            tab.hasAttribute("zen-essential")) this.#apply(tab, result, job.key);
      }
    }
    this.#pump();
  }

  #pump() {
    if (this.#destroyed || this.#active || !this.#queue.size) return;
    // Precompute from loaded artwork, one render at a time. Selection keeps its
    // prepared result and prioritizes a pending icon without cancelling others.
    const selected = this.#window.gBrowser.selectedTab;
    const job = [...this.#queue.values()].find(item => item.tabs.has(selected)) || this.#queue.values().next().value;
    this.#queue.delete(job.key);
    this.#active = job;
    // Another window may already have rendered these exact pixels. Only the
    // local decode is missing; do not reload the favicon or repeat Core Image.
    const cached = cache.get(job.key);
    if (cached) {
      this.#decode(job, cached);
      return;
    }
    const window = this.#window;
    const image = job.image = new window.Image();
    job.timer = window.setTimeout(() => this.#finish(job), 5000);
    image.onerror = () => this.#finish(job);
    image.onload = () => {
      if (this.#active !== job) return;
      window.clearTimeout(job.timer); job.timer = 0;
      job.image = null;
      image.onload = image.onerror = null;
      try {
        const vector = /(?:\.svg(?:[?#]|$)|^data:image\/svg\+xml)/i.test(job.source);
        const factor = Math.min(vector ? job.scale : 1,
          512 / Math.max(image.naturalWidth, image.naturalHeight, 1));
        const width = Math.max(1, Math.min(512, Math.round(image.naturalWidth * factor)));
        const height = Math.max(1, Math.min(512, Math.round(image.naturalHeight * factor)));
        const canvas = window.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext("2d");
        if (job.filter !== "none") context.filter = job.filter;
        context.drawImage(image, 0, 0, width, height);
        const binary = window.atob(canvas.toDataURL("image/png").split(",")[1]);
        if (binary.length > 1048576) { this.#finish(job); return; }
        job.request = backend.start(Array.from(binary, char => char.charCodeAt(0)), job.size, job.scale);
        if (!job.request) { this.#finish(job); return; }
        const deadline = window.performance.now() + 5000;
        const poll = () => {
          job.timer = 0;
          if (this.#active !== job) return;
          const result = backend.read(job.request);
          if (result === 0 && window.performance.now() < deadline) {
            job.timer = window.setTimeout(poll, 16);
            return;
          }
          backend.release(job.request);
          job.request = 0;
          if (typeof result !== "string") { this.#finish(job); return; }
          this.#decode(job, result);
        };
        poll();
      } catch (error) {
        this.#finish(job);
        console.error("Favorite outline:", error);
      }
    };
    image.src = job.source;
  }

  #decode(job, result) {
    // Decode before marking ready, even while unselected. Keep the same
    // cancellation and stale-result checks for rendered and cached borders.
    const window = this.#window;
    const decoded = job.image = new window.Image();
    job.timer = window.setTimeout(() => this.#finish(job), 5000);
    decoded.onload = () => {
      if (this.#active !== job) return;
      if (typeof decoded.decode === "function")
        decoded.decode().then(() => this.#finish(job, result), () => this.#finish(job));
      else this.#finish(job, result);
    };
    decoded.onerror = () => this.#finish(job);
    decoded.src = result;
  }

  #apply(tab, image, key) {
    tab.style.setProperty("--zen-favorite-outline-image", `url("${image}")`);
    tab.setAttribute("zen-favorite-outline-ready", "true");
    this.#applied.set(tab, key);
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#queue.clear();
    this.#decoded.clear();
    if (this.#active) this.#release(this.#active);
    this.#active = null;
    this.#window.gBrowser.tabContainer.removeEventListener("TabSelect", this.#onSelect);
    this.#window.gBrowser.tabContainer.removeEventListener("TabClose", this.#onClose);
    this.#window.removeEventListener("unload", this.#onUnload);
    this.#appearanceObserver.disconnect();
    this.#appearanceMedia.removeEventListener("change", this.#onAppearance);
  }
}
