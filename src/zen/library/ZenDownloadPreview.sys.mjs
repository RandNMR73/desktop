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
    let dateGroup, transfer;
    try {
      dateGroup = declare("zen_downloads_date_group", ctypes.int,
        ctypes.double, ctypes.double, ctypes.char.ptr, ctypes.uint32_t);
    } catch { /* Older bundles use the local-calendar fallback. */ }
    try {
      transfer = declare("zen_downloads_transfer_text", ctypes.int,
        ctypes.double, ctypes.double, ctypes.double, ctypes.double,
        ctypes.char.ptr, ctypes.uint32_t);
    } catch { /* Older bundles retain Gecko's transfer formatter. */ }
    let actions = false;
    try { actions = declare("zen_downloads_actions_version", ctypes.int)() === 1; }
    catch { /* Earlier native bundles still support thumbnails and dates. */ }
    let sources = false;
    try { sources = declare("zen_downloads_sources_version", ctypes.int)() === 1; }
    catch { /* Source directories require the extended bounded query. */ }
    let media = false;
    try { media = declare("zen_downloads_media_version", ctypes.int)() === 1; }
    catch { /* Earlier native bundles use the Gecko Media scanner. */ }
    backend = {
      actions, sources, media,
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
      dateGroup: dateGroup ? (timestamp, now) => {
        const buffer = ctypes.char.array(1024)();
        const result = dateGroup(timestamp, now, buffer, buffer.length);
        if (result === -1) return { key: "today", l10nId: "library-downloads-today" };
        if (result === -2) return { key: "yesterday", l10nId: "library-downloads-yesterday" };
        return result > 0 ? { key: buffer.readString(), label: buffer.readString() } : null;
      } : null,
      transfer: transfer ? (current, total, remaining, now) => {
        const buffer = ctypes.char.array(1024)();
        const size = transfer(current, total, remaining, now, buffer, buffer.length);
        return size >= 0 ? buffer.readString() : null;
      } : null,
    };
  } catch { /* Optional native ABI: keep the existing Gecko icon fallback. */ }
  return backend;
}

export function downloadDate(download) {
  return Number(download.startTime ?? download.endTime) || 0;
}

export function downloadPreviewState(download) {
  if (!download) return "none";
  if (!download.stopped) return "active";
  if (download.succeeded) return "completed";
  if (download.canceled) return download.hasPartialData ? "paused" : "cancelled";
  return download.error ? "failed" : "notStarted";
}

export function downloadPreviewSubtitle(download, { domain = "", transfer = "", date = "" } = {}) {
  const state = downloadPreviewState(download);
  switch (state) {
    case "active": {
      if (!(download.totalBytes > 0)) return { text: "" };
      if (!download.launchWhenSucceeded) return { text: transfer };
      // Arc converts both byte counts to Float before computing this integer.
      const progress = Math.trunc(Math.fround(Math.fround(
        Math.fround(download.currentBytes) / Math.fround(download.totalBytes)) * 100));
      return Number.isFinite(progress)
        ? { id: "library-preview-opening", args: { progress } } : { text: "" };
    }
    case "completed": return { text: date };
    case "failed": return { id: "library-preview-failed" };
    case "paused":
    case "cancelled": return domain
      ? { id: `library-preview-${state}-source`, args: { domain } }
      : { id: `library-preview-${state}` };
    default: return { text: "" };
  }
}

// Arc's Library uses createdAt, even when a later completion date exists.
// Missing creation dates form the distant-past group.
export function downloadCreatedDate(download, historyDates) {
  if (download.startTime != null) return Number(download.startTime);
  return historyDates?.get(download) ?? NaN;
}

async function readDownloadCreationDates(urls) {
  const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const db = await PlacesUtils.promiseDBConnection();
  const dates = new Map();
  // URI history nodes can expose the latest ordinary visit after a restart.
  // Read only download visits, using the URL hash and place/visit indexes.
  for (let offset = 0; offset < urls.length; offset += 200) {
    const chunk = urls.slice(offset, offset + 200);
    const params = { transition: PlacesUtils.history.TRANSITIONS.DOWNLOAD };
    const targets = chunk.map((url, index) => {
      params[`url${index}`] = url;
      return `(:url${index})`;
    }).join(",");
    const rows = await db.executeCached(`
      WITH targets(url) AS (VALUES ${targets})
      SELECT targets.url AS url, MAX(visits.visit_date) / 1000.0 AS created
      FROM targets
      JOIN moz_places AS pages ON pages.url_hash = hash(targets.url) AND pages.url = targets.url
      JOIN moz_historyvisits AS visits ON visits.place_id = pages.id AND visits.visit_type = :transition
      GROUP BY targets.url`, params);
    for (const row of rows) dates.set(row.getResultByName("url"), row.getResultByName("created"));
  }
  return dates;
}

export class ZenDownloadCreationDates {
  #cache = new WeakMap();
  #pending = false;
  #generation = 0;
  #destroyed = false;
  #changed;
  #read;

  constructor(changed, read = readDownloadCreationDates) {
    this.#changed = changed;
    this.#read = read;
  }

  #entry(download) {
    const cached = this.#cache.get(download);
    return cached?.node === download.placesNode && cached?.time === download.placesNode?.time
      ? cached : undefined;
  }

  get(download) {
    // Keep the last resolved creation time while a changed node is refreshed.
    // An ordinary visit must not erase the heading during an unrelated repaint.
    return this.#cache.get(download)?.date ?? NaN;
  }

  // True means that rows must retain their previous rendering until the dates
  // arrive. A repaint or a rapid list change never starts a parallel query.
  update(downloads) {
    if (this.#destroyed) return false;
    const unresolved = downloads.filter(item => item.startTime == null && item.placesNode && !this.#entry(item));
    if (!unresolved.length) return false;
    if (this.#pending) return true;
    const generation = this.#generation;
    const snapshots = unresolved.map(item => ({ item, node: item.placesNode, time: item.placesNode.time,
      url: item.source.originalUrl || item.source.url }));
    this.#pending = true;
    Promise.resolve().then(() => this.#read([...new Set(snapshots.map(item => item.url))]))
      .catch(error => { console.error(error); return new Map(); })
      .then(dates => {
        if (this.#destroyed || generation !== this.#generation) return;
        for (const { item, node, time, url } of snapshots) {
          if (item.placesNode === node && node.time === time) {
            this.#cache.set(item, { node, time, date: dates.get(url) ?? NaN });
          }
        }
      }).finally(() => {
        this.#pending = false;
        if (!this.#destroyed) this.#changed();
      });
    return true;
  }

  invalidate() {
    this.#generation++;
    this.#cache = new WeakMap();
  }

  destroy() {
    this.#destroyed = true;
    this.invalidate();
  }
}

export function fallbackDownloadDateGroup(timestamp, now, locale) {
  const date = new Date(timestamp);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date >= today && date < tomorrow) {
    return { key: "today", l10nId: "library-downloads-today" };
  }
  if (date >= yesterday && date < today) {
    return { key: "yesterday", l10nId: "library-downloads-yesterday" };
  }
  const label = relativeDownloadDate(Number.isFinite(timestamp) ? timestamp :
    new Date("0001-01-01T00:00:00Z").getTime(), now, locale);
  return { key: label, label };
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
  #transfers = new Map();
  #domains = new WeakMap();
  #dateGroups = new Map();
  #dateGroupMinute;
  #destroyed = false;
  #historyDates;

  constructor(window, api, historyDates) {
    this.#window = window;
    this.#backend = api;
    this.#historyDates = historyDates;
  }

  #api() {
    return this.#backend === undefined ? (this.#backend = native()) : this.#backend;
  }

  date(timestamp, now = Date.now()) {
    return this.#api()?.date(timestamp, now) || relativeDownloadDate(timestamp, now);
  }

  transfer(download, now = Date.now()) {
    if (this.#destroyed || !this.#api()?.transfer) return null;
    const current = Math.max(0, download.currentBytes || 0);
    const total = download.totalBytes > 0 ? download.totalBytes : -1;
    const remaining = Number.isFinite(download.speed) && download.speed > 0 && total >= current
      ? Math.floor((total - current) / download.speed) : -1;
    // The row and footer repaint from the same notifications. Cache only a
    // bounded second of equivalent inputs, including the date for DST changes.
    const key = JSON.stringify([current, total, remaining, Math.floor(now / 1000)]);
    if (!this.#transfers.has(key)) {
      this.#transfers.set(key, this.#api().transfer(current, total, remaining, now));
      if (this.#transfers.size > 16) this.#transfers.delete(this.#transfers.keys().next().value);
    }
    return this.#transfers.get(key);
  }

  sourceDomain(download) {
    const url = download.source?.url || "";
    const cached = this.#domains.get(download);
    if (cached?.url === url) return cached.domain;
    let domain = "";
    try {
      const host = new URL(url).hostname;
      if (host && Services.eTLD.getKnownPublicSuffixFromHost(host)) {
        domain = Services.eTLD.getBaseDomainFromHost(host);
      }
    } catch { /* IPs, single-label hosts and missing domains have no suffix. */ }
    this.#domains.set(download, { url, domain });
    return domain;
  }

  clearDateGroups() {
    this.#dateGroups.clear();
  }

  groups(downloads, now = Date.now()) {
    // Thumbnail completions can render the list repeatedly. Format each
    // visible timestamp once per minute, and release labels that leave it.
    const minute = Math.floor(now / 60000);
    if (minute !== this.#dateGroupMinute) this.clearDateGroups();
    this.#dateGroupMinute = minute;
    const labels = new Map(), groups = new Map();
    for (const download of downloads) {
      const timestamp = downloadCreatedDate(download, this.#historyDates);
      let heading = this.#dateGroups.get(timestamp) || labels.get(timestamp);
      if (!heading) heading = this.#api()?.dateGroup?.(timestamp, now) ||
        fallbackDownloadDateGroup(timestamp, now);
      labels.set(timestamp, heading);
      if (!groups.has(heading.key)) groups.set(heading.key, { ...heading, downloads: [] });
      groups.get(heading.key).downloads.push(download);
    }
    this.#dateGroups = labels;
    return [...groups.values()];
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
    return this.#fileRecords(result);
  }

  async sourceFiles(path, sources, excludedPathsFile) {
    if (!this.#api()?.sources) {
      return sources.download ? this.files(path, excludedPathsFile) : [];
    }
    const enabled = Object.fromEntries(["download", "documents", "desktop", "screenshot"]
      .map(key => [key, !!sources[key]]));
    if (!Object.values(enabled).some(Boolean)) return [];
    // Resolve the macOS screenshot location and scan in a single background
    // request, avoiding a second polling round trip on the 150ms hover path.
    return this.#fileRecords(await this.#request({
      operation: "sources", path, sources: enabled, excludedPathsFile,
    }));
  }

  async mediaFiles(folders, excludedPathsFile) {
    if (!this.#api()?.media) return null;
    const result = await this.#request({ operation: "media", path: "/",
      folders, excludedPathsFile });
    // Only an unsupported ABI should select the Gecko scanner. Retrying a
    // failed native query there can block on exactly the same directory open.
    if (!Array.isArray(result?.files)) throw new Error("Media folder query failed");
    return result.files;
  }

  #fileRecords(result) {
    // A timed-out or rejected query is not an empty directory. Let the widget
    // retain its last successful files until a new scan actually completes.
    if (!Array.isArray(result?.files)) throw new Error("Preview folder query failed");
    return result.files.map(file => ({
      _zenDiskFile: true, _zenMediaFile: !!file.media,
      _zenCloudFile: file.cloud, _zenModified: file.modified,
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

  thumbnail(download, size = 40) {
    if (!download.succeeded || download.deleted || !download.target?.exists ||
        download._zenCloudFile || this.#destroyed) return Promise.resolve(null);
    const path = download.target.path;
    const key = JSON.stringify([path, download._zenModified || download.endTime,
      download.totalBytes, download.target.size, this.#window.devicePixelRatio, size]);
    if (!this.#images.has(key)) {
      const pending = this.#request({
        operation: "thumbnail", path, scale: this.#window.devicePixelRatio, size,
      });
      this.#images.set(key, pending);
      pending.then(result => {
        if (!result?.url && this.#images.get(key) === pending) {
          this.#images.delete(key);
        }
      });
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
    this.#transfers.clear();
    this.#domains = new WeakMap();
    this.clearDateGroups();
  }
}

// Library pages may contain hundreds of files. Keep Quick Look work bounded
// and discard queued work when search/filtering replaces the visible list.
export class ZenDownloadListPresentation {
  #preview;
  #cache = new WeakMap();
  #queue = [];
  #active = 0;
  #changed;
  #destroyed = false;

  constructor(preview, changed) {
    this.#preview = preview;
    this.#changed = changed;
  }

  update(downloads) {
    if (this.#destroyed) return;
    for (const { download, entry } of this.#queue) {
      if (this.#cache.get(download) === entry) this.#cache.delete(download);
    }
    this.#queue = [];
    for (const download of downloads) {
      const key = JSON.stringify([download.target?.path, download.endTime,
        download.totalBytes, download.target?.size, download.target?.exists,
        download.succeeded, download.deleted]);
      const kept = this.#cache.get(download);
      if (kept?.key === key && (!kept.retryAt || Date.now() < kept.retryAt)) continue;
      const entry = { key, result: kept?.key === key ? kept.result : null };
      this.#cache.set(download, entry);
      if (download.succeeded && !download.deleted && download.target?.exists) {
        this.#queue.push({ download, entry });
      }
    }
    this.#pump();
  }

  get(download) {
    return this.#cache.get(download)?.result;
  }

  #pump() {
    while (!this.#destroyed && this.#active < 3 && this.#queue.length) {
      const { download, entry } = this.#queue.shift();
      this.#active++;
      this.#preview.thumbnail(download, 24).then(result => {
        if (!this.#destroyed && this.#cache.get(download) === entry) {
          entry.result = result;
          if (!result?.url) entry.retryAt = Date.now() + 5000;
          this.#changed();
        }
      }).catch(() => {}).finally(() => {
        this.#active--;
        this.#pump();
      });
    }
  }

  destroy() {
    this.#destroyed = true;
    this.#queue = [];
    this.#cache = new WeakMap();
    this.#preview.destroy();
  }
}
