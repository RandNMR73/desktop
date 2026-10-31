/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { ZenDownloadPreview, downloadDate } from "moz-src:///zen/library/ZenDownloadPreview.sys.mjs";
import { ZenLibraryFileMenu } from "moz-src:///zen/library/ZenLibraryFileMenu.sys.mjs";
import { mediaKindOf, extensionOf } from "moz-src:///zen/library/ZenLibraryUtils.sys.mjs";

let library;
let backend;
const previews = new WeakMap();

function native() {
  if (backend !== undefined) return backend;
  backend = null;
  if (Services.appinfo.OS !== "Darwin") return null;
  try {
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const executable = Services.dirsvc.get("XREExeF", Ci.nsIFile);
    library = ctypes.open(PathUtils.join(executable.parent.path, "libzen-native-theme.dylib"));
    const declare = (name, result, ...args) => library.declare(name, ctypes.default_abi, result, ...args);
    if (declare("zen_media_preview_version", ctypes.int)() !== 1) return null;
    const open = declare("zen_media_preview_open", ctypes.uint32_t, ctypes.uint64_t, ctypes.char.ptr);
    const poll = declare("zen_media_preview_poll", ctypes.int, ctypes.uint32_t, ctypes.char.ptr, ctypes.uint32_t);
    const close = declare("zen_media_preview_close", ctypes.void_t, ctypes.uint32_t);
    const finish = declare("zen_media_preview_action_finished", ctypes.void_t,
      ctypes.uint32_t, ctypes.int32_t, ctypes.int32_t);
    let captures = false;
    try { captures = declare("zen_media_preview_captures_version", ctypes.int)() === 1; }
    catch { /* Older bundles cannot present capture titles and actions. */ }
    backend = {
      captures,
      open(window, request) {
        const handle = window.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).nativeHandle;
        return open(ctypes.UInt64(handle), JSON.stringify(request));
      },
      poll(id) {
        const ready = poll(id, null, 0);
        if (ready !== -2) return ready === -1 ? { closed: true } : null;
        const buffer = ctypes.char.array(65536)();
        const result = poll(id, buffer, buffer.length);
        return result === 1 ? JSON.parse(buffer.readString()) : result === -1 ? { closed: true } : null;
      },
      close, finish,
    };
  } catch { /* Older bundles retain the existing browser preview. */ }
  return backend;
}

export function downloadCanPreview(download) {
  const path = download?.target?.path;
  return !!path && download.succeeded && download.target.exists !== false && !download.deleted &&
    (mediaKindOf(path) === "image" || extensionOf(path) === "pdf");
}

export function nativeMediaPreview(window) {
  if (!previews.has(window)) previews.set(window, new ZenNativeMediaPreview(window));
  return previews.get(window);
}

export class ZenNativeMediaPreview {
  #window;
  #api;
  #files;
  #actions;
  #id = 0;
  #timer = null;
  #generation = 0;
  #items = [];
  #destroyed = false;
  #labels;
  #unload = () => this.destroy();

  constructor(window, api, files, actions) {
    this.#window = window;
    this.#api = api;
    this.#files = files || new ZenDownloadPreview(window);
    this.#actions = actions || new ZenLibraryFileMenu(window);
    window.addEventListener("unload", this.#unload, { once: true });
  }

  get isOpen() { return !!this.#id; }

  async #localizedLabels() {
    const l10n = this.#window.document.l10n;
    const labels = {};
    const keys = ["close", "previous", "next", "more"];
    const values = await l10n.formatValues(keys.map(key => ({ id: "library-preview-" + key })));
    keys.forEach((key, i) => labels[key] = values[i]);
    labels.openIn = await l10n.formatValue("library-media-open-in", { app: "{app}" });
    const requests = ["show", "hide", "trash", "message", "airdrop", "open-source", "copy-source", "delete-capture"]
      .map(key => [key, { id: "library-file-" + key }]);
    for (const kind of ["image", "movie", "pdf", "file"]) {
      const name = await l10n.formatValue("library-file-kind-" + kind);
      for (const action of ["open", "copy"]) {
        requests.push([action + "." + kind, { id: "library-file-" + action, args: { kind: name } }]);
      }
    }
    const messages = await l10n.formatMessages(requests.map(([, request]) => request));
    requests.forEach(([key], i) => labels[key] = messages[i].attributes.find(a => a.name === "label").value);
    return labels;
  }

  openDownloads(download, downloads) {
    if (!downloadCanPreview(download)) return Promise.resolve(false);
    const items = downloads.filter(downloadCanPreview).slice(0, 512);
    // The clicked object may be a wrapper around the same Downloads record.
    const index = items.findIndex(d => d.target.path === download.target.path);
    return this.open({ items, index });
  }

  async open({ items, index }) {
    if (this.#destroyed || index < 0 || !items[index]) return false;
    const api = this.#api ??= native();
    if (!api) return false;
    if (!api.captures && items.some(item => item._zenLibraryCapture)) return false;
    this.close();
    const generation = this.#generation;
    const records = items.map(item => item.target ? item : ({
      _zenDiskFile: true, succeeded: true, stopped: true,
      source: { url: item.url }, target: { path: item.path, exists: true },
      startTime: item.modified, endTime: item.modified,
    }));
    try {
      const labels = await (this.#labels ??= this.#localizedLabels());
      if (this.#destroyed || generation !== this.#generation) return true;
      this.#items = records;
      this.#id = api.open(this.#window, { index, labels,
        dark: this.#window.matchMedia("(prefers-color-scheme: dark)").matches,
        items: records.map((item, token) => ({
        token, path: item.target.path, date: this.#files.date(downloadDate(item)),
        ...(item._zenLibraryCapture ? { capture: true, title: item.title } : {}),
      })) });
      if (!this.#id) { this.#items = []; return false; }
      this.#poll();
      return true;
    } catch (error) {
      console.error(error);
      if (generation !== this.#generation) return true;
      this.close();
      return false;
    }
  }

  #poll() {
    const id = this.#id;
    if (!id) return;
    try {
      const result = this.#api.poll(id);
      if (result?.closed) { this.close(); return; }
      for (const event of result?.events || []) {
        const item = this.#items[event.token];
        const allowed = item?._zenLibraryCapture
          ? ["copy", "message", "airdrop", "open-source", "copy-source", "delete-capture"]
          : ["hide", "trash"];
        if (!item || !allowed.includes(event.action)) continue;
        this.#actions.execute(event.action, item).then(
          () => {
            if (this.#id !== id) return;
            if (event.action === "open-source") { this.close(); return; }
            this.#api.finish(id, event.token,
              ["hide", "trash", "delete-capture"].includes(event.action) ? 1 : 0);
          },
          error => {
            console.error(error);
            if (this.#id === id) this.#api.finish(id, event.token, 0);
          }
        );
      }
    } catch (error) { console.error(error); this.close(); return; }
    this.#timer = this.#window.setTimeout(() => this.#poll(), 80);
  }

  close() {
    this.#generation++;
    this.#window.clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#id) this.#api.close(this.#id);
    this.#id = 0;
    this.#items = [];
  }

  destroy() {
    this.#destroyed = true;
    this.close();
    this.#files.destroy();
    this.#actions.destroy();
    this.#window.removeEventListener("unload", this.#unload);
  }
}
