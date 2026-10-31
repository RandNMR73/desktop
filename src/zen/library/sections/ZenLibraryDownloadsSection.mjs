/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html, repeat, when, nothing } from "chrome://global/content/vendor/lit.all.mjs";
import {
  MS_PER_DAY,
  PAGE_SIZE,
  ZenLibrarySearchSection,
  whenFilterGroup,
} from "moz-src:///zen/library/sections/ZenLibrarySearchSection.mjs";

let lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ZenDownloadPreview: "moz-src:///zen/library/ZenDownloadPreview.sys.mjs",
  ZenDownloadListPresentation: "moz-src:///zen/library/ZenDownloadPreview.sys.mjs",
  downloadCreatedDate: "moz-src:///zen/library/ZenDownloadPreview.sys.mjs",
  nativeMediaPreview: "moz-src:///zen/library/ZenNativeMediaPreview.sys.mjs",
  FILE_GROUPS: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  canDrawThumbnail: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  fileGroupOf: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  blockedText: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  canRetry: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  confirmUnblock: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  isBlocked: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  retryDownload: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  transferText: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  DownloadsCommon:
    "moz-src:///browser/components/downloads/DownloadsCommon.sys.mjs",
  DownloadsViewUI:
    "moz-src:///browser/components/downloads/DownloadsViewUI.sys.mjs",
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
});

function clearDownloads() {
  lazy.DownloadsCommon.getData(window, true).removeFinished();
  lazy.PlacesUtils.history
    .removeVisitsByFilter({
      transition: lazy.PlacesUtils.history.TRANSITIONS.DOWNLOAD,
    })
    .catch(console.error);
}

const SHOW_IN_FOLDER_ICON =
  AppConstants.platform === "macosx"
    ? "chrome://browser/skin/zen-icons/search-glass.svg"
    : "chrome://browser/skin/zen-icons/folder.svg";

const FILE_MIME = "application/x-moz-file";

export class ZenLibraryDownloadsSection extends ZenLibrarySearchSection {
  static id = "downloads";
  static label = "library-downloads-section-title";

  static render(library) {
    return html`
      <zen-library-downloads-section
        class="zen-library-section"
        data-section="downloads"
        .library=${library}
      ></zen-library-downloads-section>
    `;
  }

  // Oldest to newest, mirroring the order of the underlying download list.
  #downloads = [];
  #orderedDownloads = null;
  #data = null;
  #loaded = false;
  #inBatch = false;
  #limit = PAGE_SIZE;
  #visible = [];
  #refreshed = new WeakSet();
  #presentation = null;
  #preview = null;
  #dateTimer = null;
  #presenting = false;

  #menu = null;
  #menuDownload = null;
  #menuRow = null;

  connectedCallback() {
    super.connectedCallback();
    this.#preview = new lazy.ZenDownloadPreview(window);
    this.#presentation = new lazy.ZenDownloadListPresentation(
      this.#preview, () => this.requestUpdate());
    this.#data = lazy.DownloadsCommon.getData(window, true);
    this.#data.addView(this);
  }

  /** The view of the old library window this section stands in for. */
  static legacyLibraryView = "Downloads";

  /** @returns {object[]} What a right click on the downloads tab offers */
  static get tabMenu() {
    return [{ l10nId: "library-downloads-clear-all", command: clearDownloads }];
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#stopDateTimer();
    this.#presentation?.destroy();
    this.#presentation = null;
    this.#preview = null;
    this.#data?.removeView(this);
    this.#data = null;
    this.#menu?.hidePopup();
    this.#menu?.remove();
    this.#menu = null;
  }

  get searchPlaceholderL10nId() {
    return "library-downloads-search-placeholder";
  }

  get filterTitleL10nId() {
    return "library-downloads-filter-title";
  }

  get filterGroups() {
    return [
      {
        id: "type",
        titleL10nId: "library-downloads-filter-type",
        options: lazy.FILE_GROUPS.map(id => ({
          id,
          l10nId: `library-downloads-type-${id}`,
        })),
      },
      whenFilterGroup("library-downloads-filter-when"),
    ];
  }

  onSearchChanged() {
    this.#limit = PAGE_SIZE;
    this.requestUpdate();
  }

  onFiltersChanged() {
    this.#limit = PAGE_SIZE;
    this.requestUpdate();
  }

  onListScrolledToEnd() {
    if (this.#visible.length < this.#limit) {
      return;
    }
    this.#limit += PAGE_SIZE;
    this.requestUpdate();
  }

  // DownloadList view

  onDownloadBatchStarting() {
    this.#inBatch = true;
  }

  onDownloadBatchEnded() {
    this.#inBatch = false;
    this.#loaded = true;
    this.requestUpdate();
  }

  onDownloadAdded(download, { insertBefore } = {}) {
    const index = insertBefore ? this.#downloads.indexOf(insertBefore) : -1;
    if (index === -1) {
      this.#downloads.push(download);
    } else {
      this.#downloads.splice(index, 0, download);
    }
    this.#scheduleUpdate();
  }

  onDownloadChanged() {
    this.#scheduleUpdate();
  }

  onDownloadRemoved(download) {
    const index = this.#downloads.indexOf(download);
    if (index !== -1) {
      this.#downloads.splice(index, 1);
    }
    if (this.#menuDownload === download) {
      this.#menu?.hidePopup();
    }
    this.#scheduleUpdate();
  }

  #scheduleUpdate() {
    this.#orderedDownloads = null;
    if (!this.#inBatch) {
      this.requestUpdate();
    }
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    this.#presentation?.update(!this.#presenting || this.hidden || !this.library?.hasAttribute("open") ? [] : this.#visible);
    // Check that the files of rendered downloads still exist, like the
    // downloads panel does when it opens.
    for (const download of this.#visible) {
      if (download.succeeded && !this.#refreshed.has(download)) {
        this.#refreshed.add(download);
        download.refresh().catch(console.error);
      }
    }
  }

  onShown() {
    this.#presenting = true;
    super.onShown();
    this.#refreshed = new WeakSet();
    this.#startDateTimer();
    this.requestUpdate();
  }

  onLibraryOpening() {
    this.#presenting = true;
    this.#startDateTimer();
    this.requestUpdate();
  }

  onLibraryClosing() {
    this.#presenting = false;
    this.#stopDateTimer();
    this.#presentation?.update([]);
  }

  onHidden() {
    this.#presenting = false;
    this.#stopDateTimer();
    this.#presentation?.update([]);
  }

  // Helpers

  #stopDateTimer() {
    window.clearTimeout(this.#dateTimer);
    this.#dateTimer = null;
  }

  #startDateTimer() {
    this.#stopDateTimer();
    this.#preview?.clearDateGroups();
    if (this.hidden || !this.#presenting) return;
    this.#dateTimer = window.setTimeout(() => {
      this.#startDateTimer();
      this.requestUpdate();
    }, 60000 - Date.now() % 60000);
  }

  #fileName(download) {
    return download.target.path
      ? PathUtils.filename(download.target.path)
      : download.source.url;
  }

  #hasFile(download) {
    return download.succeeded && !download.deleted && download.target.exists;
  }

  #file(download) {
    return new lazy.FileUtils.File(download.target.path);
  }

  #matchesQuery(download) {
    const query = this.searchQuery.toLowerCase();
    return (
      this.#fileName(download).toLowerCase().includes(query) ||
      download.source.url.toLowerCase().includes(query)
    );
  }

  #fileType(download) {
    return lazy.fileGroupOf(this.#fileName(download)) ?? undefined;
  }

  #activeTypes() {
    return lazy.FILE_GROUPS.filter(id => this.isFilterActive("type", id));
  }

  #whenCutoff() {
    const days = this.activeWhenDays;
    return days ? Date.now() - days * MS_PER_DAY : 0;
  }

  #computeVisible() {
    const visible = [];
    const types = this.#activeTypes();
    const cutoff = this.#whenCutoff();
    const created = download => {
      const date = lazy.downloadCreatedDate(download);
      return Number.isFinite(date) ? date : -Infinity;
    };
    // Thumbnail repaints and searches reuse the order until the data changes.
    this.#orderedDownloads ??= [...this.#downloads].reverse()
      .sort((a, b) => created(b) - created(a));
    for (const download of this.#orderedDownloads) {
      if (types.length && !types.includes(this.#fileType(download))) {
        continue;
      }
      if (cutoff && !(download.endTime >= cutoff)) {
        continue;
      }
      if (!this.searchQuery || this.#matchesQuery(download)) {
        visible.push(download);
        if (visible.length >= this.#limit) {
          break;
        }
      }
    }
    return visible;
  }

  #iconUrl(download) {
    if (!download.target.path) {
      return "moz-icon://.unknown?size=32";
    }
    return `moz-icon://${download.target.path}?size=32${
      download.succeeded ? "&state=normal" : ""
    }`;
  }

  /**
   * @param {object} download - The download a row stands for
   * @returns {string|null} The finished file itself, when it is a picture
   *   worth showing in place of a file icon
   */
  #previewUrl(download) {
    const native = this.#presentation?.get(download);
    if (native?.url) return native.url;
    const path = download.succeeded && download.target.path;
    if (!path || !lazy.canDrawThumbnail(path)) {
      return null;
    }
    return PathUtils.toFileURI(path);
  }

  /**
   * @param {object} download - The download a row stands for
   * @returns {boolean} Whether the file it brought in is gone from where it
   *   was put
   */
  #isMissing(download) {
    return download.deleted || (download.succeeded && !download.target.exists);
  }

  #isPending(download) {
    return !download.stopped || (download.canceled && download.hasPartialData);
  }

  #joinStatus(...parts) {
    return parts
      .filter(Boolean)
      .reduce((a, b) => lazy.DownloadsCommon.strings.statusSeparator(a, b));
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
      return ""; // Completed metadata is localized by #renderSubtitle.
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

  // Actions

  #showInFolder(download) {
    if (!this.#hasFile(download)) {
      return;
    }
    lazy.DownloadsCommon.showDownloadedFile(this.#file(download));
  }

  /**
   * Whether a download that is still coming in will be opened the moment it
   * finishes.
   *
   * @param {object} download
   * @returns {boolean}
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
    this.requestUpdate();
  }

  #onRowClick(download) {
    if (!download.stopped) {
      this.#toggleOpenWhenDone(download);
      return;
    }
    if (lazy.isBlocked(download)) {
      lazy.confirmUnblock(download, window, this.#openDownload.bind(this));
      return;
    }
    this.#openDownload(download);
  }

  #cancelDownload(download) {
    download.cancel().catch(() => {});
    download
      .removePartialData()
      .catch(console.error)
      .finally(() => download.target.refresh());
  }

  async #openDownload(download) {
    if (!this.#hasFile(download)) {
      return;
    }
    if (!await lazy.nativeMediaPreview(window).openDownloads(download, this.#visible)) {
      lazy.DownloadsCommon.openDownload(download, { openWhere: "tab" }).catch(console.error);
    }
  }

  #copyFile(download) {
    if (!this.#hasFile(download)) {
      return;
    }
    const transferable = Cc[
      "@mozilla.org/widget/transferable;1"
    ].createInstance(Ci.nsITransferable);
    transferable.init(window.docShell.QueryInterface(Ci.nsILoadContext));
    transferable.addDataFlavor(FILE_MIME);
    transferable.setTransferData(FILE_MIME, this.#file(download));
    Services.clipboard.setData(
      transferable,
      null,
      Services.clipboard.kGlobalClipboard
    );
  }

  #hideDownload(download) {
    lazy.DownloadsCommon.deleteDownload(download).catch(console.error);
  }

  #deleteDownloadFile(download) {
    lazy.DownloadsCommon.deleteDownloadFiles(
      download,
      lazy.DownloadsViewUI.clearHistoryOnDelete
    ).catch(console.error);
  }

  #isActionEnabled(action, download) {
    switch (action) {
      case "open":
      case "copy":
      case "show":
        return this.#hasFile(download);
      case "copy-link":
        return !download.source.isDataURICleared;
      case "unblock":
        return lazy.isBlocked(download);
      case "delete":
        return (
          this.#hasFile(download) ||
          !download.stopped ||
          download.hasPartialData
        );
      default:
        return true;
    }
  }

  #doAction(action, download) {
    switch (action) {
      case "open":
        this.#openDownload(download);
        break;
      case "copy":
        this.#copyFile(download);
        break;
      case "copy-link":
        lazy.DownloadsCommon.copyDownloadLink(download);
        break;
      case "show":
        this.#showInFolder(download);
        break;
      case "unblock":
        lazy.confirmUnblock(download, window, this.#openDownload.bind(this));
        break;
      case "hide":
        this.#hideDownload(download);
        break;
      case "delete":
        this.#deleteDownloadFile(download);
        break;
    }
  }

  #onDragStart(event, download) {
    if (!this.#hasFile(download) || !this.#file(download).exists()) {
      event.preventDefault();
      return;
    }
    const file = this.#file(download);
    const { dataTransfer } = event;
    dataTransfer.mozSetDataAt(FILE_MIME, file, 0);
    dataTransfer.effectAllowed = "copyMove";
    dataTransfer.setData("text/uri-list", Services.io.newFileURI(file).spec);
    dataTransfer.addElement(event.currentTarget);
    // eslint-disable-next-line mozilla/valid-services
    Services.zen.playHapticFeedback();
  }

  // Context menu

  #buildMenu() {
    const menu = window.MozXULElement.parseXULToFragment(`
      <menupopup class="zen-library-downloads-menu">
        <menuitem data-action="open" data-l10n-id="library-downloads-menu-open"/>
        <menuitem data-action="show" data-l10n-id="downloads-cmd-show-menuitem-2"/>
        <menuseparator/>
        <menuitem data-action="copy" data-l10n-id="library-downloads-menu-copy"/>
        <menuitem data-action="copy-link" data-l10n-id="downloads-cmd-copy-download-link"/>
        <menuseparator/>
        <menuitem data-action="unblock" data-l10n-id="downloads-cmd-unblock"/>
        <menuitem data-action="hide" data-l10n-id="library-downloads-menu-hide"/>
        <menuitem data-action="delete" data-l10n-id="library-downloads-menu-delete"/>
      </menupopup>
    `).firstElementChild;
    menu.addEventListener("command", event => {
      if (this.#menuDownload) {
        this.#doAction(event.target.dataset.action, this.#menuDownload);
      }
    });
    menu.addEventListener("popuphidden", () => {
      menu.hidden = true;
      this.#menuRow?.removeAttribute("menu-open");
      this.#menuRow = null;
      this.#menuDownload = null;
    });
    menu.hidden = true;
    document.getElementById("mainPopupSet").appendChild(menu);
    return menu;
  }

  #openMenu(download, row, anchor, event) {
    this.#menu ??= this.#buildMenu();
    const fileName = this.#fileName(download);
    for (const item of this.#menu.querySelectorAll("menuitem")) {
      const { action } = item.dataset;
      if (action === "open" || action === "copy") {
        document.l10n.setAttributes(item, item.dataset.l10nId, {
          name: fileName,
        });
      }
      const enabled = this.#isActionEnabled(action, download);
      // Allowing a download only means anything to one that was stopped, so
      // it is kept out of the way of every other.
      if (action === "unblock") {
        item.hidden = !enabled;
      }
      item.disabled = !enabled;
    }
    this.#menu.hidden = false;
    this.#menuRow?.removeAttribute("menu-open");
    this.#menuRow = row;
    this.#menuDownload = download;
    row.setAttribute("menu-open", "true");
    if (anchor) {
      this.#menu.openPopup(anchor, "after_end", 0, 4, false, false, event);
    } else {
      this.#menu.openPopupAtScreen(event.screenX, event.screenY, true, event);
    }
  }

  // Rendering

  #renderSubtitle(download) {
    let statusNode;
    if (this.#opensWhenDone(download)) {
      statusNode = html`<span class="zen-library-download-status"
        data-l10n-id="library-downloads-open-when-done"></span>`;
    } else if (download.succeeded && !this.#isMissing(download)) {
      const kind = this.#presentation?.get(download)?.downloadKind ?? "download";
      const host = URL.parse(download.source.url)?.hostname.replace(/^www\./, "") ?? "";
      statusNode = html`<span class="zen-library-download-status"
        data-l10n-id=${host ? "library-downloads-completed-from" : "library-downloads-kind"}
        data-l10n-args=${JSON.stringify({ kind, host })}></span>`;
    } else if (this.#isMissing(download)) {
      statusNode = html`<span class="zen-library-download-status"
        data-l10n-id="library-downloads-missing"></span>`;
    } else {
      statusNode = html`<span class="zen-library-download-status">${this.#statusText(download)}</span>`;
    }
    return html`<span class="zen-library-row-subtitle">${statusNode}</span>`;
  }

  /**
   * @param {object} download - The download that is still coming in
   * @returns {object} The arc around its icon, where "pathLength" being 100
   *   makes the dashes the percentage of the way there, and one with no total
   *   to go by keeps a quarter of the ring and spins
   */
  #renderProgressRing(download) {
    const dash = download.hasProgress ? Math.round(download.progress) : 25;
    return html`
      <svg class="zen-library-row-progress" viewBox="0 0 32 32">
        <circle class="zen-library-row-progress-track" cx="16" cy="16" r="14" />
        <circle
          class="zen-library-row-progress-arc"
          cx="16"
          cy="16"
          r="14"
          pathLength="100"
          style="stroke-dasharray: ${dash} 100"
        />
      </svg>
    `;
  }

  #renderCancelButton(download) {
    return html`
      <toolbarbutton
        class="toolbarbutton-1"
        data-l10n-id="library-downloads-cancel-button"
        @click=${event => {
          event.stopPropagation();
          this.#cancelDownload(download);
        }}
      >
        <img
          class="toolbarbutton-icon"
          src="chrome://browser/skin/zen-icons/close.svg"
          alt=""
        />
      </toolbarbutton>
    `;
  }

  #renderShowButton(download) {
    return html`
      <toolbarbutton
        class="toolbarbutton-1"
        data-l10n-id="library-downloads-show-button"
        @click=${event => {
          event.stopPropagation();
          this.#showInFolder(download);
        }}
      >
        <img class="toolbarbutton-icon" src=${SHOW_IN_FOLDER_ICON} alt="" />
      </toolbarbutton>
    `;
  }

  #renderRetryButton(download) {
    return html`
      <toolbarbutton
        class="toolbarbutton-1"
        data-l10n-id="library-downloads-retry-button"
        @click=${event => {
          event.stopPropagation();
          lazy.retryDownload(download, window);
        }}
      >
        <img
          class="toolbarbutton-icon"
          src="chrome://browser/skin/zen-icons/reload.svg"
          alt=""
        />
      </toolbarbutton>
    `;
  }

  #renderDownload(download) {
    const pending = this.#isPending(download);
    return html`
      <div
        class="zen-library-row"
        draggable="true"
        ?pending=${pending}
        ?missing=${this.#isMissing(download)}
        ?indeterminate=${pending && !download.hasProgress}
        ?paused=${pending && download.stopped}
        ?open-when-done=${this.#opensWhenDone(download)}
        @click=${() => this.#onRowClick(download)}
        @contextmenu=${event => {
          event.preventDefault();
          this.#openMenu(download, event.currentTarget, null, event);
        }}
        @dragstart=${event => this.#onDragStart(event, download)}
      >
        <div class="zen-library-row-icon-box">
          <img
            class="zen-library-row-icon"
            decoding="async"
            ?preview=${!pending && !!this.#previewUrl(download)}
            src=${
              pending
                ? "chrome://browser/skin/zen-icons/forward.svg"
                : (this.#previewUrl(download) ?? this.#iconUrl(download))
            }
            @error=${event => {
              if (!event.target.hasAttribute("preview")) {
                return;
              }
              event.target.removeAttribute("preview");
              event.target.src = this.#iconUrl(download);
            }}
            alt=""
          />
          ${when(pending, () => this.#renderProgressRing(download))}
        </div>
        <div class="zen-library-row-text">
          <span class="zen-library-row-title">${this.#fileName(download).toLowerCase()}</span>
          ${this.#renderSubtitle(download)}
        </div>
        <div class="zen-library-row-actions">
          ${when(!download.stopped, () => this.#renderCancelButton(download))}
          ${when(lazy.canRetry(download), () =>
            this.#renderRetryButton(download)
          )}
          ${when(this.#hasFile(download), () =>
            this.#renderShowButton(download)
          )}
          <toolbarbutton
            class="toolbarbutton-1"
            data-l10n-id="library-downloads-more-button"
            @click=${event => {
              event.stopPropagation();
              this.#openMenu(
                download,
                event.currentTarget.closest(".zen-library-row"),
                event.currentTarget,
                event
              );
            }}
          >
            <img
              class="toolbarbutton-icon"
              src="chrome://global/skin/icons/more.svg"
              alt=""
            />
          </toolbarbutton>
        </div>
      </div>
    `;
  }

  renderItems() {
    if (!this.#loaded) {
      return null;
    }
    this.#visible = this.#computeVisible();
    if (!this.#visible.length) {
      return html`
        <div
          class="zen-library-empty"
          data-l10n-id="library-downloads-empty"
        ></div>
      `;
    }
    return repeat(this.#preview.groups(this.#visible), group => group.key, group => html`
      <div class="zen-library-group">
        <h3 data-l10n-id=${group.l10nId || nothing}>${group.label || ""}</h3>
        ${repeat(group.downloads, download => download,
          download => this.#renderDownload(download))}
      </div>`);
  }
}

customElements.define(
  "zen-library-downloads-section",
  ZenLibraryDownloadsSection
);
