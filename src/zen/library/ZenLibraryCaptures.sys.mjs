/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export const CAPTURES_CHANGED = "zen-library-captures-changed";
const ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const IMAGE = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.png$/i;
const PNG = [137, 80, 78, 71, 13, 10, 26, 10];

function captureData(input) {
  const { id, url, createdDate, text = null, captureType, captureLayoutInfo } = input;
  if (typeof id !== "string" || !ID.test(id) || typeof url !== "string" || !url ||
      !Number.isFinite(createdDate) || createdDate < 0 ||
      (text !== null && typeof text !== "string") ||
      !["partialPage", "fullWindow"].includes(captureType)) {
    throw new TypeError("Invalid Library capture metadata");
  }
  // Layout describes the captured document, not whichever page is current
  // when an asynchronous image write finishes.
  const layout = {};
  for (const [key, fields] of Object.entries({
    webContentSize: ["width", "height"],
    webContentOffset: ["x", "y"],
    frameRelativeToViewport: ["x", "y", "width", "height"],
  })) {
    const value = captureLayoutInfo?.[key];
    if (!value || fields.some(field => !Number.isFinite(value[field])) ||
        fields.some(field => ["width", "height"].includes(field) && value[field] <= 0)) {
      throw new TypeError("Invalid Library capture layout");
    }
    layout[key] = Object.freeze(Object.fromEntries(fields.map(field => [field, value[field]])));
  }
  return Object.freeze({ id, url, createdDate, text, captureType,
    captureLayoutInfo: Object.freeze(layout) });
}

function storedCapture(input) {
  if (typeof input.image !== "string" || !IMAGE.test(input.image) ||
      !Number.isSafeInteger(input.bytes) || input.bytes < PNG.length)
    throw new TypeError("Invalid Library capture image metadata");
  return Object.freeze({ ...captureData(input), image: input.image, bytes: input.bytes });
}

/** Persistent capture data and owned images; copying alone does not call save. */
export class LibraryCaptures {
  #io;
  #records = new Map();
  #garbage = new Set();
  #queue = Promise.resolve();

  constructor(io) {
    this.#io = io;
    this.ready = Promise.resolve().then(() => io.read()).then(data => {
      if (data.version !== 1 || !Array.isArray(data.captures) ||
          !Array.isArray(data.garbage) || data.garbage.some(name => !IMAGE.test(name)))
        throw new TypeError("Invalid Library capture store");
      const records = new Map(), images = new Set();
      for (const input of data.captures) {
        const item = storedCapture(input);
        if (records.has(item.id) || images.has(item.image))
          throw new TypeError("Duplicate Library capture");
        records.set(item.id, item);
        images.add(item.image);
      }
      if (data.garbage.some(name => images.has(name)))
        throw new TypeError("A live capture cannot be pending deletion");
      this.#records = records;
      this.#garbage = new Set(data.garbage);
    });
  }

  get(id) { return this.#records.get(id); }

  get items() {
    return [...this.#records.values()].sort((a, b) => b.createdDate - a.createdDate);
  }

  recent(limit = 4) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError("Invalid capture limit");
    const newest = [];
    if (!limit) return newest;
    for (const item of this.#records.values()) {
      if (newest.length === limit && item.createdDate <= newest.at(-1).createdDate) continue;
      const index = newest.findIndex(other => item.createdDate > other.createdDate);
      newest.splice(index < 0 ? newest.length : index, 0, item);
      if (newest.length > limit) newest.pop();
    }
    return newest;
  }

  imagePath(item) {
    if (this.#records.get(item.id) !== item)
      throw new Error("The capture is no longer current");
    return this.#io.imagePath(item.image);
  }

  #serialize(records = this.#records, garbage = this.#garbage) {
    return { version: 1, captures: [...records.values()], garbage: [...garbage] };
  }

  #imageInUse(name) {
    for (const item of this.#records.values()) if (item.image === name) return true;
    return false;
  }

  #enqueue(operation) {
    const pending = this.#queue.then(async () => {
      await this.ready;
      await this.#collectGarbage();
      return operation();
    });
    this.#queue = pending.catch(() => {});
    return pending;
  }

  async #collectGarbage() {
    if (!this.#garbage.size) return;
    const remaining = new Set(this.#garbage);
    for (const name of this.#garbage) {
      try { await this.#io.removeImage(name); remaining.delete(name); }
      catch { /* Keep the persisted tombstone for the next mutation/relaunch. */ }
    }
    if (remaining.size === this.#garbage.size) return;
    // A failed journal cleanup is harmless: removals are idempotent and the
    // persisted names can be retried without touching any live image.
    try {
      await this.#io.write(this.#serialize(this.#records, remaining));
      this.#garbage = remaining;
    } catch { /* Retain the original journal until a later successful write. */ }
  }

  save(input, png) {
    let data, bytes;
    try {
      data = captureData(input);
      // Browser windows and shared system modules have different realms.
      // Accept their byte views without depending on constructor identity.
      if (!ArrayBuffer.isView(png) || png.BYTES_PER_ELEMENT !== 1 || png.length < PNG.length ||
          PNG.some((byte, index) => png[index] !== byte))
        throw new TypeError("A Library capture requires PNG bytes");
      bytes = new Uint8Array(png);
    } catch (error) { return Promise.reject(error); }
    return this.#enqueue(async () => {
      const image = this.#io.newID() + ".png";
      if (!IMAGE.test(image) || this.#imageInUse(image) || this.#garbage.has(image))
        throw new Error("Invalid or reused capture image identifier");
      const item = Object.freeze({ ...data, image, bytes: bytes.length });
      const records = new Map(this.#records), garbage = new Set(this.#garbage);
      const previous = records.get(item.id);
      if (previous) garbage.add(previous.image);
      records.set(item.id, item);
      try {
        // A new image revision protects the old capture if metadata fails.
        await this.#io.writeImage(image, bytes);
        await this.#io.write(this.#serialize(records, garbage));
      } catch (error) {
        try { await this.#io.removeImage(image); } catch { /* Preserve the original failure. */ }
        throw error;
      }
      this.#records = records;
      this.#garbage = garbage;
      this.#io.notify();
      await this.#collectGarbage();
      return item;
    });
  }

  remove(id) {
    return this.#enqueue(async () => {
      const item = this.#records.get(id);
      if (!item) return false;
      const records = new Map(this.#records), garbage = new Set(this.#garbage);
      records.delete(id);
      garbage.add(item.image);
      // Persist deletion before reclaiming bytes. An interrupted cleanup can
      // never restore the capture or delete a later image revision.
      await this.#io.write(this.#serialize(records, garbage));
      this.#records = records;
      this.#garbage = garbage;
      this.#io.notify();
      await this.#collectGarbage();
      return true;
    });
  }

  clear() {
    return this.#enqueue(async () => {
      const count = this.#records.size;
      if (!count) return 0;
      const garbage = new Set(this.#garbage);
      for (const item of this.#records.values()) garbage.add(item.image);
      const records = new Map();
      await this.#io.write(this.#serialize(records, garbage));
      this.#records = records;
      this.#garbage = garbage;
      this.#io.notify();
      await this.#collectGarbage();
      return count;
    });
  }
}

let shared;
export function libraryCaptures() {
  if (shared) return shared;
  const directory = PathUtils.join(PathUtils.profileDir, "zen-library-captures");
  const manifest = PathUtils.join(directory, "captures.json");
  const imagePath = name => PathUtils.join(directory, name);
  const prepare = () => IOUtils.makeDirectory(directory, { ignoreExisting: true });
  return shared = new LibraryCaptures({
    imagePath,
    newID: () => Services.uuid.generateUUID().toString().slice(1, -1),
    async read() {
      try { return await IOUtils.readJSON(manifest); }
      catch (error) {
        if (error.name === "NotFoundError") return { version: 1, captures: [], garbage: [] };
        throw error;
      }
    },
    async write(data) {
      await prepare();
      await IOUtils.writeJSON(manifest, data, { tmpPath: manifest + ".tmp" });
    },
    async writeImage(name, bytes) {
      await prepare();
      const path = imagePath(name);
      await IOUtils.write(path, bytes, { tmpPath: path + ".tmp" });
    },
    async removeImage(name) {
      const path = imagePath(name);
      await IOUtils.remove(path, { ignoreAbsent: true });
      await IOUtils.remove(path + ".tmp", { ignoreAbsent: true });
    },
    notify() { Services.obs.notifyObservers(null, CAPTURES_CHANGED); },
  });
}
