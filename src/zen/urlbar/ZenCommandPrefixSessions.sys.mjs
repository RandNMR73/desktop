/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Per-window predecessor state for the URL-history provider. Empty scoped
 * recents are a separate query: they must not overwrite the preceding alias
 * query. Only batches actually published by a current reader are retained.
 * No timer or completed promise can repopulate a cancelled session.
 */
export class CommandPrefixSessions {
  #windows = new WeakMap();

  reset(owner) {
    if (owner) this.#windows.delete(owner);
  }

  clear() {
    this.#windows = new WeakMap();
  }

  begin(owner, context, { text, engine = null, enabled = true }) {
    if (!owner || !enabled) {
      this.reset(owner);
      return { ticket: null, fresh: false };
    }
    let state = this.#windows.get(owner);
    if (!state) {
      state = { engine: null, records: [], running: null, last: null };
      this.#windows.set(owner, state);
    }
    if (state.last?.context === context && state.last.text === text && state.engine === engine)
      return { ticket: state.last.ticket, fresh: false };
    if (state.engine !== engine && state.engine !== null) {
      state.records = [];
      state.running = null;
    }
    state.engine = engine;
    if (!text.trim()) {
      if (!engine) {
        state.records = [];
        state.running = null;
      } else if (state.running?.kind !== "prefix") {
        state.running = null;
      }
      state.last = { context, text, ticket: null };
      return { ticket: null, fresh: false };
    }
    const ticket = {
      kind: engine ? "scope" : "prefix",
      previous: state.records.map(row => ({ ...row })),
      current: () => this.#windows.get(owner) === state && state.running === ticket,
      publish: rows => {
        if (!ticket.current()) return false;
        state.records = rows.map(row => ({ ...row }));
        return true;
      },
    };
    state.running = ticket;
    state.last = { context, text, ticket };
    return { ticket, fresh: true };
  }
}
