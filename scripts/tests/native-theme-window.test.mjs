import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { NativeThemeState, themeKey } from "../../src/zen/spaces/ZenNativeThemeState.mjs";

const source = readFileSync(new URL("../../src/zen/spaces/ZenNativeTheme.sys.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\n/m, "").replaceAll("export function", "function").replaceAll("export async function", "async function");
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

function fixture({ delayed = false, toastResult = 0 } = {}) {
  const theme = { type: "gradient", opacity: .8, texture: 1, gradientColors: [{ c: [0, 165, 214] }] };
  const attributes = new Set(["zen-single-toolbar"]), events = new Map(), frames = new Map();
  const native = { status: 0, calls: [], clears: 0, activated: 0, toastClears: 0, toastRequests: [] };
  let now = 0, frameId = 0, release;
  const ready = new Promise(resolve => { release = resolve; });
  const backend = {
    themes: new Map([["main", { index: 0, key: themeKey(theme) }]]), appearance: "dark",
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
    docShell: { treeOwner: { QueryInterface: () => ({ nativeHandle: "123" }) } },
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
  vm.runInContext(source + "\nloading=injectedLoading; globalThis.update=updateNativeTheme; globalThis.toast=showNativeCopyToast;", context);
  return {
    window, manager, native, attributes, events, frames,
    toast: (request, current) => context.toast(window, request, current),
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

test("resize checks the new frame and restores CSS on render failure", async () => {
  const f = fixture(); f.update(); await tick(); f.native.status = 1; f.frame();
  assert.equal(f.shown, true);
  f.native.status = -1; await f.event("resize"); f.frame();
  assert.equal(f.shown, false);
  assert.equal(f.frames.size, 0);
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
