/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html } from "chrome://global/content/vendor/lit.all.mjs";
import { ZenLibrarySearchSection } from "moz-src:///zen/library/sections/ZenLibrarySearchSection.mjs";
import { ZenLibraryMediaPreview } from "moz-src:///zen/library/ZenLibraryMediaPreview.mjs";

let lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  // This section runs in a window module loader. Shared stores/controllers
  // must use the system loader, as the footer and other windows do.
  libraryHiddenFiles: "moz-src:///zen/library/ZenLibraryHiddenFiles.sys.mjs",
  HIDDEN_FILES_CHANGED: "moz-src:///zen/library/ZenLibraryHiddenFiles.sys.mjs",
  libraryCaptures: "moz-src:///zen/library/ZenLibraryCaptures.sys.mjs",
  capturePreviewItem: "moz-src:///zen/library/ZenLibraryCaptures.sys.mjs",
  CAPTURES_CHANGED: "moz-src:///zen/library/ZenLibraryCaptures.sys.mjs",
  ZenLibraryFileMenu: "moz-src:///zen/library/ZenLibraryFileMenu.sys.mjs",
  ZenDownloadPreview: "moz-src:///zen/library/ZenDownloadPreview.sys.mjs",
  mediaFileRecord: "moz-src:///zen/library/ZenLibraryFileMenu.sys.mjs",
  nativeMediaPreview: "moz-src:///zen/library/ZenNativeMediaPreview.sys.mjs",
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
  canDrawThumbnail: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  extensionOf: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  MEDIA_EXTENSIONS: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  mediaKindOf: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

XPCOMUtils.defineLazyServiceGetter(
  lazy,
  "zenLibraryFiles",
  "@mozilla.org/zen/library-files;1",
  Ci.nsIZenLibraryFiles
);

const FILE_MIME = "application/x-moz-file";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const FOLDERS_PREF = "zen.library.media.folders";
const ENABLED_PREF = "zen.library.media.enabled";

const FOLDERS = {
  downloads: { key: "DfltDwnld", home: "Downloads" },
  documents: { key: "Docs", home: "Documents" },
  desktop: { key: "Desk", home: "Desktop" },
  screenshots: { key: "Desk", home: "Desktop" },
  pictures: { home: "Pictures" },
  music: { home: "Music" },
  videos: { home: AppConstants.platform === "macosx" ? "Movies" : "Videos" },
};

/**
 * @param {string} fileName - A file found while looking through a folder
 * @returns {string|null} How the grid shows it
 */
function kindFor(fileName) {
  const kind = lazy.mediaKindOf(fileName);
  if (kind === "video") {
    return "video";
  }
  if (kind === "image") {
    return lazy.canDrawThumbnail(fileName) ? "image" : "file";
  }
  return null;
}

// Arc's Media query reads each source folder directly, then keeps the newest
// fifty items across folder media and saved captures.
const MAX_ITEMS = 50;
const SCAN_TIMEOUT_MS = 10000;

export class ZenLibraryMediaSection extends ZenLibrarySearchSection {
  static id = "media";
  static label = "library-media-section-title";

  static properties = {
    items: { state: true },
    loading: { state: true },
    scanFailed: { state: true },
  };

  #preview = null;
  #nativePreview = null;
  #fileMenu = null;
  #scanner = null;
  #files = [];
  #captures = null;
  #capturesReady = false;
  #captureObserver = { observe: () => this.#updateItems() };
  #hiddenFiles = lazy.libraryHiddenFiles();
  #hiddenObserver = { observe: () => {
    this.#updateItems();
    if (this.#enabled) this.#scan();
  } };
  #scanId = 0;
  #scanned = [];
  #scanHandle = null;
  #cancelScan = null;
  #thumbObserver = null;
  #cardItems = new WeakMap();

  constructor() {
    super();
    this.items = [];
    this.loading = true;
    this.scanFailed = false;
  }

  static render(library) {
    return html`
      <zen-library-media-section
        class="zen-library-section"
        data-section="media"
        .library=${library}
      ></zen-library-media-section>
    `;
  }

  get searchPlaceholderL10nId() {
    return "library-media-search-placeholder";
  }

  #enabledObserver = { observe: () => this.#onEnabledChanged() };
  #foldersObserver = { observe: () => {
    if (this.#enabled) this.#scan();
  } };

  connectedCallback() {
    super.connectedCallback();
    Services.prefs.addObserver(ENABLED_PREF, this.#enabledObserver);
    Services.prefs.addObserver(FOLDERS_PREF, this.#foldersObserver);
    Services.obs.addObserver(this.#hiddenObserver, lazy.HIDDEN_FILES_CHANGED);
    this.#fileMenu = new lazy.ZenLibraryFileMenu(window);
    this.#scanner = new lazy.ZenDownloadPreview(window);
    if (!lazy.PrivateBrowsingUtils.isWindowPrivate(window)) {
      this.#captures = lazy.libraryCaptures();
      Services.obs.addObserver(this.#captureObserver, lazy.CAPTURES_CHANGED);
      this.#captures.ready.then(() => {
        if (!this.isConnected) return;
        this.#capturesReady = true;
        this.#updateItems();
      }).catch(console.error);
    }
    if (!this.#enabled) {
      this.loading = false;
      return;
    }
    this.#scanHandle = window.requestIdleCallback(() => this.#scan(), {
      timeout: 600,
    });
  }

  /** @returns {boolean} Whether looking through the folders was agreed to */
  get #enabled() {
    return Services.prefs.getBoolPref(ENABLED_PREF, false);
  }

  #enable() {
    Services.prefs.setBoolPref(ENABLED_PREF, true);
  }

  /**
   * Looking through the folders was just agreed to, or taken back, which can
   * happen from the tab's menu, from settings or from another window.
   */
  #onEnabledChanged() {
    this.#stopScan();
    this.#fileMenu?.destroy();
    this.#fileMenu = new lazy.ZenLibraryFileMenu(window);
    if (this.#enabled) {
      this.loading = true;
      this.requestUpdate();
      this.#scan();
      return;
    }
    this.#preview?.destroy();
    this.#preview = null;
    this.#nativePreview?.close("media");
    this.items = [];
    this.#files = [];
    this.#scanned = [];
    this.loading = false;
    this.scanFailed = false;
    this.requestUpdate();
  }

  /** Forgets any scan under way, so that its results are dropped. */
  #stopScan() {
    this.#scanId++;
    this.#cancelScan?.();
    if (this.#scanHandle) {
      window.cancelIdleCallback(this.#scanHandle);
      this.#scanHandle = null;
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    Services.prefs.removeObserver(ENABLED_PREF, this.#enabledObserver);
    Services.prefs.removeObserver(FOLDERS_PREF, this.#foldersObserver);
    Services.obs.removeObserver(this.#hiddenObserver, lazy.HIDDEN_FILES_CHANGED);
    if (this.#captures) Services.obs.removeObserver(this.#captureObserver, lazy.CAPTURES_CHANGED);
    this.#fileMenu?.destroy();
    this.#fileMenu = null;
    this.#stopScan();
    this.#scanner?.destroy();
    this.#scanner = null;
    this.#thumbObserver?.disconnect();
    this.#thumbObserver = null;
    this.#preview?.destroy();
    this.#preview = null;
    this.#nativePreview?.close("media");
    this.#nativePreview = null;
  }

  /**
   * @returns {string[]} Absolute paths of the folders to look through. The
   *   pref takes named locations such as "downloads" and absolute paths
   *   alike, and anything that cannot be found is passed over.
   */
  #folderNames() {
    return Services.prefs.getStringPref(FOLDERS_PREF,
      "downloads,desktop,documents,screenshots").split(",")
      .map(entry => entry.trim()).filter(Boolean);
  }

  #folders() {
    const home = Services.dirsvc.get("Home", Ci.nsIFile).path;
    const paths = [];
    for (const entry of this.#folderNames()) {
      if (PathUtils.isAbsolute(entry)) {
        paths.push(entry);
        continue;
      }
      const folder = FOLDERS[entry.toLowerCase()];
      if (!folder) {
        continue;
      }
      let path = null;
      if (folder.key) {
        try {
          path = Services.dirsvc.get(folder.key, Ci.nsIFile).path;
        } catch (error) {
          path = null;
        }
      }
      paths.push(path ?? PathUtils.join(home, folder.home));
    }
    return [...new Set(paths)];
  }

  async #scan() {
    this.#stopScan();
    const scanId = this.#scanId;
    this.#scanHandle = null;
    this.loading = this.items.length === 0;
    this.scanFailed = false;
    try {
      this.#scanned = this.#folders();
      await this.#hiddenFiles.ready;
      if (scanId !== this.#scanId) return;
      const native = await this.#scanner.mediaFiles(this.#folderNames(), this.#hiddenFiles.path);
      if (scanId !== this.#scanId) return;
      const files = native ?? await this.#scanFolders(this.#scanned);
      if (scanId !== this.#scanId) return;
      this.#applyFiles(files);
    } catch (error) {
      if (scanId !== this.#scanId) return;
      console.error("ZenLibraryMediaSection: could not load media", error);
      // Keep the last successful files and any captures saved while waiting.
      this.scanFailed = true;
    } finally {
      if (scanId === this.#scanId) this.loading = false;
    }
  }

  #applyFiles(files) {
    const found = [];
    for (const file of files) {
      const fileName = PathUtils.filename(file.path);
      const kind = file.kind === "video" ? "video" : file.kind === "image"
        ? (lazy.canDrawThumbnail(fileName) ? "image" : "file") : kindFor(fileName);
      if (!kind || this.#hiddenFiles.has(file.path)) {
        continue;
      }
      found.push({
        folder: file.root,
        path: file.path,
        name: fileName,
        extension: lazy.extensionOf(fileName),
        kind,
        modified: file.modified ?? file.lastModified,
        size: file.size,
        cloudPlaceholder: file.cloud ?? file.cloudPlaceholder,
        url: PathUtils.toFileURI(file.path),
      });
    }
    this.#files = found;
    this.#updateItems();
  }

  #updateItems() {
    if (!this.isConnected || !this.#enabled) return;
    const items = this.#files.filter(item => !this.#hiddenFiles.has(item.path));
    if (this.#capturesReady) {
      for (const capture of this.#captures.items) {
        const record = lazy.capturePreviewItem(this.#captures, capture);
        items.push({ ...record, path: record.target.path, name: record.title,
          extension: "png", kind: "image", modified: capture.createdDate,
          size: capture.bytes, url: PathUtils.toFileURI(record.target.path) });
      }
    }
    this.items = items.sort((a, b) => b.modified - a.modified).slice(0, MAX_ITEMS);
  }

  /**
   * Hands the folders to the scanner, which goes through them on a thread
   * of its own: a folder listing already carries the dates and sizes this
   * wants, so there is nothing left to ask about each file.
   *
   * @param {string[]} roots - The folders to look through
   * @returns {Promise<object[]>} What it found, newest first
   */
  #scanFolders(roots) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (files, error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (this.#cancelScan === cancel) this.#cancelScan = null;
        if (error) reject(error);
        else resolve(files);
      };
      const cancel = () => finish(null, new Error("Media scan cancelled"));
      const timer = window.setTimeout(() =>
        finish(null, new Error("Media folder query timed out")), SCAN_TIMEOUT_MS);
      this.#cancelScan = cancel;
      try {
        lazy.zenLibraryFiles.scanMedia(
          roots,
          lazy.MEDIA_EXTENSIONS,
          0,
          roots.length,
          // Apply the shared hidden-file filter before the final bound. The
          // native macOS query already does that on its background worker.
          0xffffffff,
          files => finish(files)
        );
      } catch (error) {
        finish(null, error);
      }
    });
  }

  // Interaction

  #onDragStart(event, item) {
    const file = new lazy.FileUtils.File(item.path);
    if (!file.exists()) {
      event.preventDefault();
      return;
    }
    const { dataTransfer } = event;
    dataTransfer.mozSetDataAt(FILE_MIME, file, 0);
    dataTransfer.effectAllowed = "copyMove";
    dataTransfer.setData("text/uri-list", item.url);
    dataTransfer.addElement(event.currentTarget);
  }

  #onItemContextMenu(event, item) {
    this.#fileMenu.show(event, lazy.mediaFileRecord(item), { presentation: "media" });
  }

  async #onItemClick(event, item) {
    const shown = this.#shown;
    const from = event.currentTarget.querySelector(".zen-library-media-frame");
    this.#nativePreview ??= lazy.nativeMediaPreview(window);
    if (await this.#nativePreview.open({ items: shown,
      index: shown.indexOf(item), presentation: "media" })) return;
    if (!this.isConnected || !this.items.some(current => current.path === item.path)) return;
    this.#preview ??= new ZenLibraryMediaPreview(window);
    this.#preview.open({
      items: shown,
      index: shown.indexOf(item),
      from,
    });
  }

  // Rendering

  /**
   * Builds one card, empty. Its picture is fetched only once the card comes
   * into view, so opening the tab does not read every file at once.
   *
   * @param {object} item - The media the card stands for
   * @returns {Element} Its card
   */
  #buildCard(item) {
    const card = document.createElementNS(HTML_NS, "div");
    card.className = "zen-library-media-item";
    card.draggable = true;
    card.title = item.name;
    card.addEventListener("dragstart", event => this.#onDragStart(event, item));
    card.addEventListener("click", event => this.#onItemClick(event, item));
    card.addEventListener("contextmenu", event =>
      this.#onItemContextMenu(event, item)
    );

    const frame = document.createElementNS(HTML_NS, "div");
    frame.className = "zen-library-media-frame";
    frame.dataset.kind = item.kind;
    card.appendChild(frame);

    this.#cardItems.set(card, item);
    return card;
  }

  /**
   * @param {Element} card - A card that has come into view
   */
  #loadThumb(card) {
    const item = this.#cardItems.get(card);
    const frame = card.firstElementChild;
    if (!item || !frame || frame.childElementCount) {
      return;
    }
    const kind = item.cloudPlaceholder ? "file" : item.kind;
    const picture = document.createElementNS(HTML_NS, "div");
    picture.className = "zen-library-media-picture";
    picture.dataset.kind = item._zenLibraryCapture ? "capture" : kind;
    frame.appendChild(picture);
    const make = (tag, parent = picture) => {
      const element = document.createElementNS(HTML_NS, tag);
      parent.appendChild(element);
      return element;
    };
    if (item._zenLibraryCapture) {
      // An SVG stroke keeps the native five-point dash length at every
      // aspect ratio; a CSS dashed border redistributes its dashes.
      const svgNS = "http://www.w3.org/2000/svg";
      const border = document.createElementNS(svgNS, "svg");
      border.setAttribute("class", "zen-library-media-capture-border");
      border.setAttribute("aria-hidden", "true");
      border.setAttribute("focusable", "false");
      border.appendChild(document.createElementNS(svgNS, "rect"));
      picture.appendChild(border);
    }
    if (kind === "video") {
      const video = make("video");
      video.className = "zen-library-media-thumb";
      video.src = `${item.url}#t=0.1`;
      video.preload = "metadata";
      video.muted = true;
      video.tabIndex = -1;
      const badge = make("img", frame);
      badge.className = "zen-library-media-play no-squircles";
      badge.src = "chrome://browser/skin/zen-icons/library/media-play.svg";
      badge.alt = "";
      return;
    }
    const image = make("img");
    image.decoding = "async";
    image.className =
      kind === "image"
        ? "zen-library-media-thumb"
        : "zen-library-media-thumb zen-library-media-file";
    image.src =
      kind === "image" ? item.url : `moz-icon://${item.name}?size=128`;
    image.alt = item.name;
  }

  #fillGrid() {
    const grid = this.querySelector(".zen-library-media-grid");
    if (!grid || !this.#enabled) {
      return;
    }
    const shown = this.#shown;
    const signature = shown.map(item => item.path).join("\n");
    if (grid.dataset.signature === signature) {
      return;
    }
    grid.dataset.signature = signature;
    this.#thumbObserver?.disconnect();
    this.#thumbObserver = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.#loadThumb(entry.target);
            this.#thumbObserver.unobserve(entry.target);
          }
        }
      },
      {
        root: this.querySelector(".zen-library-search-results"),
        rootMargin: "300px",
      }
    );
    const fragment = document.createDocumentFragment();
    const cards = shown.map(item => this.#buildCard(item));
    for (const card of cards) {
      fragment.appendChild(card);
    }
    grid.replaceChildren(fragment);
    for (const card of cards) {
      this.#thumbObserver.observe(card);
    }
  }

  /** @returns {object[]} What the grid shows, once the search has its say */
  get #shown() {
    const query = this.searchQuery.trim().toLowerCase();
    return this.items.filter(item => !query || item.name.toLowerCase().includes(query));
  }

  renderItems() {
    if (!this.#enabled) {
      return this.#renderOptIn();
    }
    if (this.loading) {
      return html`
        <div
          class="zen-library-empty"
          data-l10n-id="library-media-loading"
        ></div>
      `;
    }
    const shown = this.#shown;
    if (this.scanFailed) {
      return html`
        <div class="zen-library-empty" role="status">
          <span data-l10n-id="library-media-load-failed"></span>
          <button data-l10n-id="library-media-retry" @click=${() => this.#scan()}></button>
        </div>
        ${shown.length ? html`<div class="zen-library-media-grid"></div>` : null}
      `;
    }
    if (!shown.length) {
      return html`
        <div class="zen-library-empty" data-l10n-id="library-media-empty"></div>
      `;
    }
    return html`<div class="zen-library-media-grid"></div>`;
  }

  updated(changedProperties) {
    super.updated?.(changedProperties);
    this.toggleAttribute("needs-opt-in", !this.#enabled);
    this.#fillGrid();
  }

  /**
   * An empty grid behind a note saying what turning this on would do. The
   * cards are only shapes: nothing has been looked at yet.
   */
  #renderOptIn() {
    return html`
      <div class="zen-library-media-skeleton" behind></div>
      <div class="zen-library-media-opt-in">
        <div class="zen-library-media-opt-in-icon">
          <div class="empty-state-icon-image"></div>
        </div>
        <h3 data-l10n-id="library-media-opt-in-title"></h3>
        <p data-l10n-id="library-media-opt-in-body"></p>
        <button
          class="zen-big-accent-button primary zen-library-media-opt-in-button"
          data-l10n-id="library-media-opt-in-button"
          @click=${() => this.#enable()}
        ></button>
        <div class="zen-library-media-opt-in-note">
          <img src="chrome://global/skin/icons/security.svg" alt="" />
          <span data-l10n-id="library-media-opt-in-note"></span>
        </div>
      </div>
    `;
  }
}

customElements.define("zen-library-media-section", ZenLibraryMediaSection);
