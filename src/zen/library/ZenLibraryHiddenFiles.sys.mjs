/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export const HIDDEN_FILES_CHANGED = "zen-library-hidden-files-changed";

// Arc's FileQueryClient keeps ignored file paths in a separate persistent
// store. Hiding a discovered file never deletes the file itself.
export class LibraryHiddenFiles {
  #paths = new Set();
  #downloadPaths = new Set();
  #write;
  #notify;
  #queue = Promise.resolve();

  constructor({ path, read, write, notify }) {
    this.path = path;
    this.#write = write;
    this.#notify = notify;
    this.ready = read().then(data => {
      if (data.version !== 1 || !Array.isArray(data.paths) ||
          data.paths.some(value => typeof value !== "string")) {
        throw new Error("Invalid Library hidden-file metadata");
      }
      this.#paths = new Set(data.paths);
      if (data.downloadPaths !== undefined && (!Array.isArray(data.downloadPaths) ||
          data.downloadPaths.some(value => typeof value !== "string"))) {
        throw new Error("Invalid hidden-download metadata");
      }
      this.#downloadPaths = new Set(data.downloadPaths || []);
    });
  }

  has(path) {
    return this.#paths.has(path);
  }

  hasDownload(path) {
    return this.#downloadPaths.has(path);
  }

  hide(path, download = false) {
    if (typeof path !== "string" || !path) return Promise.reject(new Error("Missing file path"));
    const change = this.#queue.then(async () => {
      await this.ready;
      if ((download ? this.#downloadPaths : this.#paths).has(path)) return;
      const paths = new Set(this.#paths);
      const downloadPaths = new Set(this.#downloadPaths);
      (download ? downloadPaths : paths).add(path);
      // Commit before notifying readers: the native directory scan can then
      // exclude hidden entries before choosing its four newest results.
      await this.#write({ version: 1, paths: [...paths], downloadPaths: [...downloadPaths] });
      this.#paths = paths;
      this.#downloadPaths = downloadPaths;
      this.#notify();
    });
    this.#queue = change.catch(() => {});
    return change;
  }
}

let shared;
export function libraryHiddenFiles() {
  return shared ??= new LibraryHiddenFiles({
    path: PathUtils.join(PathUtils.profileDir, "zen-library-hidden-files.json"),
    async read() {
      try {
        return await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir, "zen-library-hidden-files.json"));
      } catch (error) {
        if (error.name === "NotFoundError") return { version: 1, paths: [] };
        throw error;
      }
    },
    write(data) {
      const path = PathUtils.join(PathUtils.profileDir, "zen-library-hidden-files.json");
      return IOUtils.writeJSON(path, data, { tmpPath: path + ".tmp" });
    },
    notify() { Services.obs.notifyObservers(null, HIDDEN_FILES_CHANGED); },
  });
}
