/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { JSONFile } from "resource://gre/modules/JSONFile.sys.mjs";
import {
  createDocument,
  normalizeDocument,
  mergeDocuments,
} from "chrome://browser/content/zen-easels/ZenEaselModel.mjs";

export const EASEL_CHANGED = "zen-easel-changed";
const root = () => PathUtils.join(PathUtils.profileDir, "zen-easels");
const validId = (id) => typeof id === "string" && /^[\w-]{1,100}$/.test(id);

// A single store per profile, shared by browser windows. JSONFile coalesces
// writes, uses atomic replacement, and flushes on profile-before-change.
export const ZenEaselStore = {
  _file: null,
  _loading: null,
  id() {
    return Services.uuid.generateUUID().toString().slice(1, -1);
  },
  async ready() {
    return (this._loading ??= (async () => {
      await IOUtils.makeDirectory(root(), { ignoreExisting: true });
      this._file = new JSONFile({
        path: PathUtils.join(root(), "documents.json"),
      });
      await this._file.load();
      this._file.data ??= {};
      this._file.data.documents ??= {};
    })());
  },
  async list() {
    await this.ready();
    return Object.values(this._file.data.documents)
      .map(normalizeDocument)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async get(id) {
    await this.ready();
    const document = this._file.data.documents[id];
    return document ? normalizeDocument(document) : null;
  },
  async create(width) {
    await this.ready();
    const document = createDocument(this.id(), this.id(), width);
    this.save(document);
    return document;
  },
  save(document, base = null) {
    let clean = normalizeDocument(document);
    if (!this._file) {
      throw new Error("Easel store is not loaded");
    }
    const current = this._file.data.documents[clean.id];
    if (base && current) {
      clean = mergeDocuments(base, clean, current, () => this.id());
    }
    this._file.data.documents[clean.id] = clean;
    this._file.saveSoon();
    Services.obs.notifyObservers(null, EASEL_CHANGED, clean.id);
    return clean;
  },
  async archive(id, archived) {
    const document = await this.get(id);
    if (document) {
      document.archived = archived;
      document.updatedAt = Date.now();
      this.save(document);
    }
  },
  assetPath(id) {
    if (!validId(id)) {
      throw new TypeError("Invalid Easel asset identifier");
    }
    return PathUtils.join(root(), "assets", id);
  },
  async putAsset(bytes) {
    if (
      (!ArrayBuffer.isView(bytes) || bytes.BYTES_PER_ELEMENT !== 1) ||
      !bytes.length ||
      bytes.length > 32 * 1024 * 1024
    ) {
      throw new TypeError("Easel images must be smaller than 32 MB");
    }
    const id = this.id();
    await IOUtils.makeDirectory(PathUtils.join(root(), "assets"), {
      ignoreExisting: true,
    });
    await IOUtils.write(this.assetPath(id), bytes, {
      tmpPath: this.assetPath(id) + ".tmp",
    });
    return id;
  },
  async readAsset(id) {
    return IOUtils.read(this.assetPath(id));
  },
};
