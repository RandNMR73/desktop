/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export const FAVORITE_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 64;
const PNG_PREFIX = "data:image/png;base64,";

/** Ignore only process routing in the embedded SVG wrapper Tabbrowser creates. */
export function favoriteOutlineCacheSource(source) {
  if (typeof source !== "string" || source.length > 1400000 ||
      !source.startsWith("moz-remote-image://?") || !source.includes("contentParentId=") ||
      /[\u0000-\u0020\u007f]/.test(source)) return source;
  try {
    const uri = new URL(source);
    if (uri.host || uri.pathname || uri.hash) return source;
    const parts = source.slice("moz-remote-image://?".length).split("&");
    const names = new Set();
    const allowed = ["url", "colorScheme", "width", "height", "stretch", "contentParentId"];
    for (const part of parts) {
      const name = part.slice(0, part.indexOf("="));
      if (!allowed.includes(name) || names.has(name)) return source;
      names.add(name);
    }
    if (names.size !== allowed.length) return source;
    const value = name => uri.searchParams.get(name);
    if (!/^data:image\/svg\+xml;base64,(?:[A-Za-z0-9+/]{4})+(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value("url")) ||
        !["light", "dark"].includes(value("colorScheme")) ||
        !["true", "false"].includes(value("stretch")) ||
        !/^(?:0|[1-9][0-9]*)$/.test(value("contentParentId")) ||
        !Number.isSafeInteger(Number(value("contentParentId")))) return source;
    for (const dimension of [value("width"), value("height")]) {
      if (!/^[1-9][0-9]*$/.test(dimension) || Number(dimension) > 512) return source;
    }
    // Preserve every other parameter byte-for-byte, including the embedded
    // artwork, color scheme and raster dimensions. Never change the load URI.
    return "moz-remote-image://?" + parts.filter(part => !part.startsWith("contentParentId=")).join("&");
  } catch { return source; }
}

function immutableArtwork(source) {
  if (/^(?:data:image\/|chrome:\/\/browser\/content\/zen-images\/favicons\/)/.test(source)) return true;
  // Gecko wraps SVG favicons to fix their color scheme and raster dimensions.
  // Keep the rendering wrapper: unwrapping would conflate light/dark artwork.
  // Only embedded images qualify, never a wrapped network URL.
  try {
    const uri = new URL(source);
    if (uri.protocol !== "moz-remote-image:" || uri.host || uri.pathname || uri.hash) return false;
    const targets = uri.searchParams.getAll("url");
    return targets.length === 1 && targets[0].startsWith("data:image/");
  } catch { return false; }
}

function validatedKey(key, image) {
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
    if (dimension(16) !== expected || dimension(20) !== expected) return false;
    return JSON.stringify([favoriteOutlineCacheSource(source), size, scale, filter]);
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
    const normalized = validatedKey(key, image);
    return normalized ? this.#insert(normalized, image) : false;
  }

  #insert(key, image) {
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
        if (!Array.isArray(row) || row.length !== 2) continue;
        const key = validatedKey(row[0], row[1]);
        if (key && !this.#entries.has(key)) this.#insert(key, row[1]);
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
