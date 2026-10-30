import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { NativeThemeState, themeKey } from "../../src/zen/spaces/ZenNativeThemeState.mjs";

const source = readFileSync(new URL("../../src/zen/spaces/ZenNativeTheme.sys.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\n/m, "").replaceAll("export function", "function")
  .replaceAll("export async function", "async function");

function fixture({ observer = true, result = 0, material = true, themes } = {}) {
  const calls = [];
  const api = {
    zen_theme_version: () => 1,
    zen_theme_apply() {}, zen_theme_activate() {}, zen_theme_clear() {}, zen_theme_status() {},
    zen_theme_shutdown: () => calls.push("theme shutdown"),
    zen_popover_sync_appearance: () => 0,
  };
  if (material) api.zen_theme_material_version = () => 1;
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
      version: 1, appearance: "dark", themes: themes ?? [{ id: "main", theme: {} }],
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
