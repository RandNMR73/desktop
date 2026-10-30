// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/** Deduplicate cached-Places reads while the command bar is open. */
export class SavedSitePresentation {
  #entries = new Map();
  #icon;
  #title;
  #limit;

  constructor({ icon, title, limit = 128 }) {
    this.#icon = icon;
    this.#title = title;
    this.#limit = limit;
  }

  clear() {
    this.#entries.clear();
  }

  async get(url, needsTitle = false) {
    let uri;
    try {
      uri = new URL(url);
      if (!/^https?:$/.test(uri.protocol) || uri.username || uri.password) {
        return null;
      }
    } catch {
      return null;
    }
    let entry = this.#entries.get(url);
    if (!entry) {
      if (this.#entries.size >= this.#limit) {
        this.#entries.delete(this.#entries.keys().next().value);
      }
      entry = {
        icon: Promise.resolve().then(() => this.#icon(url)).catch(() => null),
      };
      this.#entries.set(url, entry);
    }
    if (needsTitle && !entry.title) {
      entry.title = Promise.resolve().then(() => this.#title(url)).catch(() => null);
    }
    const [icon, title] = await Promise.all([entry.icon, needsTitle ? entry.title : null]);
    // Only cached image data is rendered. A result must not trigger a remote
    // favicon request or allow a non-image URL into a style declaration.
    return {
      icon: typeof icon === "string" && /^data:image\/[\w.+-]+[;,]/i.test(icon) ? icon : null,
      title: typeof title === "string" && title.trim() ? title : null,
    };
  }
}
