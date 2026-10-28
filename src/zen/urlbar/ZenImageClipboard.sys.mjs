// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Keep the bundle-local library rooted: it also registers Objective-C classes
// for other optional browser features, and must not be dlclosed mid-process.
let library;
function loadNative() {
  if (Services.appinfo.OS !== "Darwin") return null;
  try {
    const { ctypes } = ChromeUtils.importESModule(
      "resource://gre/modules/ctypes.sys.mjs",
    );
    const executable = Services.dirsvc.get("XREExeF", Ci.nsIFile);
    library = ctypes.open(
      PathUtils.join(executable.parent.path, "libzen-native-theme.dylib"),
    );
    const version = library.declare(
      "zen_clipboard_version",
      ctypes.default_abi,
      ctypes.int,
    );
    if (version() !== 1) return null;
    const write = library.declare(
      "zen_clipboard_copy_png",
      ctypes.default_abi,
      ctypes.int,
      ctypes.uint8_t.ptr,
      ctypes.size_t,
    );
    return (buffer) => {
      // js-ctypes permits an ArrayBuffer as a synchronous pointer argument.
      // Native code copies it; no callback may re-enter JS during the call.
      const result = write(buffer, buffer.byteLength);
      if (result !== 0)
        throw new Error(`Native PNG clipboard failed (${result})`);
    };
  } catch {
    // An older optional bundle has no clipboard ABI. Keep Gecko's path intact.
    return null;
  }
}

export function makePNGClipboardWriter(load, fallback) {
  let loading;
  return async (buffer, isCurrent = () => true) => {
    if (!isCurrent()) return false;
    const native = await (loading ||= Promise.resolve()
      .then(load)
      .catch(() => null));
    if (!isCurrent()) return false;
    // Failure after selecting a backend must propagate rather than silently
    // performing a second clipboard write after a partially successful first.
    (native || fallback)(buffer);
    return true;
  };
}

export const copyPNGToClipboard = makePNGClipboardWriter(
  loadNative,
  (buffer) => {
    const { BrowserUtils } = ChromeUtils.importESModule(
      "resource://gre/modules/BrowserUtils.sys.mjs",
    );
    BrowserUtils.copyImageToClipboard(buffer);
  },
);
