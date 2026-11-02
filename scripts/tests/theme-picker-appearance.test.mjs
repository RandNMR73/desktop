import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../../src/zen/spaces/ZenGradientGenerator.mjs", import.meta.url), "utf8")
  .replace(/^import[\s\S]*?;\n/gm, "").replace("export class nsZenThemePicker", "class nsZenThemePicker");

function fixture() {
  const calls = [];
  const spaces = Array.from({ length: 5 }, (_, i) => ({ uuid: String(i), theme: {
    gradientColors: [{ c: [20 + i, 140, 210], isPrimary: true }], opacity: .4 + i / 20,
  } }));
  const context = { nsZenMultiWindowFeature: class {},
    Services: { prefs: { getBoolPref: () => false, addObserver() {} },
      obs: { addObserver() {}, notifyObservers: (_, topic) => calls.push(topic) } },
    ChromeUtils: { defineLazyGetter: (object, key, getter) => Object.defineProperty(object, key, { get: getter }) },
    gZenWorkspaces: { shouldHaveWorkspaces: false, getWorkspaces: () => spaces, getActiveWorkspace: () => spaces[2] },
    window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
    document: { getElementById: () => ({ min: .3, max: .8 }) },
    AppConstants: { platform: "macosx" }, PrivateBrowsingUtils: { isWindowPrivate: () => false },
  };
  const Picker = vm.runInNewContext(source + "\nnsZenThemePicker", context);
  const picker = new Picker();
  picker.invalidateGradientCache = uuid => calls.push(["invalidate", uuid]);
  picker.onWorkspaceChange = (...args) => calls.push(["render", ...args]);
  picker.updateCurrentWorkspace = () => assert.fail("appearance must not serialize editor controls");
  return { picker, spaces, calls };
}

test("appearance changes never serialize stale closed controls or an unfinished edit", () => {
  for (const open of [false, true]) {
    const { picker, spaces, calls } = fixture();
    picker.panel = { state: open ? "open" : "closed" };
    picker.updated = open;
    picker.currentOpacity = .73;
    picker.currentTexture = .625;
    picker.useAlgo = "analogous";
    picker.colorPad = { range: [.01, .425], workspace: spaces[4].uuid };
    const before = JSON.stringify({ spaces, pad: picker.colorPad });
    picker.handleDarkModeChange();
    assert.equal(JSON.stringify({ spaces, pad: picker.colorPad }), before);
    assert.equal(picker.updated, open);
    assert.equal(picker.currentOpacity, .73);
    assert.equal(picker.currentTexture, .625);
    assert.equal(picker.useAlgo, "analogous");
    assert.deepEqual(calls.filter(c => Array.isArray(c) && c[0] === "invalidate").map(c => c[1]), spaces.map(s => s.uuid));
    const render = calls.find(c => Array.isArray(c) && c[0] === "render");
    assert.deepEqual(render, ["render", spaces[2], true, null, false]);
    assert.ok(calls.includes("zen-space-gradient-update"));
    assert.ok(calls.includes("zen-theme-change"));
  }
});

test("rendering another Space uses its intensity without changing the editor's color state", () => {
  const { picker } = fixture();
  picker.currentOpacity = .73;
  picker.useAlgo = "analogous";
  for (const count of [0, 1, 2, 3]) {
    const colors = Array.from({ length: count }, (_, i) => ({ c: [30 + i * 40, 180, 200], algorithm: "floating", lightness: 10 }));
    for (const toolbar of [false, true]) {
      const output = picker.getGradient(colors, toolbar, .4);
      assert.equal(picker.currentOpacity, .73);
      assert.equal(picker.useAlgo, "analogous");
      picker.currentOpacity = .4;
      assert.equal(output, picker.getGradient(colors, toolbar));
      picker.currentOpacity = .73;
    }
  }
});

test("synchronizing opened controls adopts the saved theme's settings", () => {
  const { picker } = fixture();
  picker.syncColorSettings({ opacity: .65, texture: .25, gradientColors: [{ algorithm: "complementary", lightness: 72 }] });
  assert.equal(picker.currentOpacity, .65);
  assert.equal(picker.currentTexture, .25);
  assert.equal(picker.useAlgo, "complementary");
});
