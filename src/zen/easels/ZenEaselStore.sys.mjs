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
export const EASEL_DELETED = "zen-easel-deleted";
const root = () => PathUtils.join(PathUtils.profileDir, "zen-easels");
const validId = (id) => typeof id === "string" && /^[\w-]{1,100}$/.test(id);

// A single store per profile, shared by browser windows. JSONFile coalesces
// writes, uses atomic replacement, and flushes on profile-before-change.
export const ZenEaselStore = {
  _file: null,
  _loading: null,
  _deleted: new Set(),
  _deletions: new Map(),
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
      const deletedRoot = PathUtils.join(root(), "deleted");
      let pruned = false;
      if (await IOUtils.exists(deletedRoot)) {
        for (const path of await IOUtils.getChildren(deletedRoot)) {
          const id = PathUtils.filename(path);
          if (validId(id)) {
            this._deleted.add(id);
            pruned ||= Object.hasOwn(this._file.data.documents, id);
            delete this._file.data.documents[id];
          }
        }
      }
      if (pruned) {
        this._file.saveSoon();
      }
      // Finish asset cleanup interrupted after a durable deletion marker.
      // Imports await ready(), so new in-flight assets cannot race this scan.
      const assets = PathUtils.join(root(), "assets");
      if (await IOUtils.exists(assets)) {
        await this._removeUnreferencedAssets(
          (await IOUtils.getChildren(assets))
            .map((path) => PathUtils.filename(path))
            .filter(validId),
        );
      }
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
    const document = Object.hasOwn(this._file.data.documents, id)
      ? this._file.data.documents[id]
      : null;
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
    // A late editor/image callback cannot recreate a permanently deleted board.
    if (this._deleted.has(clean.id)) {
      return null;
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
  async delete(id) {
    if (!validId(id)) {
      throw new TypeError("Invalid Easel identifier");
    }
    if (this._deletions.has(id)) {
      return this._deletions.get(id);
    }
    const operation = this._delete(id);
    this._deletions.set(id, operation);
    try {
      return await operation;
    } finally {
      this._deletions.delete(id);
    }
  },
  async _delete(id) {
    const document = await this.get(id);
    if (!document) {
      return false;
    }
    // Persist the deletion before releasing any image bytes. A crash before
    // JSONFile's coalesced save cannot bring the board back on the next launch.
    const directory = PathUtils.join(root(), "deleted");
    await IOUtils.makeDirectory(directory, { ignoreExisting: true });
    const marker = PathUtils.join(directory, id);
    await IOUtils.writeUTF8(marker, "", { tmpPath: marker + ".tmp" });
    this._deleted.add(id);
    delete this._file.data.documents[id];
    this._file.saveSoon();
    Services.obs.notifyObservers(null, EASEL_DELETED, id);
    Services.obs.notifyObservers(null, EASEL_CHANGED, id);
    await this._removeUnreferencedAssets(
      document.items.map((item) => item.assetId),
    );
    return true;
  },
  async _removeUnreferencedAssets(candidates) {
    const referenced = new Set(
      Object.values(this._file.data.documents).flatMap((doc) =>
        doc.items.map((item) => item.assetId).filter(Boolean),
      ),
    );
    for (const asset of new Set(candidates)) {
      if (asset && !referenced.has(asset)) {
        await IOUtils.remove(this.assetPath(asset), { ignoreAbsent: true });
      }
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
      !ArrayBuffer.isView(bytes) ||
      bytes.BYTES_PER_ELEMENT !== 1 ||
      !bytes.length ||
      bytes.length > 32 * 1024 * 1024
    ) {
      throw new TypeError("Easel images must be smaller than 32 MB");
    }
    await this.ready();
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
    await this.ready();
    return IOUtils.read(this.assetPath(id));
  },
};
