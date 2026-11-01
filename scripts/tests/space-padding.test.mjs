import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../../src/zen/spaces/ZenSpaceManager.mjs", import.meta.url),
  "utf8",
);
const method = source
  .slice(
    source.indexOf("  #updatePaddingTopOnTabs("),
    source.indexOf("  #setAnimatingBackground("),
  )
  .replace("#updatePaddingTopOnTabs", "update");

function fixture() {
  const frames = new Map(),
    cancelled = [];
  let nextId = 0,
    reads = 0;
  const context = vm.createContext({
    window: {
      windowUtils: {
        getBoundsWithoutFlushing(container) {
          reads++;
          return { height: container.height };
        },
      },
    },
    requestAnimationFrame(callback) {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      cancelled.push(id);
      frames.delete(id);
    },
  });
  const Manager = vm.runInContext(
    `(class {
    #inChangingWorkspace = false;
    #pendingPaddingUpdates = new WeakMap();
    changing(value) { this.#inChangingWorkspace = value; }
    ${method}
  })`,
    context,
  );
  return {
    manager: new Manager(),
    frames,
    cancelled,
    get reads() {
      return reads;
    },
    flush() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    },
  };
}
const space = (paddingTop = "20px") => ({
  style: { paddingTop },
  isConnected: true,
});

test("settled Favorites height does not schedule another padding write", () => {
  const f = fixture(),
    node = space();
  for (let i = 0; i < 10; i++) f.manager.update(node, { height: 20 });
  assert.equal(
    f.reads,
    10,
    "read current bounds so later height changes remain visible",
  );
  assert.equal(f.frames.size, 0);
  assert.equal(node.style.paddingTop, "20px");
});

test("repeated resize notifications share one deferred write per Space", () => {
  const f = fixture(),
    node = space();
  for (let i = 0; i < 10; i++) f.manager.update(node, { height: 24.5 });
  assert.equal(f.frames.size, 1);
  assert.equal(
    node.style.paddingTop,
    "20px",
    "preserve deferred layout mutation",
  );
  f.flush();
  assert.equal(node.style.paddingTop, "24.5px");
  f.manager.update(node, { height: 24.5 });
  assert.equal(f.frames.size, 0);
});

test("a newer height replaces pending work and returning to the current height cancels it", () => {
  const f = fixture(),
    node = space();
  f.manager.update(node, { height: 30 });
  f.manager.update(node, { height: 40 });
  assert.equal(f.frames.size, 1);
  assert.equal(f.cancelled.length, 1);
  f.manager.update(node, { height: 20 });
  assert.equal(f.frames.size, 0);
  assert.equal(f.cancelled.length, 2);
  f.flush();
  assert.equal(node.style.paddingTop, "20px");
});

test("Spaces maintain independent heights including the minimum and fractional bounds", () => {
  const f = fixture(),
    nodes = [space(), space()];
  f.manager.update(nodes[0], { height: 0 });
  f.manager.update(nodes[1], { height: 81.25 });
  assert.equal(f.frames.size, 2);
  f.flush();
  assert.deepEqual(
    nodes.map((n) => n.style.paddingTop),
    ["2px", "81.25px"],
  );
});

test("Space transition gates and the one-shot animation override still apply", () => {
  const f = fixture(),
    node = space();
  f.manager.changing(true);
  f.manager.update(node, { height: 35 });
  assert.equal(f.reads, 0);
  f.manager.update(node, { height: 35 }, true);
  f.flush();
  assert.equal(node.style.paddingTop, "35px");
  f.manager._alwaysAnimatePaddingTop = true;
  f.manager.update(node, { height: 45 });
  assert.equal("_alwaysAnimatePaddingTop" in f.manager, false);
  f.flush();
  assert.equal(node.style.paddingTop, "45px");
});

test("a removed Space is not mutated when its queued frame runs", () => {
  const f = fixture(),
    node = space();
  f.manager.update(node, { height: 35 });
  node.isConnected = false;
  f.flush();
  assert.equal(node.style.paddingTop, "20px");
  node.isConnected = true;
  f.manager.update(node, { height: 40 });
  f.flush();
  assert.equal(node.style.paddingTop, "40px");
});
