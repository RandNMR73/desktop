/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../../src/zen/common/modules/ZenHasPolyfill.mjs", import.meta.url),
  "utf8",
);
function fixture() {
  const frames = new Map(),
    attrs = new Set();
  let next = 0,
    callback,
    queries = 0,
    writes = 0,
    match = null;
  const win = {
    addEventListener() {},
    requestAnimationFrame(fn) {
      frames.set(++next, fn);
      return next;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  };
  const element = {
    ownerGlobal: win,
    querySelector() {
      queries++;
      return match;
    },
    hasAttribute(a) {
      return attrs.has(a);
    },
  };
  vm.runInNewContext(source, {
    window: win,
    MutationObserver: class {
      constructor(fn) {
        callback = fn;
      }
      observe() {}
      disconnect() {}
    },
    gZenCompactModeManager: {
      _canDebugLog: false,
      _setElementExpandAttribute(el, on, name) {
        writes++;
        on ? attrs.add(name) : attrs.delete(name);
      },
    },
  });
  const id = win.ZenHasPolyfill.observeSelectorExistence(
    element,
    [{ selector: "[open]" }],
    "expanded",
  );
  win.ZenHasPolyfill.connectObserver(id);
  return {
    api: win.ZenHasPolyfill,
    id,
    frames,
    attrs,
    mutate(n = 1) {
      for (let i = 0; i < n; i++) callback();
    },
    flush() {
      const fs = [...frames.values()];
      frames.clear();
      fs.forEach((f) => f());
    },
    set match(m) {
      match = m;
    },
    get queries() {
      return queries;
    },
    get writes() {
      return writes;
    },
  };
}
test("a burst of 100 mutations runs one query and uses the final DOM state", () => {
  const f = fixture();
  f.match = { tagName: "panel" };
  f.mutate(100);
  assert.equal(f.queries, 0);
  f.flush();
  assert.equal(f.queries, 1);
  assert.equal(f.writes, 1);
  assert.ok(f.attrs.has("expanded"));
});
test("unchanged state does not write an attribute or feed the observer again", () => {
  const f = fixture();
  f.match = { tagName: "panel" };
  f.mutate();
  f.flush();
  f.mutate(100);
  f.flush();
  assert.equal(f.queries, 2);
  assert.equal(f.writes, 1);
});
test("closing before the frame cancels expansion; menu-only matches do not expand", () => {
  const f = fixture();
  f.match = { tagName: "panel" };
  f.mutate();
  f.match = null;
  f.flush();
  assert.equal(f.writes, 0);
  f.match = { tagName: "menu" };
  f.mutate();
  f.flush();
  assert.equal(f.writes, 0);
});
test("disconnect and window teardown cancel pending frames", () => {
  const f = fixture();
  f.mutate();
  f.api.disconnectObserver(f.id);
  f.flush();
  assert.equal(f.queries, 0);
  f.api.connectObserver(f.id);
  f.mutate();
  f.api.destroy();
  f.flush();
  assert.equal(f.queries, 0);
});
