import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../../src/zen/kbs/ZenKeyboardShortcuts.mjs", import.meta.url),
  "utf8",
)
  .replace(/^import .*;\n/m, "")
  .replace(/^export /gm, "");
const defaults = [
  [
    "zen-toggle-pin-tab",
    "d",
    { accel: true, shift: true },
    "cmd_zenTogglePinTab",
  ],
  ["addBookmarkAsKb", "d", { accel: true }, "Browser:AddBookmarkAs"],
  [
    "key_privatebrowsing",
    "p",
    { accel: true, shift: true },
    "Tools:PrivateBrowsing",
  ],
  [
    "zen-new-unsynced-window",
    "n",
    { accel: true, shift: true },
    "cmd_zenNewNavigatorUnsynced",
  ],
  [
    "zen-split-view-vertical",
    "v",
    { accel: true, alt: true },
    "cmd_zenSplitViewVertical",
  ],
  [
    "zen-new-empty-split-view",
    "*",
    { accel: true, shift: true },
    "cmd_zenNewEmptySplit",
  ],
  [
    "zen-split-view-unsplit",
    "u",
    { accel: true, alt: true },
    "cmd_zenSplitViewUnsplit",
  ],
];
function fixture(platform = "macosx") {
  let version = 23;
  const context = vm.createContext({
    window: {},
    AppConstants: { platform },
    console,
    Services: {
      prefs: {
        getIntPref: () => version,
        setIntPref: (_, v) => {
          version = v;
        },
      },
    },
  });
  vm.runInContext(source, context);
  const api = vm.runInContext(
    "({KeyShortcut, nsKeyShortcutModifiers, nsZenKeyboardShortcutsVersioner})",
    context,
  );
  const make = (id, key, mods, action = id) =>
    new api.KeyShortcut(
      id,
      key,
      "",
      "other",
      api.nsKeyShortcutModifiers.fromObject(mods),
      action,
      "",
    );
  const data = defaults.map((row) => make(...row));
  const versioner = new api.nsZenKeyboardShortcutsVersioner();
  const byId = (id) => data.find((s) => s.getID() === id);
  const snapshot = () => JSON.stringify(data.map((s) => s.toJSONForm()));
  return {
    data,
    byId,
    make,
    snapshot,
    versioner,
    get version() {
      return version;
    },
  };
}

test("upgrades stock macOS bindings as conflict-free pairs and persists version 24", () => {
  const f = fixture();
  f.versioner.migrateIfNeeded(f.data);
  assert.equal(f.version, 24);
  const expected = {
    "zen-toggle-pin-tab": "⌘ D",
    addBookmarkAsKb: "⌘ ⇧ D",
    key_privatebrowsing: "⌘ ⇧ N",
    "zen-new-unsynced-window": "⌘ ⇧ P",
    "zen-split-view-vertical": "⌘ ⌥ V",
    "zen-new-empty-split-view": "⌃ ⇧ +",
    "zen-split-view-unsplit": "",
    "zen-split-view-close-pane": "⌃ ⇧ -",
  };
  for (const [id, display] of Object.entries(expected))
    assert.equal(f.byId(id).toDisplayString(), display);
  assert.equal(new Set(f.data.map((s) => s.toDisplayString())).size, 8);
  const after = f.snapshot();
  f.versioner.migrateIfNeeded(f.data);
  assert.equal(f.snapshot(), after);
});

test("customized or disabled members preserve their coupled shortcuts", () => {
  for (const mode of ["custom", "disabled", "action"]) {
    const f = fixture(),
      pin = f.byId("zen-toggle-pin-tab");
    if (mode === "custom") pin.setNewBinding("k");
    if (mode === "disabled") pin.setDisabled(true);
    if (mode === "action") pin._setAction("customCommand");
    const before = JSON.stringify(
      f.data.slice(0, 2).map((s) => s.toJSONForm()),
    );
    f.versioner.migrateIfNeeded(f.data);
    assert.equal(
      JSON.stringify(f.data.slice(0, 2).map((s) => s.toJSONForm())),
      before,
    );
    assert.equal(f.byId("key_privatebrowsing").toDisplayString(), "⌘ ⇧ N");
  }
});

test("a custom destination conflict preserves both members, including meta aliases", () => {
  const f = fixture();
  f.data.push(f.make("custom", "n", { meta: true, shift: true }));
  f.versioner.migrateIfNeeded(f.data);
  assert.equal(f.byId("key_privatebrowsing").toDisplayString(), "⌘ ⇧ P");
  assert.equal(f.byId("zen-new-unsynced-window").toDisplayString(), "⌘ ⇧ N");
  assert.equal(f.byId("zen-toggle-pin-tab").toDisplayString(), "⌘ D");
});

test("already configured Arc bindings remain intact", () => {
  const f = fixture();
  f.versioner.migrateIfNeeded(f.data);
  const before = f.snapshot();
  f.versioner.migrateIfNeeded(f.data);
  assert.equal(f.snapshot(), before);
});

test("a missing pair member cannot leave a partial shortcut swap", () => {
  const f = fixture();
  f.data.splice(f.data.indexOf(f.byId("addBookmarkAsKb")), 1);
  f.versioner.migrateIfNeeded(f.data);
  assert.equal(f.byId("zen-toggle-pin-tab").toDisplayString(), "⌘ ⇧ D");
});

test("non-macOS profiles keep their existing shortcuts", () => {
  for (const platform of ["linux", "win"]) {
    const f = fixture(platform),
      before = f.snapshot();
    f.versioner.migrateIfNeeded(f.data);
    assert.equal(f.snapshot(), before);
    assert.equal(f.version, 24);
  }
});

test("repairs the earlier overlay that incorrectly split neighboring tabs", () => {
  const f = fixture();
  f.byId("zen-split-view-vertical").setNewBinding("+");
  // Use the real modifier class through a temporary Ctrl+Shift binding.
  const controlShift = f
    .make("temporary", "+", { ctrl: true, shift: true })
    .getModifiers();
  f.byId("zen-split-view-vertical").setModifiers(controlShift);
  f.versioner.migrateIfNeeded(f.data);
  assert.equal(f.byId("zen-split-view-vertical").toDisplayString(), "⌘ ⌥ V");
  assert.equal(f.byId("zen-new-empty-split-view").toDisplayString(), "⌃ ⇧ +");
});

test("macOS Control-Shift punctuation registers the produced key without changing its label", () => {
  const f = fixture();
  f.versioner.migrateIfNeeded(f.data);
  const shortcut = f.byId("zen-split-view-close-pane");
  const attributes = new Map();
  shortcut.replaceWithChild({
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: (key) => attributes.delete(key),
  });
  assert.equal(attributes.get("key"), "_");
  assert.equal(attributes.get("modifiers"), "control,shift");
  assert.equal(shortcut.getKeyName(), "-");
  assert.equal(shortcut.toDisplayString(), "⌃ ⇧ -");
  for (const mods of [
    { ctrl: true },
    { accel: true, shift: true },
    { meta: true, shift: true },
  ]) {
    f.make("custom", "-", mods).replaceWithChild({
      setAttribute: (key, value) => attributes.set(key, value),
      removeAttribute: (key) => attributes.delete(key),
    });
    assert.equal(attributes.get("key"), "-");
  }
});


test("a shifted-symbol destination conflict preserves the existing command", () => {
  const f = fixture();
  f.data.push(f.make("custom", "_", {ctrl:true,shift:true}));
  f.versioner.migrateIfNeeded(f.data);
  assert.equal(f.byId("zen-split-view-unsplit").toDisplayString(), "⌘ ⌥ U");
});


test("stock page-source alias does not prevent the distinct close-pane shortcut", () => {
  const f = fixture();
  f.data.push(f.make("key_viewSourceSafari", "u", {accel:true,alt:true}, "View:PageSource"));
  f.versioner.migrateIfNeeded(f.data);
  assert.equal(f.byId("zen-split-view-close-pane").toDisplayString(), "⌃ ⇧ -");
  assert.equal(f.byId("zen-split-view-unsplit").toDisplayString(), "");
  assert.equal(f.byId("key_viewSourceSafari").toDisplayString(), "⌘ ⌥ U");
});
