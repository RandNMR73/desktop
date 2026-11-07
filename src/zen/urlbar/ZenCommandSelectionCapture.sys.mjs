/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** A Space's container is its Arc-profile boundary, independently of the
 * selected tab's container. Resolve it before result activation changes Space.
 * Missing startup state must not silently fall back to the default profile. */
export function commandSelectionContext(window, { isPrivate, isPrivateWindow } = {}) {
  if (!window || window.closed || isPrivate !== false || isPrivateWindow !== false) return null;
  const manager = window.gZenWorkspaces;
  let container = 0;
  if (manager?.workspaceEnabled && !manager.privateWindowOrDisabled) {
    let space;
    try {
      space = manager.getWorkspaces().find(item => item.uuid === manager.activeWorkspace);
    } catch { return null; }
    if (!space) return null;
    container = Number(space.containerTabId ?? 0);
    if (!Number.isSafeInteger(container) || container < 0) return null;
  }
  return { profileID: container ? `container:${container}` : undefined,
    container, isPrivate: false };
}

/** Capture a query's original scope, then learn only a committed choice.
 * The adapter supplies the reference identity; labels and URLs are never
 * treated as interchangeable IDs here. No state is retained after completion. */
export class CommandSelectionCapture {
  #queries = new WeakMap();
  #history;
  #context;
  #identity;
  #enabled;

  constructor({ history, context, identity, enabled }) {
    this.#history = history;
    this.#context = context;
    this.#identity = identity;
    this.#enabled = enabled;
  }

  begin(queryContext, window) {
    this.#queries.delete(queryContext);
    if (!this.#enabled() || typeof queryContext.searchString !== "string") return;
    const context = this.#context(window, queryContext);
    if (context) this.#queries.set(queryContext, { ...context, query: queryContext.searchString });
  }

  snapshot(queryContext) {
    const snapshot = this.#queries.get(queryContext);
    return snapshot ? { ...snapshot } : null;
  }

  async end(queryContext, details) {
    const snapshot = this.#queries.get(queryContext);
    if (!snapshot || details?.isSessionOngoing) return false;
    this.#queries.delete(queryContext);
    if (!this.#enabled() || !details?.result ||
        ["dismiss", "help"].includes(details.selType)) return false;
    const identity = this.#identity(details.result, snapshot);
    if (!identity) return false;
    return this.#history.record({ query: snapshot.query, identity,
      profileID: snapshot.profileID, isPrivate: snapshot.isPrivate });
  }
}
