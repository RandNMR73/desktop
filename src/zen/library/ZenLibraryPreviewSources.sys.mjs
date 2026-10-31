/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export const PREVIEW_SOURCES = Object.freeze([
  "documents", "desktop", "screenshot", "capture", "download",
]);
const PREF_PREFIX = "zen.library.preview.sources.";

// A new browser window joins the current process's arrivals. A private session
// drops them when its final window closes, independently of normal windows.
export class PreviewDownloadRecords {
  records = new Set();
  #owners = 0;
  #clearWhenUnused;
  constructor(clearWhenUnused = true) { this.#clearWhenUnused = clearWhenUnused; }
  retain() { this.#owners++; }
  release() {
    if (--this.#owners === 0 && this.#clearWhenUnused) this.records.clear();
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
    if (!this.#sources.download) this.#arrivals.clear();
    for (const listener of this.#listeners) listener(this.#sources);
    this.#onChange();
  } };

  constructor(onChange = () => {}, prefs = Services.prefs, pool = new PreviewDownloadRecords()) {
    this.#prefs = prefs;
    this.#onChange = onChange;
    this.#pool = pool;
    pool.retain();
    this.#arrivals = pool.records;
    this.#sources = this.#read();
    prefs.addObserver(PREF_PREFIX, this.#observer);
  }

  #read() {
    return Object.freeze(Object.fromEntries(PREVIEW_SOURCES.map(key =>
      [key, this.#prefs.getBoolPref(PREF_PREFIX + key, true)])));
  }

  get sources() { return this.#sources; }

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

  add(download, restored = false) {
    // Arc ignores DownloadAction.onDownloadsInitialized. Old completed files
    // come from the selected folder sources, with their modification dates.
    if (!this.#destroyed && !restored) this.#arrivals.add(download);
  }

  remove(download) { this.#arrivals.delete(download); }
  downloads(records) { return records.filter(record => this.#arrivals.has(record)); }
  newest(records) { return records.findLast(record => this.#arrivals.has(record)); }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#prefs.removeObserver(PREF_PREFIX, this.#observer);
    this.#pool.release();
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
