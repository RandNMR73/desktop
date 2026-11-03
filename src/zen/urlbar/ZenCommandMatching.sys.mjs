/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

let library;
let backend;

function native() {
  if (backend !== undefined) return backend;
  backend = null;
  if (Services.appinfo.OS !== "Darwin") return null;
  try {
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const executable = Services.dirsvc.get("XREExeF", Ci.nsIFile);
    library = ctypes.open(PathUtils.join(executable.parent.path, "libzen-native-theme.dylib"));
    const declare = (name, result, ...args) => library.declare(name, ctypes.default_abi, result, ...args);
    if (declare("zen_command_matching_version", ctypes.int32_t)() !== 1) return null;
    const match = declare("zen_command_match_features", ctypes.char.ptr, ctypes.uint8_t.ptr, ctypes.uint32_t);
    const release = declare("zen_command_matching_free", ctypes.void_t, ctypes.char.ptr);
    backend = request => {
      const bytes = new TextEncoder().encode(JSON.stringify(request));
      if (bytes.length > 4_194_304) return null;
      const input = ctypes.uint8_t.array(bytes.length)(bytes);
      const result = match(input, bytes.length);
      if (result.isNull()) return null;
      try {
        return JSON.parse(result.readString());
      } finally {
        release(result);
      }
    };
  } catch { /* Older libraries cannot supply the reference's text features. */ }
  return backend;
}

/** Batch numeric text features in provider order, or null if unavailable.
 * No candidate identity, browser state, or activation is passed to native code.
 * Ranking integration remains disabled; see tools/command-ranking/README.md. */
export function matchCommandCandidates(query, candidates) {
  const api = native();
  if (!api) return null;
  try {
    const results = api({ query, candidates: candidates.map(({ url, title, hotWords }) => ({ url, title, hotWords })) });
    return Array.isArray(results) && results.length === candidates.length ? results : null;
  } catch {
    return null;
  }
}
