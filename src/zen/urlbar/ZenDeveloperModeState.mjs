// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/** Settings are scoped to an HTTP origin and container, never a page path. */
export function developerSite(spec, userContextId = 0) {
  try {
    const url = new URL(spec);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    return {
      key: JSON.stringify([Number(userContextId) || 0, url.origin]),
      automatic:
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host === "127.0.0.1" ||
        host === "[::1]",
    };
  } catch {
    return null;
  }
}

/** The private overlay is shared between private windows, but never serialized. */
export class DeveloperModeSettings {
  #regular = new Map();
  #private = new Map();
  #write;

  constructor(read, write) {
    this.#write = write;
    this.reload(read());
  }

  reload(raw) {
    let values;
    try {
      values = JSON.parse(raw);
    } catch {}
    this.#regular = new Map(
      Array.isArray(values)
        ? values.filter((entry) => {
            if (
              !Array.isArray(entry) ||
              entry.length !== 2 ||
              typeof entry[1] !== "boolean"
            )
              return false;
            try {
              const [container, origin] = JSON.parse(entry[0]);
              return developerSite(origin, container)?.key === entry[0];
            } catch {
              return false;
            }
          })
        : [],
    );
  }

  enabled(site, isPrivate = false) {
    if (!site) return false;
    if (isPrivate && this.#private.has(site.key))
      return this.#private.get(site.key);
    return this.#regular.get(site.key) ?? site.automatic;
  }

  set(site, enabled, isPrivate = false) {
    if (!site || typeof enabled !== "boolean") return;
    if (isPrivate) {
      this.#private.set(site.key, enabled);
    } else {
      const previous = this.#regular;
      this.#regular = new Map(previous).set(site.key, enabled);
      try {
        this.#write(JSON.stringify([...this.#regular]));
      } catch (error) {
        this.#regular = previous;
        throw error;
      }
    }
  }

  clearPrivate() {
    this.#private.clear();
  }
}

/** New submissions, navigation, tab closure and teardown invalidate old work. */
export class DeveloperNavigation {
  #pending = new Map();

  async run(browser, isAlive, resolve, commit) {
    const ticket = {};
    const location = browser.lastLocationChange;
    const uri = browser.currentURI.spec;
    this.#pending.set(browser, ticket);
    try {
      const result = await resolve();
      if (
        this.#pending.get(browser) !== ticket ||
        !isAlive() ||
        browser.lastLocationChange !== location ||
        browser.currentURI.spec !== uri
      )
        return false;
      return (await commit(result)) !== false;
    } finally {
      if (this.#pending.get(browser) === ticket) this.#pending.delete(browser);
    }
  }

  cancel(browser) {
    this.#pending.delete(browser);
  }
  clear() {
    this.#pending.clear();
  }
}
