/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { NativeThemeState, themeKey, dynamicThemeRequest } from "resource:///modules/zen/ZenNativeThemeState.mjs";

const owners = new WeakMap();
const windows = new Set();
let loading;
let stopped = false;
// Keep the library rooted for the process lifetime. dlclose is
// unsafe after registering Objective-C classes, even after removing all views.
let library, backend;
const scopeMetrics = new Map();
const selectionColors = new Map();

// The registered <color> custom property supplies canonical computed colors,
// including resolved calc() channels. Unsupported spaces keep the CSS paint.
function parseNativeCommandColor(value) {
  const text = value.trim().toLowerCase();
  const color = /^color\((srgb|display-p3)\s+([^()]*)\)$/.exec(text);
  const rgb = /^rgba?\(([^()]*)\)$/.exec(text);
  if (!color && !rgb) return null;
  const pieces = (color ? color[2] : rgb[1]).replaceAll(",", " ").replaceAll("/", " ").trim().split(/\s+/);
  if (pieces.length < 3 || pieces.length > 4) return null;
  const rgba = pieces.map((part, i) => {
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%?$/.test(part)) return NaN;
    const percent = part.endsWith("%");
    return parseFloat(part) / (percent ? 100 : rgb && i < 3 ? 255 : 1);
  });
  if (rgba.length === 3) rgba.push(1);
  if (rgba.some(channel => !Number.isFinite(channel) || channel < 0 || channel > 1)) return null;
  return { space: color ? color[1] : "srgb", rgba };
}

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
  const ids = new Set();
  let little;
  for (const [index, item] of model.themes.entries()) {
    if (typeof item.id !== "string" || ids.has(item.id) || !item.theme ||
        typeof item.theme !== "object") return null;
    ids.add(item.id);
    if (item.role !== undefined) {
      if (item.role !== "little" || little || item.id !== "little-default-v1" ||
          item.material !== model.appearance) return null;
      little = { index, key: item.id + ":" + model.appearance };
      continue;
    }
    themes.set(item.id, { index, key: themeKey(item.theme), spaceIconPalette: item.spaceIconPalette,
      colorPad: item.colorPad });
  }
  const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
  library = ctypes.open(PathUtils.join(executable.parent.path, "libzen-native-theme.dylib"));
  const declare = (name, result, ...args) => library.declare(name, ctypes.default_abi, result, ...args);
  if (declare("zen_theme_version", ctypes.int)() !== 1) return null;
  // A legacy library can read the field but cannot select its dark material.
  // Keep Little on CSS unless the matching native capability is present.
  try {
    if (declare("zen_theme_material_version", ctypes.int)() !== 1) little = undefined;
  } catch { little = undefined; }
  const apply = declare("zen_theme_apply", ctypes.int, ctypes.uint64_t, ctypes.int, ctypes.uint32_t);
  let applyColors;
  try {
    if (declare("zen_theme_dynamic_version", ctypes.int)() === 1) {
      applyColors = declare("zen_theme_apply_colors", ctypes.int,
        ctypes.uint64_t, ctypes.uint32_t, ctypes.char.ptr);
    }
  } catch { /* Older libraries keep the CSS fallback for edited themes. */ }
  const activate = declare("zen_theme_activate", ctypes.int, ctypes.uint64_t, ctypes.uint32_t);
  const clear = declare("zen_theme_clear", ctypes.int, ctypes.uint64_t);
  const shutdown = declare("zen_theme_shutdown", ctypes.void_t);
  const status = declare("zen_theme_status", ctypes.int, ctypes.uint64_t, ctypes.uint32_t);
  let showToast, clearToast, syncPopover, stopPopover, syncLittleShadow;
  let littlePanel = false, syncLittleFills;
  let measureScope, selectionPalette;
  try {
    if (declare("zen_command_selection_palette_version", ctypes.int)() === 1) {
      const palette = declare("zen_command_selection_palette", ctypes.int,
        ctypes.char.ptr, ctypes.double.ptr, ctypes.uint32_t);
      selectionPalette = color => {
        const values = ctypes.double.array(8)();
        return palette(JSON.stringify(color), values, 8) === 0 ?
          Array.from({ length: 8 }, (_, i) => values[i]) : null;
      };
    }
  } catch { /* Older native libraries retain the window selection palette. */ }
  try {
    if (declare("zen_command_scope_metrics_version", ctypes.int)() === 1) {
      const measure = declare("zen_command_scope_metrics", ctypes.int,
        ctypes.char.ptr, ctypes.double, ctypes.double.ptr, ctypes.uint32_t);
      measureScope = (text, scale) => {
        const values = ctypes.double.array(3)();
        return measure(text, scale, values, 3) === 0 ?
          { width: values[0], height: values[1], weight: values[2] } : null;
      };
    }
  } catch { /* Older native libraries keep intrinsic CSS label sizing. */ }
  try {
    syncLittleShadow = declare("zen_little_shadow_sync", ctypes.int, ctypes.uint64_t,
      ctypes.uint32_t, ...Array(7).fill(ctypes.double));
  } catch { /* Older native bundles retain their current Little surface. */ }
  try {
    littlePanel = !!syncLittleShadow && declare("zen_little_panel_version", ctypes.int)() === 1;
  } catch { /* Keep the opaque panel on older native libraries. */ }
  try {
    if (littlePanel && declare("zen_little_fills_version", ctypes.int)() === 1) {
      syncLittleFills = declare("zen_little_fills_sync", ctypes.int, ctypes.uint64_t,
        ctypes.uint32_t, ctypes.char.ptr);
    }
  } catch { /* Older libraries keep CSS command fills. */ }
  try {
    showToast = declare("zen_toast_show", ctypes.int, ctypes.uint64_t, ctypes.int, ctypes.char.ptr);
    clearToast = declare("zen_toast_clear", ctypes.int, ctypes.uint64_t);
  } catch { /* Older native bundles retain the DOM toast. */ }
  try {
    syncPopover = declare("zen_popover_sync_appearance", ctypes.int,
      ctypes.uint64_t, ctypes.double, ctypes.double, ctypes.double, ctypes.double);
  } catch { /* Rebuilt engines synchronize their native popovers directly. */ }
  try {
    const observePopover = declare("zen_popover_observe_appearance", ctypes.int);
    stopPopover = declare("zen_popover_shutdown", ctypes.void_t);
    if (observePopover() !== 0) stopPopover = undefined;
  } catch { /* Older bundles retain the guarded post-opening fallback. */ }
  let commandMediumWeight;
  try {
    // The same native medium face is used at 13pt and 18pt. Resolve its
    // OpenType weight once per process, outside the typing/layout path.
    const weight = measureScope?.("M", 1)?.weight;
    if (Number.isFinite(weight) && weight >= 1 && weight <= 1000) commandMediumWeight = weight;
  } catch { /* Legacy bundles retain the CSS medium fallback. */ }
  backend = {
    measureScope, commandMediumWeight, selectionPalette,
    themes, little, littlePanel: littlePanel && model.appearance === "dark", appearance: model.appearance,
    dynamic: !!applyColors,
    apply: (handle, index, ticket) => typeof index === "object"
      ? (applyColors ? applyColors(ctypes.UInt64(handle), ticket, JSON.stringify(index)) : 1)
      : apply(ctypes.UInt64(handle), index, ticket),
    activate: (handle, ticket) => activate(ctypes.UInt64(handle), ticket),
    clear: handle => clear(ctypes.UInt64(handle)),
    status: (handle, ticket) => status(ctypes.UInt64(handle), ticket),
    syncLittleShadow: syncLittleShadow && ((handle, ticket, rect) => syncLittleShadow(
      ctypes.UInt64(handle), ticket, ...rect)),
    syncLittleFills: syncLittleFills && ((handle, ticket, request) => syncLittleFills(
      ctypes.UInt64(handle), ticket, request ? JSON.stringify(request) : null)),
    shutdown: () => { stopPopover?.(); shutdown(); },
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
    this.shadowFrame = 0;
    this.queries = ["(prefers-color-scheme: dark)", "(prefers-reduced-transparency: reduce)",
      "(prefers-contrast: more)", "(forced-colors: active)"].map(q => window.matchMedia(q));
    this.change = () => this.refresh();
    this.rehost = () => this.refresh(true);
    // A drawable can be unavailable while the app starts in the background.
    // Retry on a real window interaction after that bounded attempt expires.
    this.health = () => this.state?.key ? this.checkFrame() : this.refresh();
    this.attributes = new window.MutationObserver(this.change);
    this.attributes.observe(window.document.documentElement, { attributes: true,
      attributeFilter: ["zen-single-toolbar", "zen-unsynced-window", "privatebrowsingmode", "taskbartab", "zen-little-window"] });
    if (window._zenLittleWindow === true && window.gURLBar) {
      // Motion can also drive transforms through inline style, outside the
      // Web Animations API and ResizeObserver. Observe the final reset too.
      this.panelChange = () => this.queueLittleShadow();
      this.panelAttributes = new window.MutationObserver(this.panelChange);
      this.panelAttributes.observe(window.gURLBar, { attributes: true, childList: true, subtree: true,
        attributeFilter: ["style", "selected", "hidden", "zen-site-search"] });
      for (const event of ["pointerover", "pointerout", "scroll"])
        window.gURLBar.addEventListener(event, this.panelChange, { capture: true, passive: true });
    }
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
        manager.isPrivateWindow ||
        this.queries.slice(1).some(query => query.matches) ||
        (this.queries[0].matches ? "dark" : "light") !== this.native.appearance) return null;
    const root = window.document.documentElement;
    if (window._zenLittleWindow === true && root.hasAttribute("zen-little-window")) {
      return this.native.little ?? null;
    }
    if (manager.privateWindowOrDisabled || !root.hasAttribute("zen-single-toolbar")) return null;
    const workspace = manager.getActiveWorkspace();
    const record = this.native.themes.get(workspace?.uuid);
    const key = themeKey(workspace?.theme);
    if (record && key === record.key) return { ...record, key: workspace.uuid + ":" + key };
    const request = this.native.dynamic && dynamicThemeRequest(workspace?.theme, this.native.appearance);
    return request && workspace?.uuid ? { key: workspace.uuid + ":dynamic:" + key, index: request } : null;
  }

  async refresh(force = false) {
    if (this.closed || stopped) return;
    try {
      this.native = await (loading ??= load().catch(() => null));
      if (!this.native || this.closed || stopped) return;
      if (this.native.commandMediumWeight && !this.commandFontReady) {
        this.window.document.documentElement.style.setProperty(
          "--zen-command-medium-weight", this.native.commandMediumWeight);
        this.commandFontReady = true;
      }
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
          visible => {
            const root = this.window.document.documentElement;
            root.toggleAttribute("zen-native-theme", visible);
            if (!visible) {
              root.toggleAttribute("zen-native-little-panel", false);
              root.toggleAttribute("zen-native-little-fills", false);
            }
          },
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
      this.syncLittleShadow();
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
        this.syncLittleShadow();
      } else {
        this.frame = this.window.requestAnimationFrame(check);
      }
    };
    this.frame = this.window.requestAnimationFrame(check);
  }

  queueLittleShadow() {
    if (this.closed || stopped || this.shadowFrame) return;
    this.shadowFrame = this.window.requestAnimationFrame(() => {
      this.shadowFrame = 0;
      this.syncLittleShadow();
    });
  }

  syncLittleFills(panelRect) {
    const window = this.window, root = window.document.documentElement;
    const clear = () => {
      root.toggleAttribute("zen-native-little-fills", false);
      this.native?.syncLittleFills?.(this.handle, this.state.ticket, null);
    };
    if (!this.native?.littlePanel || !this.native?.syncLittleFills) { clear(); return; }
    try {
      const bar = window.gURLBar;
      const item = element => {
        if (!element || !element.isConnected) return null;
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const color = parseNativeCommandColor(window.getComputedStyle(element)
          .getPropertyValue("--zen-native-command-fill"));
        if (!color) throw new Error("Unsupported native command color");
        return { rect: [rect.x, rect.y, rect.width, rect.height], color };
      };
      const results = bar.querySelector("#urlbar-results")?.getBoundingClientRect();
      const clip = results?.width && results?.height ? results : panelRect;
      const left = Math.max(clip.x, panelRect.x, 0), top = Math.max(clip.y, panelRect.y, 0);
      const right = Math.min(clip.x+clip.width, panelRect.x+panelRect.width, window.innerWidth);
      const bottom = Math.min(clip.y+clip.height, panelRect.y+panelRect.height, window.innerHeight);
      if (right <= left || bottom <= top) { clear(); return; }
      const request = {
        viewport: [window.innerWidth, window.innerHeight], clip: [left, top, right-left, bottom-top],
        selected: item(bar.querySelector(".urlbarView-row[selected]:not([stale])")),
        hover: item(bar.querySelector(".urlbarView-row:hover:not([selected]):not([stale])")),
        pill: item(bar.hasAttribute("zen-site-search") ? bar.querySelector("#urlbar-search-mode-indicator") : null),
      };
      if (this.native.syncLittleFills(this.handle, this.state.ticket, request) !== 0) { clear(); return; }
      root.toggleAttribute("zen-native-little-fills", true);
    } catch { try { clear(); } catch { /* Keep the DOM color and shadow. */ } }
  }

  syncLittleShadow() {
    const window = this.window;
    window.cancelAnimationFrame(this.shadowFrame);
    this.shadowFrame = 0;
    const root = window.document.documentElement;
    if (this.closed || stopped || window._zenLittleWindow !== true ||
        !this.native?.syncLittleShadow || !this.state) {
      root.toggleAttribute("zen-native-little-panel", false);
      root.toggleAttribute("zen-native-little-fills", false);
      return;
    }
    const clear = () => {
      root.toggleAttribute("zen-native-little-panel", false);
      root.toggleAttribute("zen-native-little-fills", false);
      return this.native.syncLittleShadow(this.handle, this.state.ticket, Array(7).fill(0));
    };
    try {
      if (!this.state.visible || !root.hasAttribute("zen-native-theme") ||
          !root.hasAttribute("zen-little-input") || window._zenLittleWindowInput !== true ||
          this.selection()?.key !== this.native.little?.key || !window.gURLBar?.view?.isOpen) {
        clear(); return;
      }
      const panel = window.gURLBar.querySelector(".urlbar-background");
      if (!panel?.isConnected) { clear(); return; }
      const rect = panel.getBoundingClientRect();
      const style = window.getComputedStyle(panel);
      const radius = parseFloat(style.borderTopLeftRadius) * rect.width / parseFloat(style.width);
      if (this.native.syncLittleShadow(this.handle, this.state.ticket,
          [rect.x, rect.y, rect.width, rect.height, radius, window.innerWidth, window.innerHeight]) !== 0) clear();
      else {
        root.toggleAttribute("zen-native-little-panel", this.native.littlePanel === true);
        this.syncLittleFills(rect);
      }
      // The scope transition scales the panel without resizing its layout
      // box. Track that finite animation, including its final unscaled frame.
      // ResizeObserver alone can leave the shadow at an intermediate scale.
      if (window.gURLBar.getAnimations().some(animation => animation.playState === "running" || animation.pending)) {
        this.shadowFrame = window.requestAnimationFrame(() => this.syncLittleShadow());
      }
    } catch { try { clear(); } catch { /* The native theme keeps its fallback. */ } }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.state?.close();
    this.attributes.disconnect();
    this.panelAttributes?.disconnect();
    if (this.panelChange) for (const event of ["pointerover", "pointerout", "scroll"])
      this.window.gURLBar?.removeEventListener(event, this.panelChange, { capture: true });
    this.window.cancelAnimationFrame(this.frame);
    this.window.cancelAnimationFrame(this.shadowFrame);
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

// Little's existing size observer and lifecycle own geometry invalidation.
// First-frame readiness also synchronizes once; there is no idle polling.
export function syncNativeLittleShadow(window) {
  owners.get(window)?.syncLittleShadow();
}

// Await the shared load before asking AppKit to show a popup. Usually the
// Space background has already loaded it; this also covers an immediate first
// interaction during startup without racing the native will-show notification.
export async function prepareNativePopupAppearance() {
  if (stopped || Services.appinfo.OS !== "Darwin") return;
  await (loading ??= load().catch(() => null));
}

// Called only when a scope label or its display scale changes. The bounded
// process cache avoids repeated AppKit shaping when the user switches scopes.
export async function measureNativeScopeLabel(text, scale) {
  if (stopped || Services.appinfo.OS !== "Darwin" || typeof text !== "string" ||
      !text.length || text.length > 512 || text.includes("\0") ||
      !Number.isFinite(scale) || scale < 0.5 || scale > 8) return null;
  const key = JSON.stringify([text, scale]);
  if (scopeMetrics.has(key)) return scopeMetrics.get(key);
  try {
    const native = await (loading ??= load().catch(() => null));
    if (stopped) return null;
    const result = native?.measureScope?.(text, scale);
    if (!result || !Number.isFinite(result.width) || result.width < 0 || result.width > 32768 ||
        !Number.isFinite(result.height) || result.height <= 0 || result.height > 128 ||
        !Number.isFinite(result.weight) || result.weight < 1 || result.weight > 1000) return null;
    if (scopeMetrics.size === 128) scopeMetrics.delete(scopeMetrics.keys().next().value);
    scopeMetrics.set(key, result);
    return result;
  } catch { return null; }
}

// Only unedited imported themes retain their original extended-gamut palette.
export async function nativeSpaceIconPalette(workspace) {
  if (stopped || Services.appinfo.OS !== "Darwin" || !workspace?.uuid) return null;
  try {
    const native = await (loading ??= load().catch(() => null));
    const record = native?.themes.get(workspace.uuid);
    if (stopped || !record || record.key !== themeKey(workspace.theme)) return null;
    return record.spaceIconPalette ?? null;
  } catch { return null; }
}

// Preserve the original wide-gamut colors when opening an unchanged import.
// Never apply bundled colors to an edited or unrelated Space.
export async function nativeSpaceColorPad(workspace) {
  if (stopped || Services.appinfo.OS !== "Darwin" || !workspace?.uuid) return null;
  try {
    const native = await (loading ??= load().catch(() => null));
    const record = native?.themes.get(workspace.uuid);
    if (stopped || !record || record.key !== themeKey(workspace.theme)) return null;
    return record.colorPad ? structuredClone(record.colorPad) : null;
  } catch { return null; }
}

// Resolve once per distinct scope color, outside the input/animation path.
export async function nativeCommandSelectionColor(value) {
  if (stopped || Services.appinfo.OS !== "Darwin" || typeof value !== "string") return null;
  const color = parseNativeCommandColor(value);
  if (!color) return null;
  const key = JSON.stringify(color);
  if (selectionColors.has(key)) return selectionColors.get(key);
  try {
    const native = await (loading ??= load().catch(() => null));
    if (stopped) return null;
    const values = native?.selectionPalette?.(color);
    if (!values || values.length !== 8 ||
        values.some(v => !Number.isFinite(v) || v < 0 || v > 1)) return null;
    const css = offset => `color(srgb ${values.slice(offset, offset + 3).join(" ")} / ${values[offset + 3]})`;
    const result = `light-dark(${css(4)}, ${css(0)})`;
    if (selectionColors.size === 128) selectionColors.delete(selectionColors.keys().next().value);
    selectionColors.set(key, result);
    return result;
  } catch { return null; }
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
  if (!selected || !Number.isInteger(selected.index) || !owner.native?.showToast || owner.closed || stopped) {
    owner.native?.clearToast?.(owner.handle);
    return false;
  }
  try {
    if (owner.native.showToast(owner.handle, selected.index, request) === 0) return true;
  } catch { /* A failed replacement must not leave the previous Share target. */ }
  owner.native.clearToast?.(owner.handle);
  return false;
}
