import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../../src/zen/spaces/ZenGradientGenerator.mjs", import.meta.url), "utf8");
const harmonies = source.slice(source.indexOf("  get colorHarmonies()"), source.indexOf("  initContextMenu()"));
const calculate = source.slice(source.indexOf("  calculateCompliments("), source.indexOf("  handleColorPositions("));
const serialize = source.slice(source.indexOf("  getJSONPos("), source.indexOf("  createDot("));
const Picker = vm.runInNewContext(`(class nsZenThemePicker {
  static MAX_DOTS = 3;
  ${harmonies}
  ${calculate}
  ${serialize}
})`, { window: { windowUtils: { getBoundsWithoutFlushing: () => ({ width: 360, height: 360 }) } } });

function fixture(type = "analogous", angle = 0) {
  const picker = new Picker();
  picker.useAlgo = type;
  picker.panel = { querySelector: () => ({}) };
  picker.dots = [{ ID: 0, position: { x: 180 + 100 * Math.cos(angle * Math.PI / 180), y: 180 + 100 * Math.sin(angle * Math.PI / 180) }, type: "explicit-lightness" }];
  return picker;
}

function offsets(picker) {
  const angles = picker.dots.map(d => (Math.atan2(d.position.y - 180, d.position.x - 180) * 180 / Math.PI + 360) % 360);
  return angles.map(a => Math.round((a - angles[0] + 360) % 360));
}

function add(picker) {
  picker.dots = picker.calculateCompliments(picker.dots, "add", picker.useAlgo);
}

function remove(picker) {
  picker.dots.pop();
  picker.dots = picker.calculateCompliments(picker.dots, "remove");
}

test("analogous wheel uses Arc's +40 and -40 degree relationships for arbitrary hues", () => {
  for (const angle of [0, 23, 122, 219, 340]) {
    const picker = fixture("analogous", angle);
    add(picker);
    assert.deepEqual(Array.from(offsets(picker)), [0, 40]);
    add(picker);
    assert.deepEqual(Array.from(offsets(picker)), [0, 40, 320]);
    assert.equal(picker.useAlgo, "analogous");
    for (const dot of picker.dots) {
      assert.ok(Math.abs(Math.hypot(dot.position.x - 180, dot.position.y - 180) - 100) < 1e-9);
      assert.equal(dot.type, "explicit-lightness");
    }
  }
});

test("removing and restoring points keeps the selected wheel through one color", () => {
  for (const [type, two, three] of [["analogous", [0, 40], [0, 40, 320]], ["complementary", [0, 180], [0, 150, 210]]]) {
    const picker = fixture(type, 47);
    add(picker); add(picker);
    for (let cycle = 0; cycle < 3; cycle++) {
      remove(picker);
      assert.deepEqual(Array.from(offsets(picker)), two);
      remove(picker);
      assert.equal(picker.dots.length, 1);
      add(picker);
      assert.deepEqual(Array.from(offsets(picker)), two);
      add(picker);
      assert.deepEqual(Array.from(offsets(picker)), three);
    }
  }
});

test("moving a three-color selection preserves its family and does not mutate input", () => {
  const picker = fixture("analogous", 200);
  add(picker); add(picker);
  const before = JSON.stringify(picker.dots);
  const positions = picker.calculateCompliments(picker.dots, "update", picker.useAlgo);
  assert.equal(JSON.stringify(picker.dots), before);
  picker.dots = positions;
  assert.deepEqual(Array.from(offsets(picker)), [0, 40, 320]);
});

test("empty and unknown legacy selections do not throw or exceed three points", () => {
  const picker = fixture("float");
  assert.deepEqual(Array.from(picker.calculateCompliments([], "remove")), []);
  add(picker); add(picker); add(picker);
  assert.equal(picker.dots.length, 3);
  assert.deepEqual(Array.from(offsets(picker)), [0, 150, 210]);
});

test("existing triadic selections keep their established relationship", () => {
  const picker = fixture("triadic");
  picker.dots.push({ ID: 1, position: { x: 120, y: 100 } }, { ID: 2, position: { x: 120, y: 260 } });
  picker.dots = picker.calculateCompliments(picker.dots, "update", "triadic");
  assert.deepEqual(Array.from(offsets(picker)), [0, 120, 240]);
});

test("free-position imported colors are not rearranged when a point moves", () => {
  const picker = fixture("floating");
  picker.dots.push({ ID: 1, position: { x: 100, y: 220 } }, { ID: 2, position: { x: 90, y: 20 } });
  const before = JSON.stringify(picker.dots);
  picker.dots = picker.calculateCompliments(picker.dots, "update", "floating");
  assert.equal(JSON.stringify(picker.dots), before);
  assert.equal(picker.useAlgo, "floating");
});

test("saving and reopening points near the center does not change their angles", () => {
  const picker = fixture("analogous", 17);
  picker.dots[0].position = { x: 180.35, y: 180.17 };
  add(picker); add(picker);
  const before = JSON.stringify(picker.dots);
  for (const dot of picker.dots) {
    dot.position = JSON.parse(picker.getJSONPos(dot.position.x, dot.position.y));
  }
  assert.equal(JSON.stringify(picker.dots), before);
  assert.deepEqual(Array.from(offsets(picker)), [0, 40, 320]);
});
