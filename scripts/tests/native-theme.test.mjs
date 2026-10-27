import assert from "node:assert/strict";
import test from "node:test";
import { NativeThemeState, themeKey } from "../../src/zen/spaces/ZenNativeThemeState.mjs";

function fixture() {
  let current = "main", shown = false, fail = false;
  const calls = [];
  const state = new NativeThemeState({
    apply: (...args) => { calls.push(args); return fail ? 1 : 0; },
    clear() {}, activate: () => fail ? 1 : 0,
  }, "123", value => { shown = value; }, key => current === key);
  return { state, calls, get shown() { return shown; },
    select(key) { current = key; state.apply(key, key === "main" ? 0 : 1); },
    fail() { fail = true; } };
}

test("CSS remains until the matching GPU completion, duplicate refresh is free", () => {
  const f = fixture();
  f.select("main");
  assert.equal(f.shown, false);
  f.state.complete(f.state.ticket, 0);
  assert.equal(f.shown, true);
  f.select("main");
  assert.equal(f.calls.length, 1);
  assert.equal(f.shown, true);
});

test("a delayed old frame cannot reveal the wrong Space", () => {
  const f = fixture();
  f.select("main");
  const old = f.state.ticket;
  f.select("apt");
  f.state.complete(old, 0);
  assert.equal(f.shown, false);
  f.state.complete(f.state.ticket, 0);
  assert.equal(f.shown, true);
});

test("unknown or edited themes clear both pending and visible surfaces", () => {
  for (const ready of [false, true]) {
    const f = fixture();
    f.select("main");
    const old = f.state.ticket;
    if (ready) f.state.complete(old, 0);
    f.select(null);
    f.state.complete(old, 0);
    assert.equal(f.shown, false);
    assert.equal(f.state.key, null);
  }
});

test("submission, GPU, and activation failures leave CSS available", () => {
  for (const phase of ["submission", "gpu", "activation"]) {
    const f = fixture();
    if (phase === "submission") f.fail();
    f.select("main");
    if (phase === "activation") f.fail();
    f.state.complete(f.state.ticket, phase === "gpu" ? -1 : 0);
    assert.equal(f.shown, false);
    assert.equal(f.state.key, null);
  }
});

test("late render failure restores CSS after the first successful frame", () => {
  const f = fixture();
  f.select("main");
  f.state.complete(f.state.ticket, 0);
  f.state.complete(f.state.ticket, -1);
  assert.equal(f.shown, false);
});

test("close ignores queued completions and future requests", () => {
  const f = fixture();
  f.select("main");
  f.state.close();
  f.state.complete(f.state.ticket, 0);
  f.select("apt");
  assert.equal(f.shown, false);
  assert.equal(f.calls.length, 1);
});

test("native handle replacement forces a new frame", () => {
  const f = fixture();
  f.select("main");
  const old = f.state.ticket;
  f.state.complete(old, 0);
  f.state.apply("main", 0, true);
  assert.equal(f.shown, false);
  f.state.complete(old, 0);
  assert.equal(f.shown, false);
  f.state.complete(f.state.ticket, 0);
  assert.equal(f.shown, true);
});

test("only picker positions are ignored when matching the saved theme", () => {
  const original = { type: "gradient", texture: .8, opacity: .7,
    gradientColors: [{ c: [0, 128, 255], algorithm: "floating", isPrimary: true }] };
  const withPosition = structuredClone(original);
  withPosition.gradientColors[0].position = { x: 188, y: 191 };
  assert.equal(themeKey(original), themeKey(withPosition));
  assert.equal(themeKey(original), themeKey(Object.fromEntries(Object.entries(original).reverse())));
  for (const edit of [t => t.texture++, t => t.opacity++, t => t.type = "solid",
    t => t.gradientColors[0].c[0]++, t => t.gradientColors[0].algorithm = "other",
    t => t.gradientColors[0].isPrimary = false, t => t.extra = true]) {
    const edited = structuredClone(original); edit(edited);
    assert.notEqual(themeKey(original), themeKey(edited));
  }
  assert.equal("position" in original.gradientColors[0], false);
});
