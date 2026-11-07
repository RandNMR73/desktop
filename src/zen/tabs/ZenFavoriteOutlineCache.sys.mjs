/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export const FAVORITE_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 64;
const PNG_PREFIX = "data:image/png;base64,";

function immutableArtwork(source) {
  if (/^(?:data:image\/|chrome:\/\/browser\/content\/zen-images\/favicons\/)/.test(source)) return true;
  // Gecko wraps SVG favicons to fix their color scheme and raster dimensions.
  // Keep the whole wrapper in the key: unwrapping would conflate light/dark
  // artwork. Only embedded images qualify, never a wrapped network URL.
  try {
    const uri = new URL(source);
    if (uri.protocol !== "moz-remote-image:" || uri.host || uri.pathname || uri.hash) return false;
    const targets = uri.searchParams.getAll("url");
    return targets.length === 1 && targets[0].startsWith("data:image/");
  } catch { return false; }
}

function validEntry(key, image) {
  if (typeof key !== "string" || key.length > 1402000 ||
      typeof image !== "string" || image.length > 349550 ||
      !image.startsWith(PNG_PREFIX)) return false;
  let source, size, scale, filter;
  try {
    const fields = JSON.parse(key);
    if (!Array.isArray(fields) || fields.length !== 4) return false;
    [source, size, scale, filter] = fields;
  } catch { return false; }
  // A URL alone does not identify a remote favicon's pixels across launches.
  // Persist only embedded artwork and packaged images, whose bundle identity
  // is part of the cache version. No cached source is fetched when restoring.
  if (typeof source !== "string" || source.length > 1400000 ||
      !immutableArtwork(source) ||
      !Number.isFinite(size) || size < 1 || size > 64 ||
      !Number.isFinite(scale) || scale < 1 || scale > 4 ||
      typeof filter !== "string" || filter.length > 1024) return false;
  const data = image.slice(PNG_PREFIX.length);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return false;
  try {
    // Bound decoded dimensions before giving a cache file to the image decoder.
    const header = atob(data.slice(0, 32));
    if (!header.startsWith("\x89PNG\r\n\x1a\n\0\0\0\rIHDR")) return false;
    const dimension = offset => [...header.slice(offset, offset + 4)]
      .reduce((value, byte) => value * 256 + byte.charCodeAt(0), 0);
    const expected = Math.round(47 * scale);
    return dimension(16) === expected && dimension(20) === expected;
  } catch { return false; }
}

/** Bounded, disposable pixel cache. It contains no executable data. */
export class FavoriteOutlineCache {
  #version;
  #entries = new Map();
  #bytes = 0;

  constructor(version) { this.#version = version; }

  entries() { return this.#entries.entries(); }

  set(key, image) {
    if (!validEntry(key, image)) return false;
    const bytes = 2 * (key.length + image.length);
    if (bytes > FAVORITE_CACHE_BYTES) return false;
    if (this.#entries.has(key)) {
      this.#bytes -= 2 * (key.length + this.#entries.get(key).length);
      this.#entries.delete(key);
    }
    while (this.#entries.size &&
        (this.#entries.size >= MAX_ENTRIES || this.#bytes + bytes > FAVORITE_CACHE_BYTES)) {
      const [oldKey, oldImage] = this.#entries.entries().next().value;
      this.#bytes -= 2 * (oldKey.length + oldImage.length);
      this.#entries.delete(oldKey);
    }
    this.#entries.set(key, image);
    this.#bytes += bytes;
    return true;
  }

  restore(bytes) {
    if (bytes.byteLength > FAVORITE_CACHE_BYTES) return;
    try {
      const data = JSON.parse(new TextDecoder().decode(bytes));
      if (data.version !== this.#version || !Array.isArray(data.entries) ||
          data.entries.length > MAX_ENTRIES) return;
      for (const row of data.entries) {
        if (Array.isArray(row) && row.length === 2 && !this.#entries.has(row[0]))
          this.set(row[0], row[1]);
      }
    } catch { /* A missing or damaged cache never prevents startup. */ }
  }

  serialize() {
    let entries = [...this.#entries];
    for (;;) {
      const bytes = new TextEncoder().encode(JSON.stringify({ version: this.#version, entries }));
      if (bytes.length <= FAVORITE_CACHE_BYTES) return bytes;
      entries.shift();
    }
  }
}
