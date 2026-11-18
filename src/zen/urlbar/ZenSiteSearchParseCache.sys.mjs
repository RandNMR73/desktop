/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Reuse only successful SearchService parses during one explicit scope.
 * Places eligibility, dates, counts, matching and ranking remain fresh. One
 * active owner bounds memory across windows; admission stops at the budget
 * rather than churning an LRU on every scan of a large history.
 */
export class SiteSearchParseCache {
  #state = null;
  #maxEntries;
  #maxCodeUnits;

  constructor({ maxEntries = 4096, maxCodeUnits = 1048576 } = {}) {
    this.#maxEntries = maxEntries;
    this.#maxCodeUnits = maxCodeUnits;
  }

  clear() {
    if (this.#state) {
      // Old query contexts can retain their tickets. Empty their payload too,
      // so invalidation does not leave one budget-sized map per stale reader.
      this.#state.entries.clear();
      this.#state.engine = null;
      this.#state.charset = null;
      this.#state.codeUnits = 0;
    }
    this.#state = null;
  }

  reset(owner) {
    if (owner && this.#state?.owner.deref() === owner) this.clear();
  }

  get retained() {
    return { entries: this.#state?.entries.size ?? 0,
      codeUnits: this.#state?.codeUnits ?? 0 };
  }

  begin(owner, { scope, container, enabled = true, ownerCurrent = () => true }) {
    if (!enabled || !owner || owner.closed || typeof scope !== "string" ||
        !scope || scope.length > this.#maxCodeUnits ||
        !Number.isSafeInteger(container) || container < 0) {
      this.clear();
      return null;
    }
    let state = this.#state;
    if (state?.owner.deref() !== owner || state.scope !== scope ||
        state.container !== container) {
      this.clear();
      state = { owner: new WeakRef(owner), scope, container, engine: null,
        charset: null, version: 0, entries: new Map(), codeUnits: scope.length };
      this.#state = state;
    }
    return {
      parser: (engine, parse, current) => {
        if (this.#state !== state || !current()) return parse;
        if (!ownerCurrent()) {
          this.clear();
          return parse;
        }
        const charset = engine.queryCharset;
        if (typeof charset !== "string" || scope.length + charset.length > this.#maxCodeUnits) {
          this.clear();
          return parse;
        }
        if (state.engine !== engine || state.charset !== charset) {
          state.entries.clear();
          state.codeUnits = scope.length + charset.length;
          state.engine = engine;
          state.charset = charset;
          state.version++;
        }
        const version = state.version;
        const usable = () => {
          if (this.#state !== state || state.version !== version) return false;
          const owner = state.owner.deref();
          if (!owner || owner.closed || !ownerCurrent()) {
            this.clear();
            return false;
          }
          return engine.queryCharset === charset && current();
        };
        return url => {
          if (!usable()) return parse(url);
          const cached = state.entries.get(url);
          if (cached) return cached;
          const result = parse(url);
          // A parser may synchronously notify an engine change. Never let an
          // old closure refill a cleared/rebound session after that notification.
          if (usable() && result?.engine === engine &&
              typeof result.terms === "string" && result.terms.trim() &&
              typeof result.termsParameterName === "string") {
            const size = url.length + result.terms.length + result.termsParameterName.length;
            if (state.entries.size < this.#maxEntries &&
                state.codeUnits + size <= this.#maxCodeUnits) {
              state.entries.set(url, Object.freeze({ engine, terms: result.terms,
                termsParameterName: result.termsParameterName }));
              state.codeUnits += size;
            }
          }
          return result;
        };
      },
    };
  }
}
