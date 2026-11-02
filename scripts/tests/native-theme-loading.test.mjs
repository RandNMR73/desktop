import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { NativeThemeState, themeKey, dynamicThemeRequest } from "../../src/zen/spaces/ZenNativeThemeState.mjs";
import * as paletteAPI from "../../src/zen/spaces/ZenSpacePalette.mjs";

const source = readFileSync(new URL("../../src/zen/spaces/ZenNativeTheme.sys.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "").replaceAll("export function", "function")
  .replaceAll("export async function", "async function");

function fixture({ dynamicVersion, dynamicAvailable = true, observer = true, result = 0, material = true, shadow = false, panelVersion, fillVersion, fillAvailable = true, appearance = "dark", themes, sidebarVersion, transitionVersion, transitionAvailable = true, commandVersion, commandClear = true } = {}) {
  const calls = [];
  const api = {
    zen_theme_version: () => 1,
    zen_theme_apply() {}, zen_theme_activate() {}, zen_theme_clear() {}, zen_theme_status() {},
    zen_theme_shutdown: () => calls.push("theme shutdown"),
    zen_popover_sync_appearance: () => 0,
  };
  if (dynamicVersion !== undefined) api.zen_theme_dynamic_version = () => dynamicVersion;
  if (dynamicAvailable) api.zen_theme_apply_colors = (...args) => { calls.push(args); return 0; };
  if (shadow) api.zen_little_shadow_sync = (...args) => { calls.push(args); return 0; };
  if (panelVersion !== undefined) api.zen_little_panel_version = () => panelVersion;
  if (fillVersion !== undefined) api.zen_little_fills_version = () => fillVersion;
  if (fillAvailable) api.zen_little_fills_sync = (...args) => { calls.push(args); return 0; };
  if (commandVersion !== undefined) {
    api.zen_command_popup_version = () => commandVersion;
    api.zen_command_popup_sync = (...args) => { calls.push(args); return 0; };
    if (commandClear) api.zen_command_popup_clear = (...args) => { calls.push(args); return 0; };
  }
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
  const context = vm.createContext({ ...paletteAPI, NativeThemeState, themeKey, dynamicThemeRequest, WeakRef, structuredClone,
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
  const context = vm.createContext({ ...paletteAPI, NativeThemeState, themeKey, dynamicThemeRequest, WeakRef, structuredClone,
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


test("Space icon palettes require matching identity and complete unchanged theme", async () => {
  const theme = { gradientColors: [{ c: [4, 50, 200], isPrimary: true }] };
  const palette = { light: [-.1, .2, .4, 1], dark: [.8, .9, 1.02, 1] };
  const f = metricsFixture();
  f.context.injected = { themes: new Map([["space", { key: themeKey(theme), spaceIconPalette: palette }]]) };
  vm.runInContext("loading = Promise.resolve(injected)", f.context);
  const resolve = workspace => f.context.nativeSpaceIconPalette(workspace);
  assert.deepEqual(await resolve({ uuid: "space", theme }), palette);
  assert.equal(await resolve({ uuid: "another", theme }), null);
  assert.equal(await resolve({ uuid: "space", theme: { ...theme, texture: .9 } }), null);
  assert.equal(await resolve(null), null);
  const moved = structuredClone(theme);
  moved.gradientColors[0].position = { x: 4, y: 7 };
  assert.deepEqual(await resolve({ uuid: "space", theme: moved }), palette);
  vm.runInContext("stopped = true", f.context);
  assert.equal(await resolve({ uuid: "space", theme }), null);
});

test("original color-pad colors are isolated copies bound to an unchanged imported theme", async () => {
  const theme = { gradientColors: [{ c: [4, 50, 200], isPrimary: true }] };
  const colorPad = { version: 1, colors: [{ space: "srgb", rgb: [-.2, .5, .8] }], wheel: "analogous" };
  const f = metricsFixture();
  f.context.injected = { themes: new Map([["space", { key: themeKey(theme), colorPad }]]) };
  vm.runInContext("loading = Promise.resolve(injected)", f.context);
  const resolve = workspace => f.context.nativeSpaceColorPad(workspace);
  const result = await resolve({ uuid: "space", theme });
  assert.deepEqual(result, colorPad);
  result.colors[0].rgb[0] = 0;
  assert.equal((await resolve({ uuid: "space", theme })).colors[0].rgb[0], -.2);
  assert.equal(await resolve({ uuid: "another", theme }), null);
  assert.equal(await resolve({ uuid: "space", theme: { ...theme, texture: .8 } }), null);
  vm.runInContext("stopped = true", f.context);
  assert.equal(await resolve({ uuid: "space", theme }), null);
});


test("live native colors require the optional capability and serialize without clipping", async () => {
  for (const dynamicVersion of [undefined, 0, 1, 2]) {
    const f = fixture({ dynamicVersion }), backend = await f.load();
    assert.equal(backend.dynamic, dynamicVersion === 1);
    const request = { version: 1, colors: [[1, .123456789, 0]] };
    assert.equal(backend.apply("123", request, 4), dynamicVersion === 1 ? 0 : 1);
    if (dynamicVersion === 1) assert.deepEqual(f.calls.at(-1), ["123", 4, JSON.stringify(request)]);
  }
  const backend = await fixture({ dynamicVersion: 1, dynamicAvailable: false }).load();
  assert.equal(backend.dynamic, false);
});

const paletteCases = JSON.parse(readFileSync(new URL('./fixtures/space-palettes.json', import.meta.url))).cases;
test('full native palettes preserve unchanged imports and recalculate edited and new Spaces', async () => {
  const f = metricsFixture(), saved = paletteCases[0].palette, edited = paletteCases[1].palette;
  const theme = { type: 'gradient', gradientColors: [{ c: [0,165,214], p3: [.1,.6,.8], isPrimary: true }] };
  const calls = [];
  f.context.injected = { themes: new Map([['space', { key: themeKey(theme), palette: saved }]]),
    spacePalette: input => { calls.push(input); return edited; } };
  vm.runInContext('loading = Promise.resolve(injected)', f.context);
  assert.deepEqual(await f.context.nativeSpacePalette({ uuid: 'space', theme }), saved);
  assert.equal(calls.length, 0);
  const changed = structuredClone(theme); changed.gradientColors[0].p3 = [1,.2,0];
  assert.deepEqual(await f.context.nativeSpacePalette({ uuid: 'space', theme: changed }), edited);
  assert.deepEqual(calls[0].rgb, [1,.2,0]);
  assert.deepEqual(await f.context.nativeSpacePalette({ uuid: 'new-space', theme: changed }), edited);
  changed.texture = .2; changed.opacity = .7;
  await f.context.nativeSpacePalette({ uuid: 'new-space', theme: changed });
  assert.equal(calls.length, 1, 'identical primary colors share the bounded process cache');
  const icon = await f.context.nativeSpaceIconPalette({ uuid: 'new-space', theme: changed });
  assert.deepEqual(icon.light, edited.light.maxContrastColor);
  assert.deepEqual(icon.dark, edited.dark.maxContrastColor);
  assert.deepEqual(await f.context.nativeSpacePalette({ uuid: 'space', theme }), saved);
  for (let i = 0; i < 129; i++) {
    changed.gradientColors[0].p3 = [i/128,.3,.4];
    await f.context.nativeSpacePalette({ uuid: 'new-space', theme: changed });
  }
  changed.gradientColors[0].p3 = [1,.2,0];
  await f.context.nativeSpacePalette({ uuid: 'new-space', theme: changed });
  assert.equal(calls.length, 131);
  vm.runInContext('stopped = true', f.context);
  assert.equal(await f.context.nativeSpacePalette({ uuid: 'space', theme }), null);
});

test('unavailable or malformed native palettes retain the fallback', async () => {
  for (const calculate of [undefined, () => null, () => ({}), () => { throw new Error('failed'); }]) {
    const f = metricsFixture(); f.context.injected = { themes: new Map(), spacePalette: calculate };
    vm.runInContext('loading = Promise.resolve(injected)', f.context);
    assert.equal(await f.context.nativeSpacePalette({ uuid: 'new', theme: {
      type: 'gradient', gradientColors: [{ p3: [1,0,0], c: [255,0,0] }],
    } }), null);
  }
});

function commandSurfaceFixture({ result = 0, available = true } = {}) {
  const f = metricsFixture(), calls = [];
  f.context.Ci = { nsIBaseWindow: 1 };
  f.context.injected = { commandPopup: available ? {
    sync: (handle, request) => { calls.push(['sync', handle, structuredClone(request)]); return result; },
    clear: handle => calls.push(['clear', handle]),
  } : undefined };
  vm.runInContext('loading = Promise.resolve(injected)', f.context);
  const element = (x, y, width, height, fill, radius = 6) => ({
    getBoundingClientRect: () => ({ x, y, width, height }),
    style: { width: `${width}px`, boxSizing: 'border-box', borderTopLeftRadius: `${radius}px`,
      getPropertyValue: () => fill },
  });
  const background = element(10, 20, 400, 200, 'rgb(22, 22, 22)', 14);
  const selected = element(20, 60, 380, 46, 'color(display-p3 1 0 0)');
  const results = element(20, 80, 380, 130, '');
  const pill = element(60, 40, 73, 24, 'color(display-p3 1 0 0)', 12);
  Object.assign(pill.style, { width: '53px', boxSizing: 'content-box',
    paddingLeft: '10px', paddingRight: '10px' });
  const elements = { '.urlbar-background': background, '#urlbar-results': results,
    '.urlbarView-row[selected]:not([stale])': selected, '#urlbar-search-mode-indicator': pill };
  const media = { matches: false }, nativeWindow = { nativeHandle: '123' };
  const window = { closed: false, mozInnerScreenX: 50, mozInnerScreenY: 100,
    matchMedia: () => media, getComputedStyle: e => e.style,
    gURLBar: { value: 'private query', querySelector: selector => elements[selector],
      hasAttribute: () => true },
    docShell: { treeOwner: { QueryInterface: () => nativeWindow } } };
  const panel = { ownerDocument: { defaultView: window }, state: 'open',
    getOuterScreenRect: () => ({ x: 60, y: 120, width: 400, height: 200 }) };
  return { ...f, calls, window, panel, media, nativeWindow, background, selected,
    surface: () => f.context.createNativeCommandSurface(window) };
}

test('command decorations keep P3 colors and clip scrolled rows without receiving query text', async () => {
  const f = commandSurfaceFixture(), surface = await f.surface();
  assert.equal(surface.eligible(), true);
  assert.equal(surface.sync(f.panel), true);
  const request = f.calls[0][2];
  assert.deepEqual(request.background.rect, [0, 0, 400, 200]);
  assert.deepEqual(request.clip, [10, 60, 380, 130]);
  assert.deepEqual(request.selected.rect, [10, 40, 380, 46]);
  assert.deepEqual(request.selected.color, { space: 'display-p3', rgba: [1,0,0,1] });
  assert.equal(request.pill.radius, 12, 'pill padding must not stretch its circular ends');
  assert.equal(JSON.stringify(request).includes('private query'), false);
  f.nativeWindow.nativeHandle = '456';
  assert.equal(surface.sync(f.panel), true);
  assert.deepEqual(f.calls[1], ['clear', '123']);
  assert.equal(f.calls[2][1], '456');
  surface.clear(); surface.clear();
  assert.deepEqual(f.calls.at(-1), ['clear', '456']);
  assert.equal(f.calls.length, 4);
});

test('command decorations restore CSS for inaccessible, translucent or unsupported layouts', async () => {
  const cases = [
    f => { f.media.matches = true; },
    f => { f.window._zenLittleWindowInput = true; },
    f => { f.window.closed = true; },
    f => { f.panel.state = 'closed'; },
    f => { f.panel.ownerDocument = { defaultView: {} }; },
    f => { f.background.style.getPropertyValue = () => 'rgba(22,22,22,.89)'; },
    f => { f.selected.style.getPropertyValue = () => 'oklch(.5 .2 25)'; },
    f => { f.selected.style.getPropertyValue = () => 'color(srgb -0.2 1 0)'; },
  ];
  for (const change of cases) {
    const f = commandSurfaceFixture(), surface = await f.surface();
    assert.equal(surface.sync(f.panel), true);
    change(f);
    assert.equal(surface.sync(f.panel), false);
    assert.deepEqual(f.calls.at(-1), ['clear', '123']);
    assert.equal(f.calls.length, 2);
  }
  const failed = commandSurfaceFixture({ result: 4 }), surface = await failed.surface();
  assert.equal(surface.sync(failed.panel), false);
  assert.deepEqual(failed.calls.at(-1), ['clear', '123']);
  assert.equal(await commandSurfaceFixture({ available: false }).surface(), null);
});


test("main command colors require a complete compatible native API", async () => {
  for (const commandVersion of [undefined, 0, 1, 2]) {
    const f = fixture({ commandVersion }), backend = await f.load();
    assert.equal(!!backend.commandPopup, commandVersion === 1);
    if (backend.commandPopup) {
      assert.equal(backend.commandPopup.sync("123", { selected: null }), 0);
      assert.deepEqual(f.calls.at(-1), ["123", '{"selected":null}']);
      backend.commandPopup.clear("123");
      assert.deepEqual(f.calls.at(-1), ["123"]);
    }
  }
  const old = await fixture({ commandVersion: 1, commandClear: false }).load();
  assert.equal(old.commandPopup, undefined);
});
