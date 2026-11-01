import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { NativeThemeState, themeKey } from "../../src/zen/spaces/ZenNativeThemeState.mjs";

const source = readFileSync(new URL("../../src/zen/spaces/ZenNativeTheme.sys.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\n/m, "").replaceAll("export function", "function").replaceAll("export async function", "async function");
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

function fixture({ delayed = false, toastResult = 0, popoverResult = 0,
                   popoverAvailable = true, little = false, shadow = true, panel = true, shadowResult = 0, fills = false, fillResult = 0,
                   sidebar = true, selectionResult = [.5, .45, .45, 1, .9, .6, .6, 1] } = {}) {
  const theme = { type: "gradient", opacity: .8, texture: 1, gradientColors: [{ c: [0, 165, 214] }] };
  const attributes = new Set(["zen-single-toolbar"]), events = new Map(), frames = new Map(), observers = [];
  const native = { status: 0, handle: "123", calls: [], clears: 0, activated: 0,
    toastClears: 0, toastRequests: [], popoverRequests: [], shadowRequests: [], fillRequests: [], selectionRequests: [],
    sidebarRequests: [], sidebarActivations: [], sidebarClears: [], sidebarStatus: 0 };
  let now = 0, frameId = 0, release;
  const ready = new Promise(resolve => { release = resolve; });
  const backend = {
    sidebarSurface: sidebar ? {
      apply: (...args) => { native.sidebarRequests.push(args); return 0; },
      status: () => native.sidebarStatus,
      activate: (...args) => { native.sidebarActivations.push(args); return 0; },
      clear: handle => { native.sidebarClears.push(handle); },
    } : undefined,
    selectionPalette: color => {
      native.selectionRequests.push(color);
      if (selectionResult instanceof Error) throw selectionResult;
      return selectionResult;
    },
    themes: new Map([["main", { index: 0, key: themeKey(theme) }]]), appearance: "dark",
    littlePanel: panel,
    little: little ? { index: 5, key: "little-default-v1:dark" } : undefined,
    apply: (...args) => { native.calls.push(args); return 0; },
    clear: () => { native.clears++; },
    activate: () => { native.activated++; return 0; },
    status: () => native.status,
    syncLittleShadow: shadow ? (...args) => { native.shadowRequests.push(args); return shadowResult; } : undefined,
    syncLittleFills: fills ? (...args) => { native.fillRequests.push(args); return fillResult; } : undefined,
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
    innerWidth: 490, innerHeight: 329,
    gZenWorkspaces: manager, performance: { now: () => now },
    MutationObserver: class { constructor(callback) { observers.push(callback); } observe() {} disconnect() {} },
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
  vm.runInContext(source + "\nloading=injectedLoading; globalThis.update=updateNativeTheme; globalThis.toast=showNativeCopyToast; globalThis.popup=syncNativePopupAppearance; globalThis.shadow=syncNativeLittleShadow; globalThis.selection=nativeCommandSelectionColor; globalThis.sidebar=createNativeSidebarSurface;", context);
  return {
    window, manager, native, backend, attributes, events, frames, observers,
    color: value => context.parseNativeCommandColor(value),
    selection: value => context.selection(value),
    toast: (request, current) => context.toast(window, request, current),
    popup: panel => context.popup(window, panel),
    shadow: () => context.shadow(window),
    sidebar: () => context.sidebar(window),
    update: () => context.update(window), release: () => release(backend),
    get shown() { return attributes.has("zen-native-theme"); },
    async event(name) { events.get(name)?.(); await tick(); },
    frame(delta = 16) { now += delta; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); },
  };
}

test("sidebar surface follows the validated window and its completed theme ticket", async () => {
  const f = fixture(), sidebar = await f.sidebar();
  const rect = [4, 4, 230, 800, 1710, 984];
  assert.equal(sidebar.apply(rect, 10), 1, "no surface before the main theme is ready");
  assert.equal(f.native.sidebarRequests.length, 0);
  f.native.status = 1; f.frame();
  assert.equal(sidebar.apply(rect, 10), 0);
  assert.deepEqual(f.native.sidebarRequests.at(-1), ["123", f.native.calls.at(-1)[2], 10, rect]);
  assert.equal(sidebar.status(10), 0);
  f.native.sidebarStatus = 1;
  assert.equal(sidebar.status(10), 1);
  assert.equal(sidebar.activate(10), 0);
  assert.equal(f.native.sidebarActivations.length, 1);
  assert.equal(f.frames.size, 0, "no sidebar polling or timers in the adapter");
  sidebar.clear();
  assert.equal(sidebar.status(10), -1);
  assert.equal(sidebar.activate(10), 1);
  sidebar.destroy(); sidebar.destroy();
  assert.deepEqual(f.native.sidebarClears, ["123"]);
  assert.equal(sidebar.apply(rect, 11), 1);
});

test("sidebar rejects changed Space identity before owner refresh and stale completions afterward", async () => {
  const f = fixture(), sidebar = await f.sidebar();
  f.native.status = 1; f.frame();
  const rect = [4, 4, 230, 800, 1710, 984];
  assert.equal(sidebar.apply(rect, 10), 0);
  // Even another validated Space cannot borrow the previous Space's ticket.
  f.backend.themes.set("other-space", { index: 1, key: themeKey(f.manager.workspace.theme) });
  f.manager.workspace.uuid = "other-space";
  assert.equal(sidebar.status(10), -1);
  assert.equal(sidebar.activate(10), 1);
  assert.equal(sidebar.apply(rect, 11), 1);
  assert.equal(f.native.sidebarRequests.length, 1);
  assert.deepEqual(f.native.sidebarClears, ["123"]);
  await f.event("ZenWorkspaceDataChanged");
  f.frame();
  assert.equal(sidebar.apply(rect, 12), 0);
  assert.equal(f.native.sidebarRequests.at(-1)[1], f.native.calls.at(-1)[2]);
  assert.notEqual(f.native.sidebarRequests.at(-1)[1], f.native.sidebarRequests[0][1]);
});

test("sidebar invalidation rejects malformed requests, role changes and window teardown", async () => {
  const rect = [4, 4, 230, 800, 1710, 984];
  for (const invalidate of [
    f => { f.manager.isPrivateWindow = true; },
    f => { f.manager.workspace.theme.opacity = .25; },
    f => { f.window.closed = true; },
    async f => { await f.event("unload"); },
  ]) {
    const f = fixture(), sidebar = await f.sidebar(); f.native.status = 1; f.frame();
    assert.equal(sidebar.apply(rect, 1), 0);
    await invalidate(f);
    assert.equal(sidebar.status(1), -1);
    assert.equal(sidebar.activate(1), 1);
    assert.equal(sidebar.apply(rect, 2), 1);
    assert.equal(f.native.sidebarRequests.length, 1);
  }
  const f = fixture(), sidebar = await f.sidebar(); f.native.status = 1; f.frame();
  for (const ticket of [0, -1, 1.5, NaN, 2 ** 32]) {
    assert.equal(sidebar.apply(rect, ticket), 1);
    assert.equal(sidebar.status(ticket), -1);
    assert.equal(sidebar.activate(ticket), 1);
  }
  for (const badRect of [null, [], [4, 4, 230, Infinity, 1710, 984]])
    assert.equal(sidebar.apply(badRect, 1), 1);
  assert.equal(f.native.sidebarRequests.length, 0);
});

test("old bundles and closure during load cannot create a sidebar adapter", async () => {
  assert.equal(await fixture({ sidebar: false }).sidebar(), null);
  const f = fixture({ delayed: true }), pending = f.sidebar();
  await f.event("unload"); f.release();
  assert.equal(await pending, null);
  assert.equal(f.native.sidebarRequests.length, 0);
});

test("scope selection preserves the P3 input and reuses canonical color results", async () => {
  const f = fixture();
  const result = await f.selection("color(display-p3 1 0 0)");
  assert.equal(result, "light-dark(color(srgb 0.9 0.6 0.6 / 1), color(srgb 0.5 0.45 0.45 / 1))");
  assert.equal(await f.selection("color(display-p3 100% 0% 0% / 100%)"), result);
  assert.equal(f.native.selectionRequests.length, 1);
  assert.equal(f.native.selectionRequests[0].space, "display-p3");
  await f.selection("rgb(255, 0, 0)");
  assert.equal(f.native.selectionRequests.length, 2, "sRGB and P3 are distinct native palettes");
});

test("invalid colors and unavailable native selection results retain CSS fallback", async () => {
  const f = fixture();
  for (const input of [null, "invalid", "color(rec2020 1 0 0)", "rgb(NaN,0,0)"])
    assert.equal(await f.selection(input), null);
  assert.equal(f.native.selectionRequests.length, 0);
  for (const selectionResult of [null, new Error("unavailable"), [1], [NaN,0,0,1,0,0,0,1], [-1,0,0,1,0,0,0,1]]) {
    const bad = fixture({ selectionResult });
    assert.equal(await bad.selection("rgb(255,0,0)"), null);
  }
});

test("scope palette cache stays bounded across many distinct engine colors", async () => {
  const f = fixture();
  for (let i = 0; i < 129; i++) await f.selection(`rgb(${i},0,0)`);
  await f.selection("rgb(128,0,0)");
  assert.equal(f.native.selectionRequests.length, 129);
  await f.selection("rgb(0,0,0)");
  assert.equal(f.native.selectionRequests.length, 130);
});

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

function freshLittle(options = {}) {
  const f = fixture({ little: true, ...options });
  f.window._zenLittleWindow = true;
  f.window._zenLittleWindowInput = true;
  f.attributes.add("zen-little-window"); f.attributes.add("zen-little-input");
  f.manager.privateWindowOrDisabled = true;
  f.panel = { isConnected: true, getBoundingClientRect: () => ({ x: 0, y: 0, width: 490, height: 128 }) };
  f.barEvents = new Map();
  f.window.gURLBar = { view: { isOpen: true },
    querySelector: selector => selector === ".urlbar-background" ? f.panel : null,
    getAnimations: () => [], hasAttribute: () => false,
    addEventListener: (name, listener) => f.barEvents.set(name, listener),
    removeEventListener: name => f.barEvents.delete(name),
  };
  f.window.getComputedStyle = () => ({ borderTopLeftRadius: "10px", width: "490px" });
  return f;
}

test("Little panel geometry reaches the native shadow only after first-frame activation", async () => {
  const f = freshLittle(); f.update(); await tick();
  assert.ok(f.native.shadowRequests.every(call => call[2].every(value => value === 0)));
  assert.equal(f.attributes.has("zen-native-little-panel"), false);
  f.native.status = 1; f.frame();
  assert.deepEqual(Array.from(f.native.shadowRequests.at(-1)[2]), [0, 0, 490, 128, 10, 490, 329]);
  assert.equal(f.attributes.has("zen-native-little-panel"), true);
  const submissions = f.native.calls.length;
  f.panel.getBoundingClientRect = () => ({ x: 0, y: 0, width: 490, height: 228 });
  f.shadow();
  assert.equal(f.native.shadowRequests.at(-1)[2][3], 228);
  assert.equal(f.native.calls.length, submissions, "panel resizing does not redraw the gradient");
  assert.equal(f.frames.size, 0);
});

test("Little shadow clears on loaded conversion, panel closure, detached DOM and role fallback", async () => {
  for (const invalidate of [
    f => { f.window._zenLittleWindowInput = false; },
    f => { f.attributes.delete("zen-little-input"); },
    f => { f.window.gURLBar.view.isOpen = false; },
    f => { f.panel.isConnected = false; },
    f => { f.attributes.delete("zen-little-window"); },
    f => { f.manager.isPrivateWindow = true; },
  ]) {
    const f = freshLittle(); f.update(); await tick(); f.native.status = 1; f.frame();
    invalidate(f); f.shadow();
    assert.ok(f.native.shadowRequests.at(-1)[2].every(value => value === 0));
    assert.equal(f.attributes.has("zen-native-little-panel"), false);
  }
});

test("Little shadows follow a finite scope transform through its final frame then stop", async () => {
  const f = freshLittle(); f.update(); await tick(); f.native.status = 1; f.frame();
  const animation = { playState: "running", pending: false };
  f.window.gURLBar.getAnimations = () => [animation];
  f.window.getComputedStyle = () => ({ borderTopLeftRadius: "10px", width: "488px" });
  f.panel.getBoundingClientRect = () => ({ x: 5, y: 2, width: 480, height: 126 });
  f.shadow(); f.frame();
  assert.equal(f.frames.size, 1);
  assert.equal(f.native.shadowRequests.at(-1)[2][4], 10 * 480 / 488);
  animation.playState = "finished";
  f.panel.getBoundingClientRect = () => ({ x: 1, y: 1, width: 488, height: 127 });
  f.frame();
  assert.deepEqual(Array.from(f.native.shadowRequests.at(-1)[2]).slice(0, 4), [1, 1, 488, 127]);
  assert.equal(f.frames.size, 0, "no idle animation polling");
  assert.equal(f.native.calls.length, 1, "only the initial gradient submission");
  animation.playState = "running"; f.shadow();
  await f.event("unload"); assert.equal(f.frames.size, 0);
});

test("old shadow libraries, ordinary windows and unloaded owners create no shadow work", async () => {
  for (const f of [freshLittle({ shadow: false }), fixture()]) {
    f.update(); await tick(); f.native.status = 1; f.frame(); f.shadow();
    assert.equal(f.native.shadowRequests.length, 0);
  }
  const f = freshLittle(); f.update(); await tick(); f.native.status = 1; f.frame();
  await f.event("unload");
  const calls = f.native.shadowRequests.length;
  f.shadow(); assert.equal(f.native.shadowRequests.length, calls);
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

test("unsupported and rejected native panel requests keep the opaque fallback", async () => {
  for (const options of [{ panel: false }, { shadow: false }, { shadowResult: 2 }]) {
    const f = freshLittle(options); f.update(); await tick(); f.native.status = 1; f.frame();
    assert.equal(f.attributes.has("zen-native-little-panel"), false);
  }
});

test("render failure and close remove the native panel handoff", async () => {
  for (const event of ["resize", "unload"]) {
    const f = freshLittle(); f.update(); await tick(); f.native.status = 1; f.frame();
    assert.equal(f.attributes.has("zen-native-little-panel"), true);
    f.native.status = -1; await f.event(event); f.frame();
    assert.equal(f.attributes.has("zen-native-little-panel"), false);
  }
});


test("native command colors preserve computed P3 channels and reject unsupported colors", () => {
  const f = fixture();
  for (const [value, space, rgba] of [
    ["color(display-p3 1 0 0)", "display-p3", [1,0,0,1]],
    ["color(srgb .25 .5 .75 / .3)", "srgb", [.25,.5,.75,.3]],
    ["rgba(255, 127.5, 0, 0.05)", "srgb", [1,.5,0,.05]],
    ["rgb(100% 50% 0% / 30%)", "srgb", [1,.5,0,.3]],
  ]) {
    const result = f.color(value);
    assert.equal(result.space, space); assert.deepEqual(Array.from(result.rgba), rgba);
  }
  for (const value of ["", "red", "color(rec2020 1 0 0)", "color(display-p3 NaN 0 0)",
    "rgb(256 0 0)", "rgba(0 0 0 2)", "color(srgb calc(1 / 2) 0 0)"])
    assert.equal(f.color(value), null, value);
});

function filledLittle(options = {}) {
  const f = freshLittle({ fills: true, ...options });
  const node = (rect, color) => ({ isConnected: true, getBoundingClientRect: () => rect, color });
  f.selected = node({ x:10,y:70.5,width:470,height:46 }, "color(display-p3 1 0 0)");
  f.hovered = node({ x:10,y:120.5,width:470,height:46 }, "rgba(255, 255, 255, .05)");
  f.pill = node({ x:54,y:20,width:73,height:24 }, "color(display-p3 1 0 0)");
  f.results = node({ x:0,y:64.5,width:490,height:264 });
  f.panel.getBoundingClientRect = () => ({ x:0,y:0,width:490,height:328.5 });
  f.scoped = true;
  f.window.gURLBar.hasAttribute = name => name === "zen-site-search" && f.scoped;
  f.window.gURLBar.querySelector = selector => ({
    ".urlbar-background": f.panel, "#urlbar-results": f.results,
    ".urlbarView-row[selected]:not([stale])": f.selected,
    ".urlbarView-row:hover:not([selected]):not([stale])": f.hovered,
    "#urlbar-search-mode-indicator": f.pill,
  })[selector];
  f.window.getComputedStyle = element => ({ borderTopLeftRadius:"10px", width:"490px",
    getPropertyValue: () => element.color ?? "rgba(0,0,0,0)" });
  return f;
}

test("native fills use current geometry and clipping, coalesce mutations and have no idle frames", async () => {
  const f = filledLittle(); f.update(); await tick(); f.native.status = 1; f.frame();
  assert.equal(f.attributes.has("zen-native-little-fills"), true);
  let request = f.native.fillRequests.at(-1)[2];
  assert.deepEqual(Array.from(request.clip), [0,64.5,490,264]);
  assert.deepEqual(Array.from(request.selected.color.rgba), [1,0,0,1]);
  assert.equal(request.selected.color.space, "display-p3");
  assert.deepEqual(Array.from(request.pill.rect), [54,20,73,24]);
  const before = f.native.fillRequests.length;
  f.observers[1](); f.observers[1](); f.barEvents.get("pointerover")();
  assert.equal(f.frames.size, 1); assert.equal(f.native.fillRequests.length, before);
  f.frame(); assert.equal(f.native.fillRequests.length, before+1); assert.equal(f.frames.size, 0);
  f.selected.getBoundingClientRect = () => ({ x:10,y:40,width:470,height:46 });
  f.barEvents.get("scroll")(); f.frame(); request = f.native.fillRequests.at(-1)[2];
  assert.equal(request.selected.rect[1], 40, "clip preserves a partially scrolled row's original shape");
  f.scoped = false; f.shadow(); assert.equal(f.native.fillRequests.at(-1)[2].pill, null);
  f.window.gURLBar.view.isOpen = false; f.shadow();
  assert.equal(f.attributes.has("zen-native-little-fills"), false);
  await f.event("unload"); assert.equal(f.barEvents.size, 0); assert.equal(f.frames.size, 0);
});

test("unsupported, missing and rejected native fills keep CSS paint", async () => {
  for (const options of [{ fills:false }, { panel:false }, { fillResult:3 }]) {
    const f = filledLittle(options); f.update(); await tick(); f.native.status=1; f.frame();
    assert.equal(f.attributes.has("zen-native-little-fills"), false);
  }
  const f = filledLittle(); f.update(); await tick(); f.native.status=1; f.frame();
  f.pill.color = "color(rec2020 1 0 0)"; f.shadow();
  assert.equal(f.attributes.has("zen-native-little-fills"), false);
  assert.equal(f.native.fillRequests.at(-1)[2], null);
});
