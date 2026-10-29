/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { NativeThemeState, themeKey } from "resource:///modules/zen/ZenNativeThemeState.mjs";

const owners = new WeakMap();
const windows = new Set();
let loading;
let stopped = false;
// Keep the library rooted for the process lifetime. dlclose is
// unsafe after registering Objective-C classes, even after removing all views.
let library, backend;

async function load() {
  if (Services.appinfo.OS !== "Darwin") return null;
  const executable = Services.dirsvc.get("XREExeF", Ci.nsIFile);
  const directory = PathUtils.join(executable.parent.parent.path, "Resources", "zen-native-theme");
  const file = PathUtils.join(directory, "themes.json");
  if ((await IOUtils.stat(file)).size > 262144) return null;
  const model = await IOUtils.readJSON(file);
  if (stopped || model.version !== 1 || !["dark", "light"].includes(model.appearance) ||
      !Array.isArray(model.themes) || !model.themes.length || model.themes.length > 64) return null;
  const themes = new Map();
  for (const [index, item] of model.themes.entries()) {
    if (typeof item.id !== "string" || themes.has(item.id) || !item.theme ||
        typeof item.theme !== "object") return null;
    themes.set(item.id, { index, key: themeKey(item.theme) });
  }
  const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
  library = ctypes.open(PathUtils.join(executable.parent.path, "libzen-native-theme.dylib"));
  const declare = (name, result, ...args) => library.declare(name, ctypes.default_abi, result, ...args);
  if (declare("zen_theme_version", ctypes.int)() !== 1) return null;
  const apply = declare("zen_theme_apply", ctypes.int, ctypes.uint64_t, ctypes.int, ctypes.uint32_t);
  const activate = declare("zen_theme_activate", ctypes.int, ctypes.uint64_t, ctypes.uint32_t);
  const clear = declare("zen_theme_clear", ctypes.int, ctypes.uint64_t);
  const shutdown = declare("zen_theme_shutdown", ctypes.void_t);
  const status = declare("zen_theme_status", ctypes.int, ctypes.uint64_t, ctypes.uint32_t);
  let showToast, clearToast, syncPopover;
  try {
    showToast = declare("zen_toast_show", ctypes.int, ctypes.uint64_t, ctypes.int, ctypes.char.ptr);
    clearToast = declare("zen_toast_clear", ctypes.int, ctypes.uint64_t);
  } catch { /* Older native bundles retain the DOM toast. */ }
  try {
    syncPopover = declare("zen_popover_sync_appearance", ctypes.int,
      ctypes.uint64_t, ctypes.double, ctypes.double, ctypes.double, ctypes.double);
  } catch { /* Rebuilt engines synchronize their native popovers directly. */ }
  backend = {
    themes, appearance: model.appearance,
    apply: (handle, index, ticket) => apply(ctypes.UInt64(handle), index, ticket),
    activate: (handle, ticket) => activate(ctypes.UInt64(handle), ticket),
    clear: handle => clear(ctypes.UInt64(handle)),
    status: (handle, ticket) => status(ctypes.UInt64(handle), ticket), shutdown,
    showToast: showToast && ((handle, index, request) => showToast(ctypes.UInt64(handle), index, JSON.stringify(request))),
    clearToast: clearToast && (handle => clearToast(ctypes.UInt64(handle))),
    syncPopover: syncPopover && ((handle, rect) => syncPopover(
      ctypes.UInt64(handle), rect.x, rect.y, rect.width, rect.height)),
  };
  return backend;
}

Services.obs.addObserver(() => {
  stopped = true;
  for (const reference of windows) reference.deref()?.close();
  windows.clear();
  backend?.shutdown();
}, "xpcom-will-shutdown");

class WindowTheme {
  constructor(window) {
    this.window = window;
    this.closed = false;
    this.reference = new WeakRef(this);
    windows.add(this.reference);
    this.frame = 0;
    this.queries = ["(prefers-color-scheme: dark)", "(prefers-reduced-transparency: reduce)",
      "(prefers-contrast: more)", "(forced-colors: active)"].map(q => window.matchMedia(q));
    this.change = () => this.refresh();
    this.rehost = () => this.refresh(true);
    // A drawable can be unavailable while the app starts in the background.
    // Retry on a real window interaction after that bounded attempt expires.
    this.health = () => this.state?.key ? this.checkFrame() : this.refresh();
    this.attributes = new window.MutationObserver(this.change);
    this.attributes.observe(window.document.documentElement, { attributes: true,
      attributeFilter: ["zen-single-toolbar", "zen-unsynced-window", "privatebrowsingmode", "taskbartab"] });
    for (const query of this.queries) query.addEventListener("change", this.change);
    for (const event of ["ZenWorkspaceDataChanged", "ZenWorkspacesUIUpdate", "ZenNativeThemeChanged"])
      window.addEventListener(event, this.change);
    for (const event of ["sizemodechange", "fullscreen"])
      window.addEventListener(event, this.rehost);
    for (const event of ["resize", "activate", "visibilitychange", "pointerdown"])
      window.addEventListener(event, this.health, { capture: true });
    window.addEventListener("unload", () => this.close(), { once: true });
  }

  selection() {
    const window = this.window;
    const manager = window.gZenWorkspaces;
    if (this.closed || stopped || !this.native || !manager ||
        manager.isPrivateWindow || manager.privateWindowOrDisabled ||
        window.document.documentElement.hasAttribute("zen-single-toolbar") === false ||
        this.queries.slice(1).some(query => query.matches) ||
        (this.queries[0].matches ? "dark" : "light") !== this.native.appearance) return null;
    const workspace = manager.getActiveWorkspace();
    const record = this.native.themes.get(workspace?.uuid);
    if (!record || themeKey(workspace.theme) !== record.key) return null;
    return { ...record, key: workspace.uuid + ":" + record.key };
  }

  async refresh(force = false) {
    if (this.closed || stopped) return;
    try {
      this.native = await (loading ??= load().catch(() => null));
      if (!this.native || this.closed || stopped) return;
      if (!this.state || force) {
        const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
        const handle = ctypes.UInt64(this.window.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).nativeHandle).toString();
        if (this.state && handle !== this.handle) {
          this.state.close();
          this.state = null;
        }
        this.handle = handle;
      }
      if (!this.state) {
        this.state = new NativeThemeState(this.native, this.handle,
          visible => this.window.document.documentElement.toggleAttribute("zen-native-theme", visible),
          key => this.selection()?.key === key);
      }
      const selected = this.selection();
      if (force || this.toastKey !== selected?.key) {
        this.native.clearToast?.(this.handle);
        this.toastKey = selected?.key;
      }
      const previous = this.state.ticket;
      // sizemodechange also fires when minimizing/restoring the same window.
      // A pending or completed surface still attached to its current host can
      // keep its last frame. Only an invalid host needs the CSS handoff again.
      let replaceHost = force;
      if (force && this.state.key) {
        replaceHost = this.native.status(this.handle, previous) < 0;
      }
      this.state.apply(selected?.key ?? null, selected?.index, replaceHost);
      if (force || this.state.ticket !== previous) this.checkFrame();
    } catch {
      this.state?.clear();
    }
  }

  checkFrame() {
    if (this.closed || stopped || !this.state?.key) return;
    this.window.cancelAnimationFrame(this.frame);
    const ticket = this.state.ticket;
    const deadline = this.window.performance.now() + 2000;
    const check = () => {
      this.frame = 0;
      if (this.closed || stopped || !this.state?.key || this.state.ticket !== ticket) return;
      let status = -1;
      try { status = this.native.status(this.handle, ticket); } catch { /* CSS fallback. */ }
      if (status !== 0 || this.window.performance.now() >= deadline) {
        this.state.complete(ticket, status === 1 ? 0 : -1);
      } else {
        this.frame = this.window.requestAnimationFrame(check);
      }
    };
    this.frame = this.window.requestAnimationFrame(check);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.state?.close();
    this.attributes.disconnect();
    this.window.cancelAnimationFrame(this.frame);
    windows.delete(this.reference);
    for (const event of ["resize", "activate", "visibilitychange", "pointerdown"])
      this.window.removeEventListener(event, this.health, { capture: true });
    for (const query of this.queries) query.removeEventListener("change", this.change);
    for (const event of ["ZenWorkspaceDataChanged", "ZenWorkspacesUIUpdate", "ZenNativeThemeChanged"])
      this.window.removeEventListener(event, this.change);
    for (const event of ["sizemodechange", "fullscreen"])
      this.window.removeEventListener(event, this.rehost);
  }
}

export function updateNativeTheme(window) {
  if (stopped || Services.appinfo.OS !== "Darwin") return;
  let owner = owners.get(window);
  if (!owner) {
    owner = new WindowTheme(window);
    owners.set(window, owner);
  }
  owner.refresh();
}

export async function syncNativePopupAppearance(window, panel) {
  if (stopped || Services.appinfo.OS !== "Darwin") return false;
  try {
    const native = await (loading ??= load().catch(() => null));
    const current = () => !stopped && !window.closed &&
      panel.ownerDocument?.defaultView === window && panel.isConnected && panel.state === "open";
    if (!native?.syncPopover || !current()) return false;
    const sync = () => native.syncPopover(
      window.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).nativeHandle,
      panel.getOuterScreenRect());
    const result = sync();
    if (result !== 4) return result === 0;
    // AppKit can finish positioning after popupshown. Retry that no-match once
    // with fresh screen bounds; never weaken the owner/rectangle native guard.
    await new Promise(resolve => window.requestAnimationFrame(resolve));
    return current() && sync() === 0;
  } catch { return false; }
}

// This is a synchronous native call after bounded module/resource loading.
// AppKit owns tracking, timers and the sharing picker; no native callback can
// enter a collected JS closure, and there is no background polling loop.
export async function showNativeCopyToast(window, request, isCurrent = () => true) {
  if (stopped || Services.appinfo.OS !== "Darwin") return false;
  updateNativeTheme(window);
  const owner = owners.get(window);
  await owner.refresh();
  if (!isCurrent()) return true;
  const selected = owner.selection();
  if (!selected || !owner.native?.showToast || owner.closed || stopped) {
    owner.native?.clearToast?.(owner.handle);
    return false;
  }
  try {
    if (owner.native.showToast(owner.handle, selected.index, request) === 0) return true;
  } catch { /* A failed replacement must not leave the previous Share target. */ }
  owner.native.clearToast?.(owner.handle);
  return false;
}
