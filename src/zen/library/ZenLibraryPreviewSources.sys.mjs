/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { downloadPreviewState } from "./ZenDownloadPreview.sys.mjs";

export const PREVIEW_SOURCES = Object.freeze([
  "documents", "desktop", "screenshot", "capture", "download",
]);
const PREF_PREFIX = "zen.library.preview.sources.";
const FOLDER_SOURCES = ["download", "documents", "desktop", "screenshot"];

// NSString's nonlocalized compare: canonically equivalent paths compare equal,
// otherwise compare Unicode scalars (not JS UTF-16 units or locale collation).
export function comparePreviewPaths(left, right) {
  const a = Array.from(left.normalize("NFD")), b = Array.from(right.normalize("NFD"));
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const order = a[i].codePointAt(0) - b[i].codePointAt(0);
    if (order) return order;
  }
  return a.length - b.length;
}

// Select the native newest four before the oldest-first display merge with
// live downloads/captures. Sending all sixteen there changes equal-date ties.
export function mergePreviewSourceFiles(snapshots, accept = () => true) {
  const byPath = new Map();
  for (const files of snapshots) {
    for (const file of files) {
      const path = file.target.path, previous = byPath.get(path);
      const newest = previous && previous._zenModified > file._zenModified ? previous : file;
      byPath.set(path, previous ? { ...newest,
        _zenMediaFile: !!(previous._zenMediaFile || file._zenMediaFile) } : file);
    }
  }
  return [...byPath.values()].filter(accept).sort((a, b) => {
    const date = b._zenModified - a._zenModified;
    if (date) return date;
    return comparePreviewPaths(a.target.path, b.target.path);
  }).slice(0, 4);
}

/** Successful folder snapshots survive an unavailable sibling source. */
export class PreviewSourceFiles {
  #snapshots = new Map();
  #sources = {};
  #generation = 0;
  #sourceGenerations = new Map();
  #destroyed = false;
  #pending = new Map();
  #request;
  #changed;
  #error;

  constructor(request, changed, error = console.error) {
    this.#request = request;
    this.#changed = changed;
    this.#error = error;
  }

  configure(sources) {
    this.invalidate();
    this.#sources = { ...sources };
    for (const source of this.#snapshots.keys()) {
      if (!sources[source]) this.#snapshots.delete(source);
    }
  }

  invalidate() { this.#generation++; }
  reset(source) {
    if (!FOLDER_SOURCES.includes(source)) throw new TypeError("Invalid folder source");
    this.#sourceGenerations.set(source, (this.#sourceGenerations.get(source) || 0) + 1);
    if (this.#snapshots.delete(source)) this.#changed();
  }
  files(accept) {
    return mergePreviewSourceFiles(FOLDER_SOURCES.map(source => this.#snapshots.get(source) || []), accept);
  }

  refresh() {
    if (this.#destroyed) return Promise.resolve();
    return Promise.all(FOLDER_SOURCES.filter(source => this.#sources[source])
      .map(source => this.#refreshSource(source)));
  }

  #refreshSource(source) {
    const pending = this.#pending.get(source);
    if (pending) { pending.again = true; return pending.promise; }
    const generation = this.#generation;
    const sourceGeneration = this.#sourceGenerations.get(source) || 0;
    const current = () => !this.#destroyed && generation === this.#generation &&
      sourceGeneration === (this.#sourceGenerations.get(source) || 0);
    const job = { again: false, promise: null };
    this.#pending.set(source, job);
    job.promise = (async () => {
      try {
        const files = await this.#request(source, current);
        if (!current()) return;
        this.#snapshots.set(source, files);
        this.#changed();
      } catch (error) {
        if (current()) this.#error(error);
      } finally {
        this.#pending.delete(source);
        // One active request and one coalesced retry per source. A stalled
        // directory never holds up another directory's next hover refresh.
        if (job.again && !this.#destroyed && this.#sources[source]) {
          return this.#refreshSource(source);
        }
      }
    })();
    return job.promise;
  }

  destroy() {
    this.#destroyed = true;
    this.invalidate();
    this.#snapshots.clear();
  }
}

const terminal = state => ["completed", "failed", "cancelled"].includes(state);
const timers = () => ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");

/** Process-level badge identity, independent of any window's expanded view. */
export class PreviewDownloadBadge {
  #current = null;
  #timer = null;
  #generation = 0;
  #clock;
  #replacement;
  #listeners = new Set();

  constructor(replacement = () => null, clock = {
    setTimeout: (...args) => timers().setTimeout(...args),
    clearTimeout: handle => timers().clearTimeout(handle),
  }) {
    this.#replacement = replacement;
    this.#clock = clock;
  }

  get current() { return this.#current; }
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #cancel() {
    this.#generation++;
    if (this.#timer !== null) this.#clock.clearTimeout(this.#timer);
    this.#timer = null;
  }

  #schedule() {
    this.#cancel();
    const item = this.#current, state = downloadPreviewState(item);
    if (!terminal(state)) return;
    const generation = this.#generation;
    // Arc's cancellable delayed dismissal replaces any previous expiry.
    this.#timer = this.#clock.setTimeout(() => {
      if (generation !== this.#generation || this.#current !== item) return;
      this.#timer = null;
      this.dismiss(item);
    }, state === "completed" ? 30000 : 5000);
  }

  select(item) {
    if (item === this.#current) return;
    this.#current = item ?? null;
    this.#schedule();
    for (const listener of this.#listeners) listener(this.#current);
  }

  changed(item) {
    if (item !== this.#current) return;
    if (terminal(downloadPreviewState(item))) {
      const replacement = this.#replacement(item);
      if (replacement) { this.select(replacement); return; }
    }
    this.#schedule();
  }

  dismiss(item = this.#current) {
    if (!item || item !== this.#current) return;
    this.select(this.#replacement(item));
  }

  expand() {
    if (terminal(downloadPreviewState(this.#current))) this.dismiss();
  }

  clear() {
    this.#cancel();
    this.select(null);
  }
}

// A new browser window joins the current process's arrivals. A private session
// drops them when its final window closes, independently of normal windows.
export class PreviewDownloadRecords {
  records = new Set();
  #owners = new Set();
  #clearWhenUnused;
  #visible = [];
  #attempts = new WeakMap();
  badge;
  constructor(clearWhenUnused = true, clock) {
    this.#clearWhenUnused = clearWhenUnused;
    this.badge = new PreviewDownloadBadge(current => {
      // The widget supplies the four displayed items, oldest first. Files and
      // captures occupy slots too, but only another active download replaces.
      for (let i = this.#visible.length - 1; i >= 0; i--) {
        const item = this.#visible[i];
        if (item !== current && this.records.has(item) && !item.deleted &&
            downloadPreviewState(item) === "active") return item;
      }
      return null;
    }, clock);
  }
  setVisible(items) { this.#visible = items.slice(-4); }
  remember(download) {
    this.#attempts.set(download, {state:downloadPreviewState(download), start:Number(download.startTime)});
  }
  changed(download, owner) {
    // DownloadsCommon notifies every window about the same change. Handle
    // the event once, so additional windows do not restart an expiry again.
    if (owner !== this.#owners.values().next().value || !this.records.has(download)) return;
    const previous = this.#attempts.get(download), state = downloadPreviewState(download);
    this.remember(download);
    // Gecko reuses its Download object for a retry, resetting startTime in
    // Download.start(). Treat that new failed/cancelled attempt as an arrival.
    if (state === "active" && ["failed", "cancelled"].includes(previous?.state) &&
        Number(download.startTime) !== previous.start) this.badge.select(download);
    this.badge.changed(download);
  }
  clear() {
    this.records.clear();
    this.#visible = [];
    this.#attempts = new WeakMap();
    this.badge.clear();
  }
  retain(owner) { this.#owners.add(owner); }
  release(owner) {
    this.#owners.delete(owner);
    if (!this.#owners.size && this.#clearWhenUnused) this.clear();
  }
}
const publicRecords = new PreviewDownloadRecords(false);
const privateRecords = new PreviewDownloadRecords(true);
export function previewDownloadRecords(isPrivate) {
  return isPrivate ? privateRecords : publicRecords;
}

/** Source choices are shared between windows; download arrivals are not history. */
export class ZenLibraryPreviewSources {
  #prefs;
  #onChange;
  #sources;
  #pool;
  #arrivals;
  #listeners = new Set();
  #destroyed = false;
  #observer = { observe: (_subject, _topic, name) => {
    if (this.#destroyed) return;
    if (!PREVIEW_SOURCES.some(key => PREF_PREFIX + key === name)) return;
    this.#sources = this.#read();
    // Arc reconfigures existing items for every source change. New downloads
    // still arrive through DownloadAction.create, independently of this menu.
    if (!this.#sources.download) this.#pool.clear();
    for (const listener of this.#listeners) listener(this.#sources);
    this.#onChange();
  } };

  constructor(onChange = () => {}, prefs = Services.prefs, pool = new PreviewDownloadRecords()) {
    this.#prefs = prefs;
    this.#onChange = onChange;
    this.#pool = pool;
    pool.retain(this);
    this.#arrivals = pool.records;
    this.#sources = this.#read();
    prefs.addObserver(PREF_PREFIX, this.#observer);
  }

  #read() {
    return Object.freeze(Object.fromEntries(PREVIEW_SOURCES.map(key =>
      [key, this.#prefs.getBoolPref(PREF_PREFIX + key, true)])));
  }

  get sources() { return this.#sources; }
  get badge() { return this.#pool.badge; }
  setVisible(items) { this.#pool.setVisible(items); }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  set(source, enabled) {
    if (this.#destroyed) return;
    if (!PREVIEW_SOURCES.includes(source) || typeof enabled !== "boolean")
      throw new TypeError("Invalid preview source preference");
    this.#prefs.setBoolPref(PREF_PREFIX + source, enabled);
  }

  add(download, restored = false, notify = true) {
    // Arc ignores DownloadAction.onDownloadsInitialized. Old completed files
    // come from the selected folder sources, with their modification dates.
    if (this.#destroyed || restored || this.#arrivals.has(download)) return;
    this.#arrivals.add(download);
    this.#pool.remember(download);
    if (notify) this.badge.select(download);
  }

  changed(download) { this.#pool.changed(download, this); }

  remove(download) {
    this.#arrivals.delete(download);
    this.badge.dismiss(download);
  }
  downloads(records) { return records.filter(record => this.#arrivals.has(record)); }
  newest(records) { return records.findLast(record => this.#arrivals.has(record)); }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#prefs.removeObserver(PREF_PREFIX, this.#observer);
    this.#pool.release(this);
    this.#listeners.clear();
  }
}

export class ZenLibraryPreviewSourceMenu {
  #window;
  #preferences;
  #onOpen;
  #onClose;
  #popup = null;
  #generation = 0;
  #destroyed = false;
  #unsubscribe;

  constructor(window, preferences, { onOpen = () => {}, onClose = () => {} } = {}) {
    this.#window = window;
    this.#preferences = preferences;
    this.#onOpen = onOpen;
    this.#onClose = onClose;
    this.#unsubscribe = preferences.subscribe(() => this.#updateChecks());
  }

  #updateChecks() {
    for (const item of this.#popup?.children || []) {
      if (item.dataset.source) item.setAttribute("checked",
        String(this.#preferences.sources[item.dataset.source]));
    }
  }

  async show(event) {
    event.preventDefault();
    event.stopPropagation();
    if (this.#destroyed) return;
    const generation = ++this.#generation;
    this.#popup?.hidePopup();
    this.#popup?.remove();
    this.#popup = null;
    this.#onOpen();
    const doc = this.#window.document;
    const popup = doc.createXULElement("menupopup");
    popup.id = "zen-library-preview-source-menu";
    popup.className = "zen-library-download-menu";
    const header = doc.createXULElement("menuitem");
    header.disabled = true;
    doc.l10n.setAttributes(header, "library-preview-sources-header");
    popup.appendChild(header);
    for (const source of PREVIEW_SOURCES) {
      const item = doc.createXULElement("menuitem");
      item.dataset.source = source;
      item.setAttribute("type", "checkbox");
      item.setAttribute("autocheck", "false");
      item.setAttribute("checked", String(this.#preferences.sources[source]));
      doc.l10n.setAttributes(item, "library-preview-source-" + source);
      item.addEventListener("command", () => {
        this.#preferences.set(source, !this.#preferences.sources[source]);
      });
      popup.appendChild(item);
    }
    try {
      await doc.l10n.translateFragment(popup);
      if (this.#destroyed || generation !== this.#generation) return;
      popup.addEventListener("popuphidden", () => {
        popup.remove();
        if (generation === this.#generation) {
          this.#popup = null;
          this.#onClose();
        }
      }, { once: true });
      doc.getElementById("mainPopupSet").appendChild(popup);
      this.#popup = popup;
      this.#updateChecks();
      popup.openPopupAtScreen(event.screenX, event.screenY, true, event);
    } catch (error) {
      popup.remove();
      if (generation === this.#generation) {
        this.#popup = null;
        this.#onClose();
      }
      console.error(error);
    }
  }

  destroy() {
    this.#destroyed = true;
    this.#generation++;
    this.#unsubscribe();
    this.#popup?.hidePopup();
    this.#popup?.remove();
    this.#popup = null;
  }
}
