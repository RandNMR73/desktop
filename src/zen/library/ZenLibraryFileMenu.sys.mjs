/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ZenDownloadPreview } from "moz-src:///zen/library/ZenDownloadPreview.sys.mjs";
import { libraryHiddenFiles } from "moz-src:///zen/library/ZenLibraryHiddenFiles.sys.mjs";
import { libraryCaptures } from "moz-src:///zen/library/ZenLibraryCaptures.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  DownloadsCommon: "moz-src:///browser/components/downloads/DownloadsCommon.sys.mjs",
  Downloads: "resource://gre/modules/Downloads.sys.mjs",
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
  mediaKindOf: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
  extensionOf: "moz-src:///zen/library/ZenLibraryUtils.sys.mjs",
});

// The hover menu is distinct from the simpler media-preview More menu.
export function fileMenuOrder({ active, completed, capture = false, presentation = "hover" }) {
  if (active) return ["cancel"];
  if (!completed) return [];
  if (capture) return presentation === "hover"
    ? ["copy", "separator", "message", "airdrop", "separator", "open-source", "copy-source", "separator", "delete-capture"]
    : ["copy", "copy-source", "open-source", "separator", "message", "airdrop", "separator", "delete-capture"];
  if (presentation === "media")
    return ["copy", "separator", "message", "airdrop", "separator", "show", "separator", "hide"];
  return presentation === "hover"
    ? ["copy", "separator", "message", "airdrop", "separator", "open", "show", "separator", "hide", "trash"]
    : ["open", "copy", "show", "hide", "trash"];
}

/** Adapt a Media grid file without confusing it with a browser download. */
export function mediaFileRecord(item) {
  if (item.target) return item;
  return {
    ...item,
    _zenDiskFile: true,
    _zenMediaFile: true,
    succeeded: true,
    stopped: true,
    canceled: false,
    source: { url: item.url },
    target: { path: item.path, exists: true },
    startTime: item.modified,
    endTime: item.modified,
    totalBytes: item.size,
  };
}

/** Download history is separate from ordinary visits to the source page. */
export async function removeLibraryDownloadHistory(download) {
  if (download.source?.isPrivate) return;
  const url = download.source?.originalUrl || download.source?.url;
  const uri = URL.parse(url)?.URI;
  if (uri && lazy.PlacesUtils.history.canAddURI(uri)) {
    await lazy.PlacesUtils.history.removeVisitsByFilter({
      url, transition: lazy.PlacesUtils.history.TRANSITIONS.DOWNLOAD,
    });
  }
}

export async function hideLibraryDownload(window, download) {
  // A hidden browser record must not reappear through its disk fallback.
  // Its file can still belong to the independent Media source.
  if (!download.source?.isPrivate && !lazy.PrivateBrowsingUtils.isWindowPrivate(window)) {
    await libraryHiddenFiles().hide(download.target.path, !download._zenDiskFile);
  }
  if (download._zenDiskFile) return;
  await removeLibraryDownloadHistory(download);
  const downloads = await lazy.Downloads.getList(lazy.Downloads.ALL);
  await downloads.remove(download);
  if (download.hasBlockedData) {
    await download.confirmBlock();
  } else if (download.error?.becauseBlockedByContentAnalysis) {
    await download.respondToContentAnalysisWarnWithBlock();
  }
  await download.finalize(true);
}

export class ZenLibraryFileMenu {
  #window;
  #api;
  #popup = null;
  #generation = 0;
  #destroyed = false;
  #onChange;
  #onOpen;
  #onClose;

  constructor(window, { onChange = () => {}, onOpen = () => {}, onClose = () => {} } = {}) {
    this.#window = window;
    this.#api = new ZenDownloadPreview(window);
    this.#onChange = onChange;
    this.#onOpen = onOpen;
    this.#onClose = onClose;
  }

  prefetch(download) {
    if (download._zenLibraryCapture) return;
    this.#api.fileInfo(download).catch(console.error);
  }

  async show(event, download, { presentation = "hover", anchor } = {}) {
    event.preventDefault();
    event.stopPropagation();
    if (!download || this.#destroyed) return;
    const commands = fileMenuOrder({ active: !download.stopped,
      completed: !!download.succeeded && download.target?.exists !== false && !download.deleted,
      capture: !!download._zenLibraryCapture,
      presentation });
    if (!commands.length) return;
    const generation = ++this.#generation;
    this.#popup?.hidePopup();
    this.#popup?.remove();
    this.#popup = null;
    this.#onOpen();
    const doc = this.#window.document;
    try {
      const info = download._zenLibraryCapture ? { kind: "image" } : await this.#api.fileInfo(download);
      const path = download.target?.path || "";
      const mediaKind = lazy.mediaKindOf(path);
      const kind = info?.kind || (mediaKind === "image" ? "image" : mediaKind === "video"
        ? "movie" : lazy.extensionOf(path) === "pdf" ? "pdf" : "file");
      const kindLabel = await doc.l10n.formatValue("library-file-kind-" + kind);
      if (this.#destroyed || generation !== this.#generation) return;
      const popup = doc.createXULElement("menupopup");
      popup.className = "zen-library-download-menu";
      for (const action of commands) {
        if (action === "separator") {
          popup.appendChild(doc.createXULElement("menuseparator"));
          continue;
        }
        const item = doc.createXULElement("menuitem");
        item.dataset.action = action;
        const openIn = action === "open" && presentation === "hover" && info?.application;
        doc.l10n.setAttributes(item, "library-file-" + (openIn ? "open-in" : action),
          { kind: kindLabel, app: info?.application || "" });
        item.addEventListener("command", () => {
          this.execute(action, download).catch(console.error);
        }, { once: true });
        popup.appendChild(item);
      }
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
      if (anchor) popup.openPopup(anchor, "after_end", 0, 0, false, false);
      else popup.openPopupAtScreen(event.screenX, event.screenY, true, event);
    } catch (error) {
      if (generation === this.#generation) this.#onClose();
      console.error(error);
    }
  }

  async execute(action, download) {
    if (download._zenLibraryCapture) {
      const capture = download._zenLibraryCapture;
      const store = libraryCaptures();
      await store.ready;
      // A menu can outlive a replaced/deleted capture in another window.
      if (store.get(capture.id) !== capture) throw new Error("The capture is no longer current");
      if (action === "open-source") {
        this.#window.openWebLinkIn(capture.url, "tab");
      } else if (action === "copy-source") {
        Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper)
          .copyString(capture.url);
      } else if (action === "delete-capture") {
        await store.remove(capture.id, capture);
      } else if (["copy", "message", "airdrop"].includes(action)) {
        const result = await this.#api.fileAction(download, action);
        if (!result?.succeeded) throw new Error(result?.error || "Native capture action unavailable");
      } else {
        throw new Error("Invalid capture action");
      }
      this.#onChange(download, action);
      return;
    }
    const file = () => new lazy.FileUtils.File(download.target.path);
    if (action === "cancel") {
      await download.cancel();
      await download.removePartialData();
    } else if (action === "open") {
      file().launch();
    } else if (action === "show") {
      lazy.DownloadsCommon.showDownloadedFile(file());
    } else if (action === "hide") {
      await hideLibraryDownload(this.#window, download);
    } else {
      const result = await this.#api.fileAction(download, action);
      if (!result?.succeeded) throw new Error(result?.error || "Native file action unavailable");
      if (action === "trash") {
        download.target.exists = false;
        await download.refresh?.();
      }
    }
    this.#onChange(download, action);
  }

  destroy() {
    this.#destroyed = true;
    this.#generation++;
    this.#popup?.hidePopup();
    this.#popup?.remove();
    this.#popup = null;
    this.#api.destroy();
  }
}
