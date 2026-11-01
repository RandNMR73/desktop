/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

let library;
let backend;
let catalog;
let restored = false;

function native() {
  if (backend !== undefined) return backend;
  backend = null;
  if (Services.appinfo.OS !== "Darwin") return null;
  try {
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const executable = Services.dirsvc.get("XREExeF", Ci.nsIFile);
    library = ctypes.open(PathUtils.join(executable.parent.path, "libzen-app-icons.dylib"));
    const declare = (name, result, ...args) => library.declare(name, ctypes.default_abi, result, ...args);
    if (declare("zen_app_icons_version", ctypes.int)() !== 1) return null;
    const apply = declare("zen_app_icon_apply", ctypes.int, ctypes.char.ptr);
    const selected = declare("zen_app_icon_selected", ctypes.int, ctypes.char.ptr, ctypes.uint32_t);
    const restore = declare("zen_app_icon_restore", ctypes.int);
    backend = {
      apply, restore,
      selected() {
        const buffer = ctypes.char.array(65)();
        return selected(buffer, buffer.length) === 0 ? buffer.readString() : null;
      },
    };
  } catch { /* An older build can show the choices without enabling changes. */ }
  return backend;
}

export function validateIconCatalog(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 128) throw new Error("Invalid icon catalog");
  const slugs = new Set();
  return Object.freeze(rows.map(row => {
    if (!row || !/^[a-z0-9-]{1,64}$/.test(row.slug) || slugs.has(row.slug) ||
        typeof row.label !== "string" || !row.label.trim() || row.label.length > 128) {
      throw new Error("Invalid icon catalog entry");
    }
    slugs.add(row.slug);
    return Object.freeze({ slug: row.slug, label: row.label });
  }));
}

export const ZenAppIcons = {
  async list() {
    if (!catalog) {
      catalog = (async () => {
        const executable = Services.dirsvc.get("XREExeF", Ci.nsIFile);
        const directory = PathUtils.join(executable.parent.parent.path, "Resources", "zen-app-icons");
        const rows = validateIconCatalog(await IOUtils.readJSON(PathUtils.join(directory, "catalog.json")));
        return Object.freeze(rows.map(row => Object.freeze({ ...row,
          preview: PathUtils.toFileURI(PathUtils.join(directory, `arc-${row.slug}-preview.png`)),
        })));
      })().catch(error => { catalog = null; throw error; });
    }
    return catalog;
  },

  get available() { return !!native(); },
  get selected() { return native()?.selected() ?? null; },

  async choose(slug) {
    const rows = await this.list();
    if (slug !== "" && !rows.some(row => row.slug === slug)) throw new Error("Unknown app icon");
    const api = native();
    if (!api) throw new Error("App icon selection is unavailable in this build.");
    const result = api.apply(slug);
    if (result !== 0) throw new Error(result === 3
      ? "macOS could not change the app icon. Your previous selection is unchanged."
      : "This app icon could not be loaded. Your previous selection is unchanged.");
    Services.obs.notifyObservers(null, "zen-app-icon-changed", slug);
  },

  restore() {
    if (restored) return;
    restored = true;
    native()?.restore();
  },
};
