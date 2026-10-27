/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Picker coordinates do not enter Zen's gradient renderer. Ignore only those
// coordinates, retaining every color, algorithm, opacity, and texture value.
export function themeKey(theme) {
  const normalized = structuredClone(theme);
  for (const color of normalized?.gradientColors ?? []) {
    delete color.position;
  }
  const canonical = value => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    }
    return value;
  };
  return JSON.stringify(canonical(normalized));
}

// Isolated lifecycle policy: no native imports or timers. The GPU completion
// must match the current request before CSS can yield to the native surface.
export class NativeThemeState {
  constructor(backend, handle, show, isCurrent) {
    this.backend = backend;
    this.handle = handle;
    this.show = show;
    this.isCurrent = isCurrent;
    this.ticket = 0;
    this.key = null;
    this.closed = false;
    this.visible = false;
  }

  apply(key, index, force = false) {
    if (this.closed || (!force && key === this.key)) return;
    if (key === null) { this.clear(); return; }
    // Retain the last completed frame while a supported Space renders. Hiding
    // it for even one turn exposes the native material as a white flash.
    // A host replacement still starts hidden; unsupported themes and failures
    // explicitly clear the surface and restore the CSS fallback.
    if (force || !this.visible) {
      this.visible = false;
      this.show(false);
    }
    this.key = key;
    // A nonzero uint32 ticket; stale completions cannot activate a new Space.
    this.ticket = (this.ticket + 1) >>> 0 || 1;
    try {
      if (this.backend.apply(this.handle, index, this.ticket) !== 0) this.clear();
    } catch {
      this.clear();
    }
  }

  complete(ticket, status) {
    if (this.closed || this.key === null || ticket !== this.ticket) return;
    try {
      if (status !== 0 || !this.isCurrent(this.key) ||
          this.backend.activate(this.handle, ticket) !== 0) {
        this.clear();
        return;
      }
      this.show(true);
      this.visible = true;
    } catch {
      this.clear();
    }
  }

  clear() {
    this.show(false);
    this.visible = false;
    this.key = null;
    try { this.backend.clear(this.handle); } catch { /* CSS remains available. */ }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.clear();
  }
}
