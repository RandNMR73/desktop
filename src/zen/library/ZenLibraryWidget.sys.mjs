/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  ZenDownloadPreview: "moz-src:///zen/library/ZenDownloadPreview.sys.mjs",
  ZenDownloadMotion: "moz-src:///zen/library/ZenDownloadMotion.sys.mjs",
  ZenDownloadProgress: "moz-src:///zen/library/ZenDownloadProgress.sys.mjs",
  recentDownloads: "moz-src:///zen/library/ZenDownloadPreview.sys.mjs",
  downloadDate: "moz-src:///zen/library/ZenDownloadPreview.sys.mjs",
  DownloadIntegration: "resource://gre/modules/DownloadIntegration.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  canDrawThumbnail: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  blockedText: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  canRetry: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  confirmUnblock: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  isBlocked: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  retryDownload: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  transferText: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  DownloadsCommon:
    "moz-src:///browser/components/downloads/DownloadsCommon.sys.mjs",
  BrowserUtils: "resource://gre/modules/BrowserUtils.sys.mjs",
  DownloadUtils: "resource://gre/modules/DownloadUtils.sys.mjs",
  DownloadsViewUI:
    "moz-src:///browser/components/downloads/DownloadsViewUI.sys.mjs",
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
});

const ENTRIES = 4;
// Arc's HomeButtonRegion requires 150ms of continuous hover before expansion.
const OPEN_DELAY_MS = 150;
// Arc lets the pointer cross the dock, but closes after lingering there.
const DOCK_DELAY_MS = 500;
const FILE_MIME = "application/x-moz-file";
const BADGE_MARKUP = `
  <span class="zen-library-download-badge no-squircles">
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
  #recentNewDownload = false;
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
    this.#motion = new lazy.ZenDownloadMotion(this.#window, this.#entries);
    this.#progress = new lazy.ZenDownloadProgress(this.#window);

    button.addEventListener("mouseenter", this);
    button.addEventListener("mouseleave", this);
    this.#list.addEventListener("mouseenter", this);
    this.#list.addEventListener("mouseleave", this);
    this.#window.addEventListener("blur", this);
    this.#window.addEventListener("unload", this, { once: true });
    this.#resizeObserver = new this.#window.ResizeObserver(() => this.#measureHoverBounds());
    this.#resizeObserver.observe(this.#footButtons);
    this.#resizeObserver.observe(this.#list);

    // Include persisted downloads, so relaunching does not empty the flyout.
    this.#data = lazy.DownloadsCommon.getData(this.#window, true);
    this.#data.addView(this);
  }

  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#preview.destroy();
    this.#motion.destroy();
    this.#progress.destroy();
    this.#button.removeEventListener("mouseenter", this);
    this.#button.removeEventListener("mouseleave", this);
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
      left: Math.min(button.left, list.left),
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
    const badge = this.#badgeGeometry();
    if (!badge) this.#aimBadge();
    this.#closing = null;
    for (const host of [this.#footButtons, this.#downloadsListWrapper]) {
      host.removeAttribute("zen-library-stack-closing");
      host.setAttribute("zen-library-stack-open", "true");
    }
    this.#motion.setExpanded(true, badge);
    // Arc consumes a completed download badge on expansion. Active downloads
    // retain theirs; moving out before the animation ends must not restore a
    // completed badge on the footer.
    if (this.#downloads.at(-1)?.succeeded) this.#recentNewDownload = false;
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
    return lazy.recentDownloads(this.#downloads, this.#files);
  }

  async #refreshFiles() {
    if (this.#scanning || this.#destroyed ||
        lazy.PrivateBrowsingUtils.isWindowPrivate(this.#window)) return;
    this.#scanning = true;
    try {
      const path = await lazy.DownloadIntegration.getPreferredDownloadsDirectory();
      const files = await this.#preview.files(path);
      if (this.#destroyed) return;
      this.#files = files;
      this.#updateList();
      if (this.#buttonHovered) this.#open();
    } catch (error) { console.error(error); }
    finally { this.#scanning = false; }
  }

  #close() {
    this.#window.clearTimeout(this.#refreshTimer);
    this.#refreshTimer = null;
    if (!this.#footButtons.hasAttribute("zen-library-stack-open")) {
      return;
    }
    this.#stopTrackingPointer();
    const badge = this.#badgeGeometry();
    // Expanding consumes a finished badge, but leaves an active item visible.
    // Preserve that item when the flyout closes so finishing afterwards does
    // not silently discard its footer thumbnail.
    this.#recentNewDownload = this.#isPending(this.#downloads.at(-1));
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
    Promise.allSettled([...fading, this.#motion.setExpanded(false, badge)]).then(() => {
      // A newer close owns its cleanup if the pointer reverses twice.
      if (!this.#destroyed && this.#closing === closing) {
        this.#closing = null;
        this.#footButtons.removeAttribute("zen-library-stack-closing");
        wrapper.removeAttribute("zen-library-stack-closing");
      }
    });
  }

  #badgeGeometry() {
    const newest = this.#downloads.at(-1);
    const retained = this.#isPending(newest);
    if (!retained && (!this.#recentNewDownload || !newest?.succeeded)) return null;
    const row = this.#entries.find(entry => !entry.hidden &&
      entry.download?.target.path === newest?.target.path);
    if (!row) return null;
    const moving = this.#motion.badgeGeometry(row);
    if (moving) return { ...moving, retained };
    const icon = row.querySelector(".zen-library-download-badge");
    const bounds = row.getBoundingClientRect();
    const thumb = icon.getBoundingClientRect();
    const button = this.#button.getBoundingClientRect();
    const transform = this.#window.getComputedStyle(row).transform;
    const rise = transform === "none" ? 0 : new this.#window.DOMMatrixReadOnly(transform).f;
    const sidebar = this.#window.document.getElementById("navigator-toolbox").getBoundingClientRect();
    const index = this.#entries.length - 1 - this.#entries.indexOf(row);
    return {
      row,
      retained,
      closedScale: retained ? 0.8 : 0.55,
      width: Math.min(sidebar.width, 1000) - 16,
      iconX: thumb.left + thumb.width / 2 - bounds.left,
      iconY: thumb.top + thumb.height / 2 - bounds.top,
      dx: button.left + button.width / 2 + 10 - thumb.left - thumb.width / 2,
      dy: button.top + button.height / 2 - 12 - thumb.top - thumb.height / 2 + rise,
      distance: index ? 56 : 20,
    };
  }

  /**
   * Points the button's badge at the newest entry's badge, where it flies
   * to as the list opens, from wherever it is right now.
   */
  #aimBadge() {
    const entry = this.#entries.at(-1);
    if (entry.hidden) {
      return;
    }
    const target = entry.querySelector(".zen-library-download-badge");
    const from = this.#window.windowUtils.getBoundsWithoutFlushing(this.#badge);
    const to = target.getBoundingClientRect();
    const style = this.#window.getComputedStyle(this.#badge);
    const badgeTransform =
      style.transform === "none"
        ? new this.#window.DOMMatrixReadOnly()
        : new this.#window.DOMMatrixReadOnly(style.transform);
    // The entry is still translated down while closed; land where it ends.
    const entryTransform = this.#window.getComputedStyle(entry).transform;
    const rise =
      entryTransform === "none"
        ? 0
        : new this.#window.DOMMatrixReadOnly(entryTransform).f;
    this.#badge.style.setProperty(
      "--zen-library-badge-to-x",
      `${badgeTransform.e + to.left - from.left}px`
    );
    this.#badge.style.setProperty(
      "--zen-library-badge-to-y",
      `${badgeTransform.f + to.top - from.top - rise}px`
    );
  }

  #buildList() {
    const document = this.#window.document;
    const footButtons = document.getElementById("zen-sidebar-foot-buttons");
    // Not a widget of the toolbar, so its customization leaves it alone.
    footButtons.appendChild(
      this.#parse(
        `<box id="zen-library-download-list" skipintoolbarset="true"></box>`
      )
    );
    const list = document.getElementById("zen-library-download-list");
    for (let i = 0; i < ENTRIES; i++) {
      list.appendChild(
        this.#parse(`
          <div class="zen-library-download-list-download">
            ${BADGE_MARKUP}
            <vbox class="zen-library-download-list-title-container">
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
    if (!download) {
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

  #openDownload(download) {
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
    this.#progress?.prune([...shown, this.#downloads.at(-1)]);
    if (!shown.length) this.#close();
    const unused = ENTRIES - shown.length;
    this.#entries.forEach((entry, i) => {
      const download = shown[i - unused];
      if (entry.download?.target.path !== download?.target.path) {
        this.#motion?.resetRow(entry, this.#footButtons.hasAttribute("zen-library-stack-open"));
      }
      entry.hidden = !download;
      entry.download = download ?? null;
      entry.toggleAttribute("zen-library-footer-badge", !!download &&
        download.target.path === this.#downloads.at(-1)?.target.path);
      if (!download) {
        this.#progress?.update(entry.querySelector(".zen-library-download-badge"), null);
        return;
      }
      this.#updateBadge(
        entry.querySelector(".zen-library-download-badge"),
        download
      );
      entry.querySelector(".zen-library-download-list-title").textContent =
        this.#fileName(download);
      entry.setAttribute("tooltiptext", this.#fileName(download));
      const subtitle = entry.querySelector(
        ".zen-library-download-list-subtitle"
      );
      if (this.#opensWhenDone(download)) {
        this.#window.document.l10n.setAttributes(
          subtitle,
          "library-downloads-open-when-done"
        );
      } else {
        subtitle.removeAttribute("data-l10n-id");
        subtitle.textContent = this.#statusText(download);
      }
      entry.toggleAttribute("downloading", !download.stopped);
      entry.toggleAttribute("open-when-done", this.#opensWhenDone(download));
      // The one button an entry has calls off a download on its way in, and
      // shows the file once it is here.
      entry.toggleAttribute("show-in-folder", this.#hasFile(download));
      this.#window.document.l10n.setAttributes(
        entry.querySelector(".zen-library-download-action"),
        download.stopped
          ? "library-downloads-show-tooltip"
          : "library-downloads-cancel-tooltip"
      );
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
    const pending = this.#isPending(download);
    badge.toggleAttribute("completed", !!download?.succeeded);
    badge.toggleAttribute("downloading", pending);
    badge.toggleAttribute("paused", !!download?.canceled && !!download?.hasPartialData);
    badge.style.setProperty("--zen-library-pixel-size", `${1 / this.#window.devicePixelRatio}px`);
    if (badge === this.#badge) {
      badge.parentElement.toggleAttribute("downloading", pending);
    }
    if (download) {
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
      this.#isPending(this.#downloads.at(-1)) || this.#recentNewDownload
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
    if (this.#loaded) {
      this.#recentNewDownload = true;
    }
    this.#update();
  }

  onDownloadChanged() {
    this.#update();
  }

  onDownloadRemoved(download) {
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
    const newest = this.#downloads.at(-1);
    this.#updateList();
    this.#updateBadge(this.#badge, newest);
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
      !!download &&
      (!download.stopped || (download.canceled && download.hasPartialData))
    );
  }

  #joinStatus(...parts) {
    return parts
      .filter(Boolean)
      .reduce((a, b) => lazy.DownloadsCommon.strings.statusSeparator(a, b));
  }

  #iconUrl(download) {
    if (!download.target.path) {
      return "moz-icon://.unknown?size=32";
    }
    return `moz-icon://${download.target.path}?size=32${
      download.succeeded ? "&state=normal" : ""
    }`;
  }

  #statusText(download) {
    const strings = lazy.DownloadsCommon.strings;
    if (!download.stopped) {
      return lazy.transferText(download, { speed: true });
    }
    if (download.deleted) {
      return strings.fileDeleted;
    }
    if (download.succeeded) {
      if (!download.target.exists) {
        return strings.fileMovedOrMissing;
      }
      return this.#preview.date(lazy.downloadDate(download));
    }
    if (download.canceled && download.hasPartialData) {
      return this.#joinStatus(strings.statePaused, lazy.transferText(download));
    }
    if (download.error?.becauseBlockedByParentalControls) {
      return strings.stateBlockedParentalControls;
    }
    if (download.error?.becauseBlockedByReputationCheck) {
      return lazy.blockedText(download);
    }
    return download.canceled ? strings.stateCanceled : strings.stateFailed;
  }

  #contextMenuItems(download) {
    const C = lazy.DownloadsCommon;
    const state = C.stateOfDownload(download);
    const isActive =
      state === C.DOWNLOAD_DOWNLOADING || state === C.DOWNLOAD_PAUSED;
    const fileExists =
      state === C.DOWNLOAD_FINISHED &&
      download.target?.exists !== false &&
      !download.deleted;
    const sourceUrl = !download._zenDiskFile &&
      (download.source?.originalUrl || download.source?.url);
    const items = [];
    if (state === C.DOWNLOAD_DOWNLOADING) {
      items.push({
        l10nId: "downloads-cmd-pause",
        onClick: () => download.cancel().catch(() => {}),
      });
    } else if (state === C.DOWNLOAD_PAUSED) {
      items.push({
        l10nId: "downloads-cmd-resume",
        onClick: () => download.start?.().catch(() => {}),
      });
    } else if (lazy.canRetry(download)) {
      items.push({
        l10nId: "library-downloads-menu-retry",
        onClick: () => lazy.retryDownload(download, this.#window),
      });
    }
    if (fileExists) {
      items.push({
        l10nId: "downloads-cmd-show-menuitem-2",
        onClick: () =>
          C.showDownloadedFile(new lazy.FileUtils.File(download.target.path)),
      });
    }
    if (sourceUrl) {
      items.push({
        l10nId: "downloads-cmd-go-to-download-page",
        onClick: () => this.#window.openTrustedLinkIn(sourceUrl, "tab"),
      });
      items.push({
        l10nId: "downloads-cmd-copy-download-link",
        onClick: () =>
          Cc["@mozilla.org/widget/clipboardhelper;1"]
            .getService(Ci.nsIClipboardHelper)
            .copyString(sourceUrl),
      });
    }
    items.push({ separator: true });
    if (fileExists && !download._zenDiskFile) {
      items.push({
        l10nId: "downloads-cmd-delete-file",
        onClick: () =>
          C.deleteDownloadFiles(
            download,
            lazy.DownloadsViewUI.clearHistoryOnDelete
          ).catch(console.error),
      });
    }
    if (!isActive && !download._zenDiskFile) {
      items.push({
        l10nId: "downloads-cmd-remove-from-history",
        onClick: () => C.deleteDownload(download).catch(console.error),
      });
    }
    if (this.#data.canRemoveFinished) {
      items.push({
        l10nId: "library-downloads-menu-clear-preview",
        onClick: () => this.#data.removeFinished(),
      });
    }
    return items;
  }

  #showContextMenu(event, download) {
    if (!download) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const document = this.#window.document;
    const popup = document.createXULElement("menupopup");
    for (const item of this.#contextMenuItems(download)) {
      if (item.separator) {
        if (popup.lastChild && popup.lastChild.tagName !== "menuseparator") {
          popup.appendChild(document.createXULElement("menuseparator"));
        }
        continue;
      }
      const menuitem = document.createXULElement("menuitem");
      menuitem.setAttribute("data-l10n-id", item.l10nId);
      menuitem.addEventListener(
        "command",
        () => {
          try {
            item.onClick();
          } catch (ex) {
            console.error(ex);
          }
        },
        { once: true }
      );
      popup.appendChild(menuitem);
    }
    if (popup.lastChild?.tagName === "menuseparator") {
      popup.lastChild.remove();
    }
    if (!popup.childElementCount) {
      return;
    }

    this.#contextMenuOpen = true;
    popup.addEventListener(
      "popuphidden",
      () => {
        this.#contextMenuOpen = false;
        popup.remove();
        this.#close();
      },
      { once: true }
    );
    document.getElementById("mainPopupSet").appendChild(popup);
    popup.openPopupAtScreen(event.screenX, event.screenY, true);
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
