// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/** The compact text of a selected history URL and its complete destination. */
export class HistoryURLPresentation {
  #state = null;

  clear() {
    this.#state = null;
  }

  prepare(value, query) {
    if (!query || /[\s\\\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value)) {
      return null;
    }
    const match = /^((https?:\/\/)(?:www\.)?)([^/?#]+)(.*)$/i.exec(value);
    if (!match) return null;
    try {
      const uri = new URL(value);
      if (uri.username || uri.password || !uri.hostname) return null;
    } catch {
      return null;
    }
    const [, prefix, , authority, tail] = match;
    const display = authority + (tail === "/" ? "" : tail);
    return {
      prefix,
      authority,
      display,
      full: value,
      selectionStart: display.toLowerCase().startsWith(query.toLowerCase())
        ? query.length
        : display.length,
    };
  }

  preserve(query) {
    return query === this.#state?.display ? { ...this.#state } : null;
  }

  commit(state, copyAllowed = true) {
    this.#state = { ...state, copyAllowed };
  }

  beforeEdit(value, start) {
    // Replacing/editing the host starts a new address, even if the resulting
    // text happens to use the same host. Path/query edits retain its prefix.
    if (value !== this.#state?.display || start < this.#state.authority.length) {
      this.clear();
    }
  }

  edit(value) {
    const state = this.#state;
    if (!state) return null;
    if (value === state.display) return state.full;
    const authority = /^[^/?#]+/.exec(value)?.[0];
    if (authority !== state.authority || /[\s\\\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value)) {
      this.clear();
      return null;
    }
    state.display = value;
    state.copyAllowed = true;
    state.full = state.prefix + value + (value === authority ? "/" : "");
    return state.full;
  }

  destination(value, candidate) {
    const state = this.#state;
    if (!state || value !== state.display) return null;
    // A stale or different suggestion must never inherit this URL's prefix.
    // Match the fallback's complete visible destination, not just its host.
    try {
      const expected = new URL("http://" + value);
      const actual = new URL(candidate);
      if (!/^https?:$/.test(actual.protocol) || actual.username || actual.password ||
          ["host", "pathname", "search", "hash"].some(key => actual[key] !== expected[key])) {
        return null;
      }
    } catch {
      return null;
    }
    return state.full;
  }

  clipboard(value, start, end) {
    const state = this.#state;
    if (!state?.copyAllowed || value !== state.display || start !== 0 || end < state.authority.length) {
      return null;
    }
    return end === value.length ? state.full : state.prefix + value.slice(0, end);
  }
}
