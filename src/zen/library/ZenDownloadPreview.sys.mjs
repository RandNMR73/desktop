/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

let nativeLibrary;
let backend;

function native() {
  if (backend !== undefined) return backend;
  backend = null;
  if (Services.appinfo.OS !== "Darwin") return null;
  try {
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const executable = Services.dirsvc.get("XREExeF", Ci.nsIFile);
    // Objective-C classes keep the library rooted for the process lifetime.
    nativeLibrary = ctypes.open(PathUtils.join(executable.parent.path, "libzen-native-theme.dylib"));
    const declare = (name, result, ...args) =>
      nativeLibrary.declare(name, ctypes.default_abi, result, ...args);
    if (declare("zen_downloads_version", ctypes.int)() !== 1) return null;
    const start = declare("zen_downloads_request", ctypes.uint32_t, ctypes.char.ptr);
    const result = declare("zen_downloads_result", ctypes.int, ctypes.uint32_t, ctypes.char.ptr, ctypes.uint32_t);
    const release = declare("zen_downloads_release", ctypes.void_t, ctypes.uint32_t);
    const date = declare("zen_downloads_relative_date", ctypes.int,
      ctypes.double, ctypes.double, ctypes.char.ptr, ctypes.uint32_t);
    let actions = false;
    try { actions = declare("zen_downloads_actions_version", ctypes.int)() === 1; }
    catch { /* Earlier native bundles still support thumbnails and dates. */ }
    backend = {
      actions,
      start: request => start(JSON.stringify(request)), release,
      result(id) {
        const ready = result(id, null, 0);
        if (ready !== -2) return ready;
        const buffer = ctypes.char.array(262144)();
        const status = result(id, buffer, buffer.length);
        return status > 0 ? JSON.parse(buffer.readString()) : status;
      },
      date(timestamp, now) {
        const buffer = ctypes.char.array(1024)();
        return date(timestamp, now, buffer, buffer.length) ? buffer.readString() : "";
      },
    };
  } catch { /* Optional native ABI: keep the existing Gecko icon fallback. */ }
  return backend;
}

export function downloadDate(download) {
  return Number(download.startTime ?? download.endTime) || 0;
}

// The newest item sits next to the footer. Merge disk entries with live
// downloads by path so an in-progress item is never shown a second time.
export function recentDownloads(downloads, files, limit = 4) {
  const items = new Map(files.map(file => [file.target.path, file]));
  for (const download of downloads) {
    const path = download.target?.path;
    if (download.deleted || (download.succeeded && download.target?.exists === false)) {
      if (path) items.delete(path);
      continue;
    }
    items.set(path || download, download);
  }
  return [...items.values()]
    .sort((a, b) => downloadDate(a) - downloadDate(b))
    .slice(-limit);
}

export function relativeDownloadDate(timestamp, now = Date.now(), locale) {
  const seconds = Math.max(0, (now - timestamp) / 1000);
  const units = [[31536000, "year"], [2592000, "month"], [604800, "week"],
    [86400, "day"], [3600, "hour"], [60, "minute"], [1, "second"]];
  const [duration, unit] = units.find(([duration]) => seconds >= duration) || units.at(-1);
  return new Intl.RelativeTimeFormat(locale, { numeric: "always" })
    .format(-Math.floor(seconds / duration), unit);
}

export class ZenDownloadPreview {
  #window;
  #backend;
  #jobs = new Map();
  #images = new Map();
  #details = new Map();
  #destroyed = false;

  constructor(window, api) {
    this.#window = window;
    this.#backend = api;
  }

  #api() {
    return this.#backend === undefined ? (this.#backend = native()) : this.#backend;
  }

  date(timestamp, now = Date.now()) {
    return this.#api()?.date(timestamp, now) || relativeDownloadDate(timestamp, now);
  }

  #request(input) {
    if (this.#destroyed) return Promise.resolve(null);
    const api = this.#api();
    const id = api?.start(input);
    if (!id) return Promise.resolve(null);
    return new Promise(resolve => {
      const job = { timer: null, resolve, started: Date.now() };
      this.#jobs.set(id, job);
      const finish = result => {
        this.#jobs.delete(id);
        api.release(id);
        resolve(result);
      };
      const poll = () => {
        if (!this.#jobs.has(id)) return;
        try {
          const result = api.result(id);
          if (result !== 0) { finish(typeof result === "object" ? result : null); return; }
          if (Date.now() - job.started > 10000) { finish(null); return; }
          job.timer = this.#window.setTimeout(poll, 80);
        } catch { finish(null); }
      };
      poll();
    });
  }

  async files(path, excludedPathsFile) {
    const result = await this.#request({ operation: "list", path, excludedPathsFile });
    return (result?.files || []).map(file => ({
      _zenDiskFile: true, _zenCloudFile: file.cloud, _zenModified: file.modified,
      source: { url: PathUtils.toFileURI(file.path) }, target: { path: file.path, exists: true },
      // Folder items use modification time; browser records retain their own
      // download start time when recentDownloads merges the two sources.
      startTime: file.modified, endTime: file.modified, totalBytes: file.size,
      currentBytes: file.size, stopped: true, succeeded: true,
      canceled: false, deleted: false, error: null,
    }));
  }

  fileInfo(download) {
    if (!download?.succeeded || !download.target?.exists || !this.#api()?.actions) {
      return Promise.resolve(null);
    }
    const path = download.target.path;
    const key = JSON.stringify([path, download._zenModified || download.endTime, download.totalBytes]);
    const cached = this.#details.get(key);
    if (!cached || Date.now() - cached.time > 5000) {
      this.#details.set(key, { time: Date.now(), result: this.#request({ operation: "info", path }) });
      if (this.#details.size > 16) this.#details.delete(this.#details.keys().next().value);
    }
    return this.#details.get(key).result;
  }

  fileAction(download, operation) {
    if (!download?.target?.path || !this.#api()?.actions ||
        !["copy", "message", "airdrop", "trash"].includes(operation)) return Promise.resolve(null);
    return this.#request({ operation, path: download.target.path });
  }

  thumbnail(download) {
    if (!download.succeeded || download.deleted || !download.target?.exists ||
        download._zenCloudFile || this.#destroyed) return Promise.resolve(null);
    const path = download.target.path;
    const key = JSON.stringify([path, download._zenModified || download.endTime,
      download.totalBytes, this.#window.devicePixelRatio]);
    if (!this.#images.has(key)) {
      this.#images.set(key, this.#request({
        operation: "thumbnail", path, scale: this.#window.devicePixelRatio,
      }));
      if (this.#images.size > 16) this.#images.delete(this.#images.keys().next().value);
    }
    return this.#images.get(key);
  }

  destroy() {
    this.#destroyed = true;
    for (const [id, job] of this.#jobs) {
      this.#window.clearTimeout(job.timer);
      this.#backend.release(id);
      job.resolve(null);
    }
    this.#jobs.clear();
    this.#images.clear();
    this.#details.clear();
  }
}
