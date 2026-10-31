/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { ZenDownloadPreview } from "moz-src:///zen/library/ZenDownloadPreview.sys.mjs";
import { libraryHiddenFiles } from "moz-src:///zen/library/ZenLibraryHiddenFiles.sys.mjs";

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
export function fileMenuOrder({ active, completed, presentation = "hover" }) {
  if (active) return ["cancel"];
  if (!completed) return [];
  return presentation === "hover"
    ? ["copy", "separator", "message", "airdrop", "separator", "open", "show", "separator", "hide", "trash"]
    : ["open", "copy", "show", "hide", "trash"];
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
    this.#api.fileInfo(download).catch(console.error);
  }

  async show(event, download, { presentation = "hover", anchor } = {}) {
    event.preventDefault();
    event.stopPropagation();
    if (!download || this.#destroyed) return;
    const commands = fileMenuOrder({ active: !download.stopped,
      completed: !!download.succeeded && download.target?.exists !== false && !download.deleted,
      presentation });
    if (!commands.length) return;
    const generation = ++this.#generation;
    this.#popup?.hidePopup();
    this.#popup?.remove();
    this.#popup = null;
    this.#onOpen();
    const doc = this.#window.document;
    try {
      const info = await this.#api.fileInfo(download);
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
          this.#execute(action, download).catch(console.error);
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

  async #execute(action, download) {
    const file = () => new lazy.FileUtils.File(download.target.path);
    if (action === "cancel") {
      await download.cancel();
      await download.removePartialData();
    } else if (action === "open") {
      file().launch();
    } else if (action === "show") {
      lazy.DownloadsCommon.showDownloadedFile(file());
    } else if (action === "hide") {
      // Browser records and discovered files are separate Arc data sources.
      // Suppress the disk fallback of a hidden record without excluding that
      // file from the independent Media scan.
      if (!lazy.PrivateBrowsingUtils.isWindowPrivate(this.#window)) {
        await libraryHiddenFiles().hide(download.target.path, !download._zenDiskFile);
      }
      if (!download._zenDiskFile) {
        // Firefox's generic deleteDownload removes all visits to this URL.
        // Hiding a download must leave ordinary browsing history intact.
        if (!download.source?.isPrivate) {
          const url = download.source?.originalUrl || download.source?.url;
          const uri = URL.parse(url)?.URI;
          if (uri && lazy.PlacesUtils.history.canAddURI(uri)) {
            await lazy.PlacesUtils.history.removeVisitsByFilter({
              url, transition: lazy.PlacesUtils.history.TRANSITIONS.DOWNLOAD,
            });
          }
        }
        const downloads = await lazy.Downloads.getList(lazy.Downloads.ALL);
        await downloads.remove(download);
        await download.finalize(true);
      }
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
