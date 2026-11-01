import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { NativeThemeState, themeKey } from "../../src/zen/spaces/ZenNativeThemeState.mjs";

const source = readFileSync(new URL("../../src/zen/spaces/ZenNativeTheme.sys.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\n/m, "").replaceAll("export function", "function")
  .replaceAll("export async function", "async function");

function fixture({ observer = true, result = 0, material = true, shadow = false, panelVersion, fillVersion, fillAvailable = true, appearance = "dark", themes, sidebarVersion, transitionVersion, transitionAvailable = true } = {}) {
  const calls = [];
  const api = {
    zen_theme_version: () => 1,
    zen_theme_apply() {}, zen_theme_activate() {}, zen_theme_clear() {}, zen_theme_status() {},
    zen_theme_shutdown: () => calls.push("theme shutdown"),
    zen_popover_sync_appearance: () => 0,
  };
  if (shadow) api.zen_little_shadow_sync = (...args) => { calls.push(args); return 0; };
  if (panelVersion !== undefined) api.zen_little_panel_version = () => panelVersion;
  if (fillVersion !== undefined) api.zen_little_fills_version = () => fillVersion;
  if (fillAvailable) api.zen_little_fills_sync = (...args) => { calls.push(args); return 0; };
  if (material) api.zen_theme_material_version = () => 1;
  if (sidebarVersion !== undefined) Object.assign(api, {
    zen_sidebar_surface_version: () => sidebarVersion,
    zen_sidebar_surface_apply: () => 0, zen_sidebar_surface_status: () => 1,
    zen_sidebar_surface_activate: () => 0, zen_sidebar_surface_clear: () => 0,
  });
  if (transitionVersion !== undefined) {
    api.zen_sidebar_transition_version = () => transitionVersion;
    api.zen_sidebar_transition_start = (...args) => { calls.push(args); return 0; };
    if (transitionAvailable) api.zen_sidebar_transition_status = () => 1;
  }
  if (observer) Object.assign(api, {
    zen_popover_observe_appearance: () => { calls.push("observe"); return result; },
    zen_popover_shutdown: () => calls.push("stop observer"),
  });
  const ctypes = { default_abi: 0, int: 0, uint64_t: 0, uint32_t: 0, double: 0,
    void_t: 0, char: { ptr: 0 }, UInt64: value => value,
    open: () => ({ declare(name) {
      if (!(name in api)) throw new Error("optional symbol unavailable");
      return api[name];
    } }),
  };
  const context = vm.createContext({ NativeThemeState, themeKey, WeakRef,
    Services: { appinfo: { OS: "Darwin" }, obs: { addObserver() {} },
      dirsvc: { get: () => ({ parent: { path: "/browser/Contents/MacOS",
        parent: { path: "/browser/Contents" } } }) } },
    Ci: { nsIFile: 1 }, PathUtils: { join: (...parts) => parts.join("/") },
    IOUtils: { stat: async () => ({ size: 100 }), readJSON: async () => ({
      version: 1, appearance, themes: themes ?? [{ id: "main", theme: {} }],
    }) },
    ChromeUtils: { importESModule: () => ({ ctypes }) },
  });
  vm.runInContext(source + "\nglobalThis.loadNative = load;", context);
  return { calls, load: () => context.loadNative() };
}

test("native observer is installed before the backend becomes available and removed at shutdown", async () => {
  const f = fixture(), backend = await f.load();
  assert.deepEqual(f.calls, ["observe"]);
  assert.equal(backend.syncPopover("1", { x: 0, y: 0, width: 20, height: 20 }), 0);
  backend.shutdown();
  assert.deepEqual(f.calls, ["observe", "stop observer", "theme shutdown"]);
});

test("older libraries retain their post-opening synchronization and shutdown", async () => {
  const f = fixture({ observer: false }), backend = await f.load();
  assert.equal(backend.syncPopover("1", {}), 0);
  backend.shutdown();
  assert.deepEqual(f.calls, ["theme shutdown"]);
});

test("floating transitions require a complete supported optional capability", async () => {
  for (const sidebarVersion of [undefined, 1]) for (const transitionVersion of [undefined, 0, 1, 2]) {
    const f = fixture({ sidebarVersion, transitionVersion }), backend = await f.load();
    assert.equal(typeof backend.sidebarSurface?.startTransition,
      sidebarVersion === 1 && transitionVersion === 1 ? "function" : "undefined");
    if (backend.sidebarSurface?.startTransition) {
      const rect = [0, 0, 230, 891, 1280, 891];
      assert.equal(backend.sidebarSurface.startTransition("123", 7, 10, rect), 0);
      assert.deepEqual(f.calls.at(-1), ["123", 7, 10, ...rect]);
      assert.equal(backend.sidebarSurface.transitionStatus("123", 7, 10), 1);
    }
  }
  const incomplete = await fixture({ sidebarVersion: 1, transitionVersion: 1, transitionAvailable: false }).load();
  assert.equal(typeof incomplete.sidebarSurface.apply, "function");
  assert.equal(incomplete.sidebarSurface.startTransition, undefined);
});

test("failed observer installation does not prevent native theme fallback", async () => {
  const f = fixture({ result: 2 }), backend = await f.load();
  assert.equal(backend.appearance, "dark");
  backend.shutdown();
  assert.deepEqual(f.calls, ["observe", "theme shutdown"]);
});

const littleRecord = { id: "little-default-v1", role: "little", theme: {}, material: "dark" };
test("the Little role requires the matching native material capability", async () => {
  for (const material of [false, true]) {
    const f = fixture({ material, themes: [{ id: "main", theme: {} }, littleRecord] });
    const backend = await f.load();
    assert.equal(backend.themes.size, 1);
    assert.equal(backend.little?.index, material ? 1 : undefined);
  }
});

test("ambiguous and invalid Little roles reject the bundle", async () => {
  for (const themes of [
    [littleRecord, littleRecord],
    [littleRecord, { id: littleRecord.id, theme: {} }],
    [{ ...littleRecord, role: "other" }],
    [{ ...littleRecord, material: "light" }],
    [{ ...littleRecord, id: "main" }],
  ]) assert.equal(await fixture({ themes }).load(), null);
});


test("optional native Little shadow uses the current ticket and bounded geometry request", async () => {
  const old = await fixture().load();
  assert.equal(old.syncLittleShadow, undefined);
  const f = fixture({ shadow: true }), backend = await f.load();
  const rect = [0, 0, 490, 128, 10, 490, 329];
  assert.equal(backend.syncLittleShadow("123", 7, rect), 0);
  assert.deepEqual(f.calls.at(-1), ["123", 7, ...rect]);
});

test("transparent Little panels require both geometry and the supported material capability", async () => {
  for (const shadow of [false, true]) {
    for (const panelVersion of [undefined, 0, 1, 2]) {
      const backend = await fixture({ shadow, panelVersion }).load();
      assert.equal(backend.littlePanel, shadow && panelVersion === 1);
    }
  }
});

test("unvalidated light Little panels keep the opaque fallback", async () => {
  const backend = await fixture({ shadow: true, panelVersion: 1, appearance: "light" }).load();
  assert.equal(backend.littlePanel, false);
});


test("native command fills require both the supported material and their optional capability", async () => {
  for (const panelVersion of [undefined,1]) for (const fillVersion of [undefined,0,1,2]) {
    const f = fixture({ shadow:true,panelVersion,fillVersion }), backend = await f.load();
    assert.equal(typeof backend.syncLittleFills, panelVersion===1&&fillVersion===1 ? "function" : "undefined");
    if (backend.syncLittleFills) {
      backend.syncLittleFills("123",7,{selected:null});
      assert.deepEqual(f.calls.at(-1),["123",7,'{"selected":null}']);
      backend.syncLittleFills("123",7,null); assert.deepEqual(f.calls.at(-1),["123",7,null]);
    }
  }
  const backend = await fixture({ shadow:true,panelVersion:1,fillVersion:1,fillAvailable:false }).load();
  assert.equal(backend.syncLittleFills, undefined);
});

function metricsFixture(measureScope) {
  const context = vm.createContext({ NativeThemeState, themeKey, WeakRef,
    Services: { appinfo: { OS: "Darwin" }, obs: { addObserver() {} } } });
  vm.runInContext(source, context);
  context.fakeMeasure = measureScope;
  vm.runInContext("loading = Promise.resolve({ measureScope: fakeMeasure });", context);
  return { measure: (...args) => context.measureNativeScopeLabel(...args), context };
}

test("scope metrics cache labels by display scale and evict old names at its bound", async () => {
  const calls = [], f = metricsFixture((text, scale) => {
    calls.push([text, scale]); return { width: 53, height: 16, weight: 510 };
  });
  await f.measure("YouTube", 2); await f.measure("YouTube", 2);
  assert.equal(calls.length, 1);
  await f.measure("YouTube", 1); assert.equal(calls.length, 2);
  for (let i = 0; i < 128; i++) await f.measure(`Custom ${i}`, 2);
  await f.measure("YouTube", 2); assert.equal(calls.length, 131);
});

test("scope metrics reject unsafe requests and invalid native results", async () => {
  let calls = 0;
  const f = metricsFixture(() => { calls++; return { width: 53, height: 16, weight: 510 }; });
  for (const text of [null, "", "x".repeat(513), "nul\0suffix"])
    assert.equal(await f.measure(text, 2), null);
  for (const scale of [NaN, Infinity, 0, 0.4, 9]) assert.equal(await f.measure("X", scale), null);
  assert.equal(calls, 0);
  for (const invalid of [null, { width: NaN, height: 16, weight: 510 },
    { width: -1, height: 16, weight: 510 }, { width: 53, height: 0, weight: 510 },
    { width: 53, height: 16, weight: 1001 }]) {
    assert.equal(await metricsFixture(() => invalid).measure("X", 2), null);
  }
  assert.equal(await metricsFixture(undefined).measure("X", 2), null);
  assert.equal(await metricsFixture(() => { throw new Error("native failure"); }).measure("X", 2), null);
  vm.runInContext("stopped = true", f.context);
  assert.equal(await f.measure("X", 2), null);
  assert.equal(calls, 0);
});
