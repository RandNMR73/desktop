import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  developerRing,
  ZenDeveloperSidebar,
} from "../../src/zen/urlbar/ZenDeveloperSidebar.sys.mjs";

test("developer outline follows the measured AppKit path and dash breakpoints", () => {
  const ring = developerRing(218, 36);
  assert.equal(
    ring.path,
    "M12 35 C5.92492 35 1 30.07508 1 24 L1 12 C1 5.92492 5.92492 1 12 1 L206 1 C212.07508 1 217 5.92492 217 12 L217 24 C217 30.07508 212.07508 35 206 35 Z",
  );
  assert.equal(ring.viewBox, "0 0 218 36");
  for (const [width, count] of [
    [211, 60],
    [212, 80],
    [347, 80],
    [348, 100],
  ]) {
    const measuredPerimeter = 2 * (width - 2) + 68 - 88 + 69.11503837897544;
    assert.equal(developerRing(width, 36).dash, measuredPerimeter / count);
  }
  for (const size of [0, 23, NaN, Infinity, -5]) {
    assert.equal(developerRing(size, 36), null);
    assert.equal(developerRing(218, size), null);
  }
});

function fixture() {
  let writes = 0,
    allocations = 0,
    observer;
  class Element {
    children = [];
    attributes = new Map();
    classList = { add() {} };
    append(child) {
      this.children.push(child);
      child.parent = this;
      writes++;
    }
    setAttribute(k, v) {
      this.attributes.set(k, v);
      writes++;
    }
    hasAttribute(k) {
      return this.attributes.has(k);
    }
    removeAttribute(k) {
      this.attributes.delete(k);
      writes++;
    }
    remove() {
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
      writes++;
    }
    set textContent(value) {
      this.text = value;
      writes++;
    }
  }
  const window = {
    document: {
      createElement: () => new Element(),
      createElementNS: () => new Element(),
    },
    ResizeObserver: class {
      targets = new Set();
      constructor(callback) {
        this.callback = callback;
        observer = this;
        allocations++;
      }
      observe(target) {
        this.targets.add(target);
      }
      unobserve(target) {
        this.targets.delete(target);
      }
      disconnect() {
        this.targets.clear();
      }
    },
  };
  const tab = () => {
    const t = new Element(),
      background = new Element(),
      labels = new Element();
    t.isConnected = true;
    t.querySelector = (s) => (s === ".tab-background" ? background : labels);
    return { t, background, labels };
  };
  return {
    sidebar: new ZenDeveloperSidebar(window),
    tab,
    get writes() {
      return writes;
    },
    get allocations() {
      return allocations;
    },
    get observer() {
      return observer;
    },
  };
}

test("only developer tabs allocate visuals; updates reuse nodes and one observer", () => {
  const f = fixture(),
    a = f.tab(),
    b = f.tab();
  f.sidebar.update(a.t, "");
  assert.equal(f.allocations, 0);
  assert.equal(f.writes, 0);
  f.sidebar.update(a.t, "localhost:3000");
  f.sidebar.update(b.t, "example.com");
  assert.equal(f.allocations, 1);
  assert.equal(f.observer.targets.size, 2);
  const writes = f.writes;
  f.sidebar.update(a.t, "localhost:3000");
  assert.equal(f.writes, writes);
  f.sidebar.update(a.t, "localhost:4000");
  assert.equal(a.labels.children[0].text, "localhost:4000");
  assert.equal(a.labels.children.length, 1);
  f.observer.callback([
    { target: a.background, contentRect: { width: 218, height: 36 } },
  ]);
  assert.equal(
    a.background.children[0].attributes.get("viewBox"),
    "0 0 218 36",
  );
  const sizedWrites = f.writes;
  f.observer.callback([
    { target: a.background, contentRect: { width: 218, height: 36 } },
  ]);
  assert.equal(f.writes, sizedWrites);
  f.sidebar.update(a.t, "");
  assert.equal(a.labels.children.length, 0);
  assert.equal(a.background.children.length, 0);
  assert.equal(a.t.attributes.has("zen-developer-tab"), false);
  assert.equal(f.observer.targets.size, 1);
  f.sidebar.destroy();
  assert.equal(f.observer.targets.size, 0);
  assert.equal(b.labels.children.length, 0);
  const destroyedWrites = f.writes;
  f.observer.callback([
    { target: b.background, contentRect: { width: 300, height: 36 } },
  ]);
  f.sidebar.destroy();
  assert.equal(f.writes, destroyedWrites);
});

test("closing or disconnected tabs release their visuals", () => {
  for (const state of ["closing", "isConnected"]) {
    const f = fixture(),
      a = f.tab();
    f.sidebar.update(a.t, "localhost");
    a.t[state] = state === "closing";
    f.sidebar.update(a.t, "localhost");
    assert.equal(a.background.children.length, 0);
    assert.equal(f.observer.targets.size, 0);
  }
});

test("Favorite outline matches the owned SwiftUI path fixtures and fixed six-point dashes", () => {
  const fixtures = JSON.parse(
    fs.readFileSync(
      new URL("./fixtures/developer-favorite-path.json", import.meta.url),
    ),
  );
  for (const fixture of fixtures) {
    const geometry = developerRing(fixture.width, fixture.height, true);
    assert.equal(geometry.dash, 6);
    const commands = geometry.path
      .match(/[MLCZ][^MLCZ]*/g)
      .map((command) => ({
        type: { M: 0, L: 1, C: 3, Z: 4 }[command[0]],
        points: command
          .slice(1)
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map(Number),
      }));
    assert.deepEqual(
      commands,
      fixture.path.map((command) => ({
        type: command.type,
        points: command.points.flat(),
      })),
    );
  }
});
