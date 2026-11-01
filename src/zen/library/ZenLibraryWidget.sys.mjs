/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  ZenLibraryFileMenu: "moz-src:///zen/library/ZenLibraryFileMenu.sys.mjs",
  ZenLibraryPreviewSources: "moz-src:///zen/library/ZenLibraryPreviewSources.sys.mjs",
  ZenLibraryPreviewSourceMenu: "moz-src:///zen/library/ZenLibraryPreviewSources.sys.mjs",
  previewDownloadRecords: "moz-src:///zen/library/ZenLibraryPreviewSources.sys.mjs",
  nativeMediaPreview: "moz-src:///zen/library/ZenNativeMediaPreview.sys.mjs",
  libraryHiddenFiles: "moz-src:///zen/library/ZenLibraryHiddenFiles.sys.mjs",
  HIDDEN_FILES_CHANGED: "moz-src:///zen/library/ZenLibraryHiddenFiles.sys.mjs",
  libraryCaptures: "moz-src:///zen/library/ZenLibraryCaptures.sys.mjs",
  capturePreviewItem: "moz-src:///zen/library/ZenLibraryCaptures.sys.mjs",
  CAPTURES_CHANGED: "moz-src:///zen/library/ZenLibraryCaptures.sys.mjs",
  ZenDownloadPreview: "moz-src:///zen/library/ZenDownloadPreview.sys.mjs",
  ZenDownloadThumbnails: "moz-src:///zen/library/ZenDownloadThumbnailMotion.sys.mjs",
  ZenDownloadProgress: "moz-src:///zen/library/ZenDownloadProgress.sys.mjs",
  recentDownloads: "moz-src:///zen/library/ZenDownloadPreview.sys.mjs",
  downloadDate: "moz-src:///zen/library/ZenDownloadPreview.sys.mjs",
  downloadPreviewState: "moz-src:///zen/library/ZenDownloadPreview.sys.mjs",
  downloadPreviewSubtitle: "moz-src:///zen/library/ZenDownloadPreview.sys.mjs",
  DownloadIntegration: "resource://gre/modules/DownloadIntegration.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  canDrawThumbnail: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  canRetry: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  confirmUnblock: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  isBlocked: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  retryDownload: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  transferText: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  DownloadsCommon:
    "moz-src:///browser/components/downloads/DownloadsCommon.sys.mjs",
  BrowserUtils: "resource://gre/modules/BrowserUtils.sys.mjs",
  DownloadUtils: "resource://gre/modules/DownloadUtils.sys.mjs",
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
});

const ENTRIES = 4;
// Arc's HomeButtonRegion requires 150ms of continuous hover before expansion.
const OPEN_DELAY_MS = 150;
// Arc lets the pointer cross the dock, but closes after lingering there.
const DOCK_DELAY_MS = 500;
const FILE_MIME = "application/x-moz-file";
const BADGE_MARKUP = `
  <span class="zen-library-download-badge no-squircles" aria-hidden="true">
   <span class="zen-library-download-progress-content no-squircles">
    <svg xmlns="http://www.w3.org/2000/svg"
         class="zen-library-download-progress no-squircles"
         viewBox="0 0 40 40">
      <circle class="zen-library-download-progress-face"
              cx="20" cy="20" r="12"/>
      <g class="zen-library-download-progress-rings">
        <circle class="zen-library-download-progress-track"
                cx="20" cy="20" r="10.75"/>
        <circle class="zen-library-download-progress-arc"
                cx="20" cy="20" r="10.75" pathLength="100"/>
      </g>
    </svg>
   </span>
  </span>
`;

class ZenLibraryDownloadStack {
  #button;
  #badge;
  #list;
  #library = null;
  #entries = [];
  #data;
  #downloads = [];
  #inBatch = false;
  #loaded = false;
  #unsubscribeBadge;
  #dockTimer = null;
  #openTimer = null;
  #trackingPointer = false;
  #pointerRegion = "outside";
  #hoverBounds = null;
  #resizeObserver;
  #contextMenuOpen = false;
  #preview;
  #files = [];
  #scanning = false;
  #rescan = false;
  #fileMenu;
  #sources;
  #sourceMenu;
  #fileGeneration = 0;
  #hiddenFiles;
  #captures = null;
  #capturesReady = false;
  #captureObserver = { observe: () => {
    this.#updateList();
    if (this.#buttonHovered) this.#open();
  } };
  #hiddenObserver = { observe: () => {
    this.#updateList();
    this.#refreshFiles();
  } };
  #destroyed = false;
  #refreshTimer = null;
  #buttonHovered = false;
  #buttonLingered = false;
  #badgeRequests = new WeakMap();
  #motion;
  #progress;
  #closing = null;

  /**
   * @param {Element} button - The library toolbar button
   */
  constructor(button) {
    this.#button = button;
    this.#preview = new lazy.ZenDownloadPreview(this.#window);
    this.#hiddenFiles = lazy.libraryHiddenFiles();
    this.#hiddenFiles.ready.catch(console.error);
    button.setAttribute("command", "cmd_zenToggleLibrary");
    button.classList.add("toolbarbutton-badge-stack-host");
    // Arc tracks a 32pt square around the artwork, including its 2pt inset.
    // Keep this transparent child out of layout so the visible icon stays put.
    button.appendChild(this.#parse(`<box class="zen-library-hover-region no-squircles"
      style="position: absolute; width: 32px; height: 32px;
             left: calc(50% - 16px); top: calc(50% - 16px);"/>`));
    button.appendChild(this.#parse(`<box class="zen-library-sprite"/>`));
    button.appendChild(
      this.#parse(
        `<box class="toolbarbutton-badge-stack">${BADGE_MARKUP}</box>`
      )
    );
    this.#badge = button.querySelector(".zen-library-download-badge");
    this.#badge.id = "library-button-badge";
    this.#list = this.#buildList();
    this.#footButtons.setAttribute("zen-library-continuous-thumbnails", "true");
    this.#progress = new lazy.ZenDownloadProgress(this.#window);
    this.#motion = new lazy.ZenDownloadThumbnails(this.#window,
      button.querySelector(".zen-library-sprite"), () => this.#update());
    this.#sources = new lazy.ZenLibraryPreviewSources(() => {
      this.#fileGeneration++;
      this.#files = [];
      this.#update();
      this.#refreshFiles();
    }, Services.prefs, lazy.previewDownloadRecords(
      lazy.PrivateBrowsingUtils.isWindowPrivate(this.#window)));
    this.#unsubscribeBadge = this.#sources.badge.subscribe(() => this.#update());
    this.#sourceMenu = new lazy.ZenLibraryPreviewSourceMenu(this.#window, this.#sources, {
      onOpen: () => { this.#contextMenuOpen = true; },
      onClose: () => { this.#contextMenuOpen = false; this.#close(); },
    });
    this.#fileMenu = new lazy.ZenLibraryFileMenu(this.#window, {
      onOpen: () => { this.#contextMenuOpen = true; },
      onClose: () => { this.#contextMenuOpen = false; this.#close(); },
      onChange: () => { this.#updateList(); this.#refreshFiles(); },
    });
    Services.obs.addObserver(this.#hiddenObserver, lazy.HIDDEN_FILES_CHANGED);
    if (!lazy.PrivateBrowsingUtils.isWindowPrivate(this.#window)) {
      this.#captures = lazy.libraryCaptures();
      Services.obs.addObserver(this.#captureObserver, lazy.CAPTURES_CHANGED);
      this.#captures.ready.then(() => {
        if (this.#destroyed) return;
        this.#capturesReady = true;
        this.#captureObserver.observe();
      }).catch(console.error);
    }

    button.addEventListener("mouseenter", this);
    button.addEventListener("mouseleave", this);
    button.addEventListener("contextmenu", this);
    this.#list.addEventListener("mouseenter", this);
    this.#list.addEventListener("mouseleave", this);
    this.#window.addEventListener("blur", this);
    this.#window.addEventListener("unload", this, { once: true });
    this.#resizeObserver = new this.#window.ResizeObserver(() => {
      this.#motion.resize();
      this.#measureHoverBounds();
    });
    this.#resizeObserver.observe(this.#footButtons);
    this.#resizeObserver.observe(this.#list);

    // Keep the full browser list for Library state. The preview separately
    // tracks live arrivals; persisted files come from its folder sources.
    this.#data = lazy.DownloadsCommon.getData(this.#window, true);
    this.#data.addView(this);
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#preview.destroy();
    this.#fileMenu.destroy();
    this.#sourceMenu.destroy();
    this.#unsubscribeBadge();
    this.#sources.destroy();
    Services.obs.removeObserver(this.#hiddenObserver, lazy.HIDDEN_FILES_CHANGED);
    if (this.#captures) Services.obs.removeObserver(this.#captureObserver, lazy.CAPTURES_CHANGED);
    this.#motion.destroy();
    this.#progress.destroy();
    this.#button.removeEventListener("mouseenter", this);
    this.#button.removeEventListener("mouseleave", this);
    this.#button.removeEventListener("contextmenu", this);
    this.#window.removeEventListener("unload", this);
    this.#window.removeEventListener("blur", this);
    this.#resizeObserver.disconnect();
    this.#data.removeView(this);
    this.#stopTrackingPointer();
    this.#window.clearTimeout(this.#openTimer);
    this.#window.clearTimeout(this.#refreshTimer);
    this.#list.remove();
  }

  get #window() {
    return this.#button.documentGlobal;
  }

  get #footButtons() {
    return this.#list.parentElement;
  }

  get #downloadsListWrapper() {
    return this.#window.document.getElementById(
      "TabsToolbar-customization-target"
    );
  }

  #parse(markup) {
    return this.#window.MozXULElement.parseXULToFragment(markup);
  }

  handleEvent(event) {
    switch (event.type) {
      case "mouseenter":
        if (event.currentTarget === this.#button) {
          this.#buttonHovered = true;
          this.#window.clearTimeout(this.#openTimer);
          this.#buttonLingered = false;
          this.#openTimer = this.#window.setTimeout(() => {
            this.#openTimer = null;
            this.#buttonLingered = this.#buttonHovered;
            this.#open();
          }, OPEN_DELAY_MS);
          this.#refreshFiles();
        }
        this.#trackPointer(event);
        break;
      case "mouseleave":
        if (event.currentTarget === this.#button) {
          this.#buttonHovered = false;
          this.#buttonLingered = false;
          this.#window.clearTimeout(this.#openTimer);
          this.#openTimer = null;
        }
        this.#trackPointer(event);
        break;
      case "mousemove":
        this.#trackPointer(event);
        break;
      case "mouseout":
        if (!event.relatedTarget) this.#leaveWindow();
        break;
      case "blur":
        if (event.target === this.#window) this.#leaveWindow();
        break;
      case "resize":
        this.#window.promiseDocumentFlushed(() => {
          if (!this.#destroyed) this.#measureHoverBounds();
        });
        break;
      case "unload":
        this.destroy();
        break;
      case "contextmenu":
        this.#sourceMenu.show(event);
        break;
    }
  }

  #measureHoverBounds() {
    if (!this.#trackingPointer) return;
    // These reads never force style/layout on the pointer's hot path. Refresh
    // after the rows lay out, or the window changes size, rather than per move.
    const bounds = node => this.#window.windowUtils.getBoundsWithoutFlushing(node);
    const button = bounds(this.#button.querySelector(".zen-library-hover-region"));
    const list = bounds(this.#list);
    this.#hoverBounds = {
      // The 4pt cell padding extends 2pt before the legacy row container.
      // Use its resting origin, not an animated thumbnail's current bounds.
      left: Math.min(button.left, list.left - 2),
      right: Math.max(button.right, list.right),
      top: list.top,
      bottom: button.bottom,
      dockLeft: button.right,
      dockTop: button.top,
    };
  }

  #startTrackingPointer() {
    if (this.#trackingPointer) return;
    this.#trackingPointer = true;
    this.#pointerRegion = "button";
    for (const type of ["mousemove", "mouseout", "resize"]) {
      this.#window.addEventListener(type, this);
    }
    this.#measureHoverBounds();
  }

  #stopTrackingPointer() {
    this.#window.clearTimeout(this.#dockTimer);
    this.#dockTimer = null;
    this.#trackingPointer = false;
    this.#hoverBounds = null;
    for (const type of ["mousemove", "mouseout", "resize"]) {
      this.#window.removeEventListener(type, this);
    }
  }

  #trackPointer(event) {
    const b = this.#hoverBounds;
    if (!b) return;
    const x = event.clientX, y = event.clientY;
    const inside = x >= b.left && x < b.right && y >= b.top && y < b.bottom;
    const region = !inside ? "outside" :
      y < b.dockTop ? "flyout" : x < b.dockLeft ? "button" : "dock";
    if (region === this.#pointerRegion) return;
    this.#pointerRegion = region;
    this.#window.clearTimeout(this.#dockTimer);
    this.#dockTimer = null;
    if (region === "dock") {
      this.#dockTimer = this.#window.setTimeout(() => {
        this.#dockTimer = null;
        if (!this.#contextMenuOpen) this.#close();
      }, DOCK_DELAY_MS);
    } else if (region === "outside" && !this.#contextMenuOpen) {
      this.#close();
    }
  }

  #leaveWindow() {
    this.#buttonHovered = false;
    this.#buttonLingered = false;
    this.#window.clearTimeout(this.#openTimer);
    this.#openTimer = null;
    this.#pointerRegion = "outside";
    if (!this.#contextMenuOpen) this.#close();
  }

  #open() {
    if (
      !this.#buttonLingered ||
      !this.#shown.length ||
      this.#library ||
      this.#footButtons.hasAttribute("zen-library-stack-open")
    ) {
      return;
    }
    this.#updateList();
    this.#list.setAttribute("aria-hidden", "false");
    this.#closing = null;
    for (const host of [this.#footButtons, this.#downloadsListWrapper]) {
      host.removeAttribute("zen-library-stack-closing");
      host.setAttribute("zen-library-stack-open", "true");
    }
    this.#motion.setExpanded(true);
    // Arc consumes terminal states on expansion, retaining active, paused and
    // not-started items. A quick pointer reversal must not restore a consumed badge.
    this.#sources.badge.expand();
    this.#updateBadgeShowing();
    this.#startTrackingPointer();
    const refresh = () => {
      this.#refreshTimer = null;
      this.#updateList();
      if (this.#footButtons.hasAttribute("zen-library-stack-open")) {
        this.#refreshTimer = this.#window.setTimeout(refresh, 60000);
      }
    };
    this.#refreshTimer = this.#window.setTimeout(refresh, 60000);
  }

  get #shown() {
    const files = this.#files.filter(file =>
      !this.#hiddenFiles.has(file.target.path) &&
      (file._zenMediaFile || !this.#hiddenFiles.hasDownload(file.target.path)));
    if (this.#capturesReady && this.#sources.sources.capture) {
      files.push(...this.#captures.recent(ENTRIES).map(item =>
        lazy.capturePreviewItem(this.#captures, item)));
    }
    return lazy.recentDownloads(this.#sources.downloads(this.#downloads), files);
  }

  get #selectedDownload() {
    return this.#sources.badge.current;
  }

  async #refreshFiles() {
    if (this.#destroyed || lazy.PrivateBrowsingUtils.isWindowPrivate(this.#window)) return;
    if (this.#scanning) { this.#rescan = true; return; }
    this.#scanning = true;
    const generation = this.#fileGeneration;
    const sources = this.#sources.sources;
    try {
      await this.#hiddenFiles.ready;
      const path = await lazy.DownloadIntegration.getPreferredDownloadsDirectory();
      if (this.#destroyed || generation !== this.#fileGeneration) return;
      const files = await this.#preview.sourceFiles(path, sources, this.#hiddenFiles.path);
      if (this.#destroyed || generation !== this.#fileGeneration) return;
      this.#files = files;
      this.#updateList();
      if (this.#buttonHovered) this.#open();
    } catch (error) { console.error(error); }
    finally {
      this.#scanning = false;
      if (this.#rescan) { this.#rescan = false; this.#refreshFiles(); }
    }
  }

  #close() {
    this.#window.clearTimeout(this.#refreshTimer);
    this.#refreshTimer = null;
    if (!this.#footButtons.hasAttribute("zen-library-stack-open")) {
      return;
    }
    this.#stopTrackingPointer();
    // Expansion consumes terminal badges; closing does not. A transfer that
    // finishes while expanded must return to the footer on this close.
    this.#list.setAttribute("aria-hidden", "true");
    this.#updateBadgeShowing();
    const closing = this.#closing = {};
    for (const host of [this.#footButtons, this.#downloadsListWrapper]) {
      host.setAttribute("zen-library-stack-closing", "true");
      host.removeAttribute("zen-library-stack-open");
    }
    const wrapper = this.#downloadsListWrapper;
    const fading = wrapper
      .getAnimations()
      .filter(animation => animation.transitionProperty === "mask-size")
      .map(animation => animation.finished);
    Promise.allSettled([...fading, this.#motion.setExpanded(false)]).then(() => {
      // A newer close owns its cleanup if the pointer reverses twice.
      if (!this.#destroyed && this.#closing === closing) {
        this.#closing = null;
        this.#footButtons.removeAttribute("zen-library-stack-closing");
        wrapper.removeAttribute("zen-library-stack-closing");
      }
    });
  }

  #buildList() {
    const document = this.#window.document;
    const footButtons = document.getElementById("zen-sidebar-foot-buttons");
    // Not a widget of the toolbar, so its customization leaves it alone.
    footButtons.appendChild(
      this.#parse(
        `<box id="zen-library-download-list" skipintoolbarset="true" aria-hidden="true"></box>`
      )
    );
    const list = document.getElementById("zen-library-download-list");
    for (let i = 0; i < ENTRIES; i++) {
      list.appendChild(
        this.#parse(`
          <div class="zen-library-download-list-download">
            <div class="zen-library-download-hit-target" role="button"></div>
            ${BADGE_MARKUP}
            <vbox class="zen-library-download-list-title-container" aria-hidden="true">
              <span class="zen-library-download-list-title"></span>
              <span class="zen-library-download-list-subtitle"></span>
            </vbox>
            <toolbarbutton class="toolbarbutton-1 zen-library-download-action no-squircles" />
          </div>
        `)
      );
    }
    this.#entries = [...list.children];
    for (const entry of this.#entries) {
      entry.setAttribute("draggable", "true");
      entry.addEventListener("dragstart", event =>
        this.#onDragStart(event, entry.download)
      );
      entry.addEventListener("click", event => {
        if (event.button === 0) {
          this.#openDownload(entry.download);
        }
      });
      entry.addEventListener("contextmenu", event =>
        this.#showContextMenu(event, entry.download)
      );
      const action = entry.querySelector(".zen-library-download-action");
      action.addEventListener("click", event => event.stopPropagation());
      action.addEventListener("command", () => this.#rowAction(entry.download));
    }
    return list;
  }

  /**
   * @param {object} download - Any download
   * @returns {boolean} Whether its file is there to be shown
   */
  #hasFile(download) {
    return (
      !!download?.succeeded && !download.deleted && !!download.target?.exists
    );
  }

  /**
   * What the button of an entry does.
   *
   * @param {object} download - The entry's download
   */
  #rowAction(download) {
    if (!download || download._zenLibraryCapture) {
      return;
    }
    if (!download.stopped) {
      this.#cancelDownload(download);
      return;
    }
    if (this.#hasFile(download)) {
      lazy.DownloadsCommon.showDownloadedFile(
        new lazy.FileUtils.File(download.target.path)
      );
    }
  }

  /**
   * Cancels a download under way, partial file and all.
   *
   * @param {Download} download
   */
  #cancelDownload(download) {
    if (!download || download.stopped) {
      return;
    }
    download.cancel().catch(() => {});
    download
      .removePartialData()
      .catch(console.error)
      .finally(() => download.target.refresh());
  }

  /**
   * @param {object} download
   * @returns {boolean} Whether it will be opened as soon as it is here
   */
  #opensWhenDone(download) {
    return !download.stopped && !!download.launchWhenSucceeded;
  }

  /**
   * Clicking a download that is still coming in asks for it to be opened as
   * soon as it is here, the way the downloads panel does.
   *
   * @param {object} download
   */
  #toggleOpenWhenDone(download) {
    download.launchWhenSucceeded = !download.launchWhenSucceeded;
    download._launchedFromPanel = download.launchWhenSucceeded;
    this.#updateList();
  }

  async #openDownload(download) {
    if (!download) return;
    if (!download.stopped) {
      this.#toggleOpenWhenDone(download);
      return;
    }
    if (lazy.isBlocked(download)) {
      lazy.confirmUnblock(
        download,
        this.#window,
        this.#openDownload.bind(this)
      );
      return;
    }
    if (download.succeeded) {
      if (await lazy.nativeMediaPreview(this.#window).openDownloads(download, this.#shown)) {
        this.#close();
        return;
      }
      // Captures are owned Library records, not external downloads to launch.
      if (download._zenLibraryCapture) return;
      lazy.DownloadsCommon.openDownload(download).catch(console.error);
      return;
    }
    if (lazy.canRetry(download)) {
      lazy.retryDownload(download, this.#window);
      return;
    }
    if (download.source?.url) {
      this.#window.openTrustedLinkIn(download.source.url, "tab");
    }
  }

  #onDragStart(event, download) {
    if (!this.#hasFile(download)) {
      event.preventDefault();
      return;
    }
    const file = new lazy.FileUtils.File(download.target.path);
    const { dataTransfer } = event;
    dataTransfer.mozSetDataAt(FILE_MIME, file, 0);
    dataTransfer.effectAllowed = "copyMove";
    dataTransfer.setData("text/uri-list", Services.io.newFileURI(file).spec);
    dataTransfer.addElement(event.currentTarget);
    // eslint-disable-next-line mozilla/valid-services
    Services.zen.playHapticFeedback();
  }

  #updateList() {
    if (this.#destroyed) return;
    const shown = this.#shown;
    this.#sources.setVisible(shown);
    this.#progress?.prune([...shown, this.#motion.displayed]);
    if (!shown.length) this.#close();
    const unused = ENTRIES - shown.length;
    this.#entries.forEach((entry, i) => {
      const download = shown[i - unused];
      entry.hidden = !download;
      entry.download = download ?? null;
      entry.toggleAttribute("zen-library-footer-badge", !!download &&
        download.target.path === this.#motion.displayed?.target.path);
      if (!download) {
        this.#progress?.update(entry.querySelector(".zen-library-download-badge"), null);
        return;
      }
      this.#updateBadge(
        entry.querySelector(".zen-library-download-badge"),
        download
      );
      const name = this.#fileName(download);
      entry.querySelector(".zen-library-download-list-title").textContent = name;
      entry.setAttribute("tooltiptext", name);
      // Arc gives the cell a button trait and an explicit source/name label.
      // Keep its accessory a sibling, with its own accessible action.
      this.#window.document.l10n.setAttributes(
        entry.querySelector(".zen-library-download-hit-target"),
        download._zenLibraryCapture ? "library-preview-capture-button" :
          download._zenDiskFile ? "library-preview-file-button" :
            "library-preview-download-button",
        { name }
      );
      const subtitle = entry.querySelector(
        ".zen-library-download-list-subtitle"
      );
      const state = lazy.downloadPreviewState(download);
      const description = lazy.downloadPreviewSubtitle(download, {
        date: state === "completed" ? this.#preview.date(lazy.downloadDate(download)) : "",
        domain: state === "paused" || state === "cancelled" ? this.#preview.sourceDomain(download) : "",
        transfer: state === "active" && download.totalBytes > 0 && !download.launchWhenSucceeded
          ? this.#preview.transfer(download) ?? lazy.transferText(download) : "",
      });
      if (description.id) {
        this.#window.document.l10n.setAttributes(subtitle, description.id, description.args);
      } else {
        subtitle.removeAttribute("data-l10n-id");
        subtitle.removeAttribute("data-l10n-args");
        subtitle.textContent = description.text;
      }
      entry.toggleAttribute("downloading", !download.stopped);
      entry.toggleAttribute("open-when-done", this.#opensWhenDone(download));
      // The one button an entry has calls off a download on its way in, and
      // shows the file once it is here.
      entry.toggleAttribute("show-in-folder", this.#hasFile(download) && !download._zenLibraryCapture);
      entry.querySelector(".zen-library-download-action").hidden = !!download._zenLibraryCapture;
      this.#window.document.l10n.setAttributes(
        entry.querySelector(".zen-library-download-action"),
        download.stopped
          ? "library-downloads-show-tooltip"
          : "library-downloads-cancel-tooltip"
      );
    });
    this.#motion?.sync(this.#entries, this.#selectedDownload, {
      animate: this.#loaded,
      canDismiss: shown.some(item => item.target.path === this.#motion.displayed?.target.path),
    });
    this.#window
      .promiseDocumentFlushed(() => this.#list.getBoundingClientRect().height)
      .then(height => {
        if (this.#destroyed) return;
        this.#downloadsListWrapper.style.setProperty(
          "--zen-library-stack-height",
          `${height}px`
        );
        this.#measureHoverBounds();
      });
  }

  #updateBadge(badge, download) {
    const request = {};
    this.#badgeRequests.set(badge, request);
    badge.removeAttribute("preview");
    badge.style.removeProperty("--download-image");
    const pending = this.#isPending(download);
    badge.toggleAttribute("completed", !!download?.succeeded);
    badge.toggleAttribute("downloading", pending);
    badge.toggleAttribute("paused", !!download?.canceled && !!download?.hasPartialData);
    badge.style.setProperty("--zen-library-pixel-size", `${1 / this.#window.devicePixelRatio}px`);
    if (badge === this.#badge) {
      badge.parentElement.toggleAttribute("downloading", pending);
    }
    // Arc reserves the same thumbnail slot for every status, but only a
    // completed download has file artwork. Recycled rows and late thumbnail
    // results must not leave a file image behind when that status changes.
    if (download?.succeeded) {
      this.#fileMenu.prefetch(download);
      const preview = this.#previewUrl(download);
      badge.toggleAttribute("preview", !!preview);
      badge.style.setProperty(
        "--download-image",
        `${preview ? `url(${JSON.stringify(preview)}), ` : ""}url(${JSON.stringify(this.#iconUrl(download))})`
      );
      // The small footer badge and its expanded row share the same cached
      // native thumbnail. Ignore an older result after the badge changes item.
      this.#preview.thumbnail(download).then(image => {
        if (!image?.url || this.#destroyed || this.#badgeRequests.get(badge) !== request) return;
        badge.style.setProperty("--download-image", `url(${JSON.stringify(image.url)})`);
        badge.toggleAttribute("preview", !!image.preview);
      });
    }
    this.#progress.update(badge, download);
  }

  #updateBadgeShowing() {
    this.#footButtons.toggleAttribute(
      "zen-library-badge",
      !!this.#motion.displayed
    );
  }

  // DownloadList view

  onDownloadBatchStarting() {
    this.#inBatch = true;
  }

  onDownloadBatchEnded() {
    this.#inBatch = false;
    this.#loaded = true;
    this.#update();
  }

  onDownloadAdded(download, { insertBefore } = {}) {
    const index = insertBefore ? this.#downloads.indexOf(insertBefore) : -1;
    if (index === -1) {
      this.#downloads.push(download);
    } else {
      this.#downloads.splice(index, 0, download);
    }
    this.#sources.add(download, !this.#loaded && Services.appinfo.OS === "Darwin",
      this.#loaded || this.#isPending(download));
    this.#update();
  }

  onDownloadChanged(download) {
    this.#sources.setVisible(this.#shown);
    this.#sources.changed(download);
    this.#update();
  }

  onDownloadRemoved(download) {
    this.#sources.remove(download);
    const index = this.#downloads.indexOf(download);
    if (index !== -1) {
      this.#downloads.splice(index, 1);
    }
    this.#update();
  }

  #update() {
    if (this.#inBatch) {
      return;
    }
    this.#updateList();
    this.#updateBadge(this.#badge, this.#motion.displayed);
    this.#updateBadgeShowing();
    this.#applyDownloadState();
    if (this.#buttonHovered) this.#open();
  }

  /**
   * Keeps the newest download's state on the library while it is open, for
   * its downloads tab to show.
   *
   * @param {Element} library
   */
  attachLibrary(library) {
    this.#buttonHovered = false;
    this.#buttonLingered = false;
    this.#window.clearTimeout(this.#openTimer);
    this.#openTimer = null;
    this.#close();
    this.#library = library;
    this.#applyDownloadState();
  }

  detachLibrary(library) {
    if (this.#library === library) {
      this.#library = null;
    }
  }

  #applyDownloadState() {
    if (!this.#library) {
      return;
    }
    const newest = this.#downloads.at(-1);
    this.#library.toggleAttribute(
      "zen-library-downloading",
      this.#isPending(newest)
    );
    this.#library.style.setProperty(
      "--zen-library-download-progress",
      `${newest?.hasProgress ? Math.round(newest.progress) : 0}%`
    );
  }

  // Helpers

  #fileName(download) {
    if (download._zenLibraryCapture) return download.title;
    return download.target.path
      ? PathUtils.filename(download.target.path)
      : download.source.url;
  }

  /**
   * @param {object} download - The download an entry stands for
   * @returns {string|null} The finished file itself, when it is a picture
   */
  #previewUrl(download) {
    const path = download.succeeded && download.target.path;
    if (!path || !lazy.canDrawThumbnail(path)) {
      return null;
    }
    return PathUtils.toFileURI(path);
  }

  #isPending(download) {
    return (
      !!(download &&
      (!download.stopped || (download.canceled && download.hasPartialData)))
    );
  }

  #iconUrl(download) {
    if (!download.target.path) {
      return "moz-icon://.unknown?size=32";
    }
    return `moz-icon://${download.target.path}?size=32${
      download.succeeded ? "&state=normal" : ""
    }`;
  }

  #showContextMenu(event, download) {
    this.#fileMenu.show(event, download);
  }

}

const stacks = new WeakMap();

export const ZenLibraryWidget = {
  id: "zen-library-button",
  l10nId: "zen-library-button",
  _introducedByPref: "zen.library.enabled",

  onCreated(node) {
    stacks.set(node.ownerDocument, new ZenLibraryDownloadStack(node));
  },

  onDestroyed(document) {
    stacks.get(document)?.destroy();
    stacks.delete(document);
  },

  attachLibrary(library) {
    stacks.get(library.ownerDocument)?.attachLibrary(library);
  },

  detachLibrary(library) {
    stacks.get(library.ownerDocument)?.detachLibrary(library);
  },
};
