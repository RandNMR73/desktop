import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { NativeThemeState, themeKey } from "../../src/zen/spaces/ZenNativeThemeState.mjs";

const source = readFileSync(new URL("../../src/zen/spaces/ZenNativeTheme.sys.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\n/m, "").replaceAll("export function", "function").replaceAll("export async function", "async function");
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

function fixture({ delayed = false, toastResult = 0, popoverResult = 0,
                   popoverAvailable = true, little = false } = {}) {
  const theme = { type: "gradient", opacity: .8, texture: 1, gradientColors: [{ c: [0, 165, 214] }] };
  const attributes = new Set(["zen-single-toolbar"]), events = new Map(), frames = new Map();
  const native = { status: 0, handle: "123", calls: [], clears: 0, activated: 0,
    toastClears: 0, toastRequests: [], popoverRequests: [] };
  let now = 0, frameId = 0, release;
  const ready = new Promise(resolve => { release = resolve; });
  const backend = {
    themes: new Map([["main", { index: 0, key: themeKey(theme) }]]), appearance: "dark",
    little: little ? { index: 5, key: "little-default-v1:dark" } : undefined,
    apply: (...args) => { native.calls.push(args); return 0; },
    clear: () => { native.clears++; },
    activate: () => { native.activated++; return 0; },
    status: () => native.status,
    shutdown() {},
    showToast: (...args) => {
      native.toastRequests.push(args);
      if (toastResult instanceof Error) throw toastResult;
      return toastResult;
    },
    clearToast: () => { native.toastClears++; },
    syncPopover: popoverAvailable ? (...args) => {
      native.popoverRequests.push(args);
      if (popoverResult instanceof Error) throw popoverResult;
      return Array.isArray(popoverResult) ? popoverResult.shift() : popoverResult;
    } : undefined,
  };
  const queries = [true, false, false, false].map(matches => ({
    matches, addEventListener() {}, removeEventListener() {},
  }));
  const manager = {
    isPrivateWindow: false, privateWindowOrDisabled: false,
    workspace: { uuid: "main", theme: structuredClone(theme) },
    getActiveWorkspace() { return this.workspace; },
  };
  const window = {
    gZenWorkspaces: manager, performance: { now: () => now },
    MutationObserver: class { observe() {} disconnect() {} },
    document: { documentElement: {
      hasAttribute: name => attributes.has(name),
      toggleAttribute: (name, value) => value ? attributes.add(name) : attributes.delete(name),
    } },
    docShell: { treeOwner: { QueryInterface: () => ({ nativeHandle: native.handle }) } },
    matchMedia: () => queries.shift(),
    addEventListener: (name, listener) => events.set(name, listener),
    removeEventListener: name => events.delete(name),
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  const context = vm.createContext({ NativeThemeState, themeKey, WeakRef, console,
    Services: { appinfo: { OS: "Darwin" }, obs: { addObserver() {} } },
    ChromeUtils: { importESModule: () => ({ ctypes: { UInt64: value => value } }) },
    Ci: { nsIBaseWindow: 1 }, injectedLoading: delayed ? ready : Promise.resolve(backend),
  });
  vm.runInContext(source + "\nloading=injectedLoading; globalThis.update=updateNativeTheme; globalThis.toast=showNativeCopyToast; globalThis.popup=syncNativePopupAppearance;", context);
  return {
    window, manager, native, attributes, events, frames,
    toast: (request, current) => context.toast(window, request, current),
    popup: panel => context.popup(window, panel),
    update: () => context.update(window), release: () => release(backend),
    get shown() { return attributes.has("zen-native-theme"); },
    async event(name) { events.get(name)?.(); await tick(); },
    frame(delta = 16) { now += delta; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); },
  };
}

test("first-frame wait is bounded and activation retries an unavailable drawable", async () => {
  const f = fixture(); f.update(); await tick();
  assert.equal(f.shown, false);
  f.frame(2100);
  assert.equal(f.shown, false);
  assert.equal(f.frames.size, 0);
  await f.event("activate");
  assert.equal(f.native.calls.length, 2);
  f.native.status = 1; f.frame();
  assert.equal(f.shown, true);
  assert.equal(f.frames.size, 0, "no idle polling after readiness");
});

function popupFor(f) {
  return { ownerDocument: { defaultView: f.window }, isConnected: true, state: "open",
    getOuterScreenRect: () => ({ x: 88, y: 124, width: 236, height: 377 }) };
}

test("native popup synchronization uses its document window and screen bounds", async () => {
  const f = fixture(), panel = popupFor(f);
  assert.equal(panel.ownerGlobal, undefined, "DOM panels do not expose ownerGlobal");
  assert.equal(await f.popup(panel), true);
  assert.deepEqual(f.native.popoverRequests, [["123", panel.getOuterScreenRect()]]);
  assert.equal(f.native.calls.length, 0, "opening a popup does not redraw the Space");
});

test("stale or foreign popups cannot be synchronized after loading the native bundle", async () => {
  for (const invalidate of [
    (f, p) => { p.state = "closed"; },
    (f, p) => { p.isConnected = false; },
    (f, p) => { p.ownerDocument.defaultView = {}; },
    (f) => { f.window.closed = true; },
  ]) {
    const f = fixture({ delayed: true }), panel = popupFor(f);
    const pending = f.popup(panel);
    invalidate(f, panel); f.release();
    assert.equal(await pending, false);
    assert.equal(f.native.popoverRequests.length, 0);
  }
});

test("old native bundles and rejected popup matches leave Gecko's appearance alone", async () => {
  for (const options of [{ popoverAvailable: false }, { popoverResult: 3 },
    { popoverResult: new Error("native exception") }]) {
    const f = fixture(options);
    assert.equal(await f.popup(popupFor(f)), false);
    assert.equal(f.native.calls.length, 0);
    assert.equal(f.native.clears, 0);
  }
});

test("a newly positioned native popup retries once with fresh coordinates", async () => {
  const f = fixture({ popoverResult: [4, 0] }), panel = popupFor(f);
  const pending = f.popup(panel);
  await tick();
  assert.equal(f.native.popoverRequests.length, 1);
  panel.getOuterScreenRect = () => ({ x: 88, y: 124, width: 236, height: 297 });
  f.frame();
  assert.equal(await pending, true);
  assert.equal(f.native.popoverRequests.length, 2);
  assert.equal(f.native.popoverRequests[1][1].height, 297);
  assert.equal(f.frames.size, 0, "the retry is not a polling loop");
});

test("closed popups and repeated native no-match failures stop after the next frame", async () => {
  for (const closed of [false, true]) {
    const f = fixture({ popoverResult: 4 }), panel = popupFor(f);
    const pending = f.popup(panel); await tick();
    if (closed) panel.state = "closed";
    f.frame();
    assert.equal(await pending, false);
    assert.equal(f.native.popoverRequests.length, closed ? 1 : 2);
    assert.equal(f.frames.size, 0);
  }
});

test("closing during asynchronous bundle loading cannot attach a surface", async () => {
  const f = fixture({ delayed: true }); f.update();
  await f.event("unload"); f.release(); await tick();
  assert.equal(f.native.calls.length, 0);
  assert.equal(f.frames.size, 0);
});

test("theme edits before GPU completion restore fallback without another redraw", async () => {
  const f = fixture(); f.update(); await tick();
  f.manager.workspace.theme.texture = .5;
  f.native.status = 1; f.frame();
  assert.equal(f.shown, false);
  assert.equal(f.native.activated, 0);
});

test("private and unsynced windows never submit native frames", async () => {
  for (const key of ["isPrivateWindow", "privateWindowOrDisabled"]) {
    const f = fixture(); f.manager[key] = true; f.update(); await tick();
    assert.equal(f.native.calls.length, 0);
    assert.equal(f.frames.size, 0);
  }
});

test("Little uses its explicit default across destination Space changes", async () => {
  const f = fixture({ little: true });
  f.window._zenLittleWindow = true;
  f.attributes.add("zen-little-window");
  f.attributes.delete("zen-single-toolbar");
  f.manager.privateWindowOrDisabled = true;
  f.update(); await tick();
  assert.equal(f.native.calls[0][1], 5);
  f.native.status = 1; f.frame();
  assert.equal(f.shown, true);
  f.manager.workspace = { uuid: "another", theme: {} };
  await f.event("ZenWorkspaceDataChanged");
  assert.equal(f.native.calls.length, 1, "destination changes do not repaint Little");
  assert.equal(f.frames.size, 0);
});

test("Little rejects private windows, missing resources, and incomplete role markers", async () => {
  for (const mode of ["private", "missing", "attribute-only", "flag-only"]) {
    const f = fixture({ little: mode !== "missing" });
    f.manager.privateWindowOrDisabled = true;
    f.window._zenLittleWindow = mode !== "attribute-only";
    if (mode !== "flag-only") f.attributes.add("zen-little-window");
    if (mode === "private") f.manager.isPrivateWindow = true;
    f.update(); await tick();
    assert.equal(f.native.calls.length, 0, mode);
    assert.equal(f.frames.size, 0, mode);
  }
});

test("losing Little's role during GPU submission keeps its CSS fallback", async () => {
  const f = fixture({ little: true });
  f.window._zenLittleWindow = true; f.attributes.add("zen-little-window");
  f.manager.privateWindowOrDisabled = true; f.update(); await tick();
  f.attributes.delete("zen-little-window");
  f.native.status = 1; f.frame();
  assert.equal(f.shown, false);
  assert.equal(f.native.activated, 0);
});

test("resize checks the new frame and restores CSS on render failure", async () => {
  const f = fixture(); f.update(); await tick(); f.native.status = 1; f.frame();
  assert.equal(f.shown, true);
  f.native.status = -1; await f.event("resize"); f.frame();
  assert.equal(f.shown, false);
  assert.equal(f.frames.size, 0);
});

test("minimize/restore retains the completed surface without redundant GPU submissions", async () => {
  const f = fixture(); f.update(); await tick(); f.native.status = 1; f.frame();
  for (let i = 0; i < 4; i++) {
    await f.event("sizemodechange");
    assert.equal(f.shown, true, "the native surface must stay visible between frames");
    f.frame();
  }
  assert.equal(f.native.calls.length, 1);
  assert.equal(f.native.clears, 0);
  assert.equal(f.frames.size, 0);
});

test("a resize in flight retains the previous frame and checks the existing request", async () => {
  const f = fixture(); f.update(); await tick(); f.native.status = 1; f.frame();
  f.native.status = 0;
  await f.event("sizemodechange"); f.frame();
  assert.equal(f.shown, true);
  assert.equal(f.native.calls.length, 1);
  assert.equal(f.frames.size, 1);
  f.native.status = 1; f.frame();
  assert.equal(f.shown, true);
  assert.equal(f.frames.size, 0);
});

test("a replaced native host still requires a matching completed frame", async () => {
  const f = fixture(); f.update(); await tick(); f.native.status = 1; f.frame();
  f.native.status = -1;
  await f.event("fullscreen");
  assert.equal(f.shown, false);
  assert.equal(f.native.calls.length, 2);
  f.native.status = 1; f.frame();
  assert.equal(f.shown, true);
});

test("a changed NSWindow handle retires the old surface before creating the new one", async () => {
  const f = fixture(); f.update(); await tick(); f.native.status = 1; f.frame();
  f.native.handle = "456";
  await f.event("fullscreen");
  assert.equal(f.shown, false);
  assert.equal(f.native.clears, 1);
  assert.equal(f.native.calls.length, 2);
  assert.equal(f.native.calls[1][0], "456");
  f.frame();
  assert.equal(f.shown, true);
});

test("unload cancels the pending animation frame and removes listeners", async () => {
  const f = fixture(); f.update(); await tick();
  assert.equal(f.frames.size, 1);
  await f.event("unload");
  assert.equal(f.frames.size, 0);
  assert.equal(f.events.has("resize"), false);
  assert.equal(f.shown, false);
});


test("a rejected native notification clears its stale Share target before DOM fallback", async () => {
  for (const toastResult of [3, new Error("native failure")]) {
    const f = fixture({ toastResult });
    f.update(); await tick();
    const initialClears = f.native.toastClears;
    assert.equal(await f.toast({ label: "Copied Current URL", url: null }), false);
    assert.equal(f.native.toastRequests.length, 1);
    assert.equal(f.native.toastClears, initialClears + 1);
  }
});

test("a superseded notification never clears or replaces the latest native notification", async () => {
  const f = fixture({ delayed: true });
  let current = true;
  const obsolete = f.toast({ label: "old", url: "https://example.test/old" }, () => current);
  current = false;
  f.release();
  assert.equal(await obsolete, true);
  assert.equal(f.native.toastRequests.length, 0);
  assert.equal(f.native.toastClears, 1, "initial Space attachment clears once");
  const initialClears = f.native.toastClears;
  assert.equal(await f.toast({ label: "new", url: "https://example.test/new" }), true);
  assert.equal(f.native.toastRequests.length, 1);
  assert.equal(f.native.toastClears, initialClears);
  assert.equal(f.native.toastRequests[0][2].url, "https://example.test/new");
});
