import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(
  new URL("../../src/zen/spaces/ZenSpacesSwipe.mjs", import.meta.url),
  "utf8"
)
  .replace(/^import .*;\n/gm, "")
  .replace("export class ZenSpacesSwipe", "class ZenSpacesSwipe");

function fixture(width = 230, options = {}) {
  const moves = [], libraryMoves = [], addMoves = [];
  const cleanup = [], switches = [], attrs = [];
  const backdrop = { style: { setProperty: (...args) => cleanup.push(args) } };
  const workspaces = {
    workspaceEnabled: true,
    getActiveWorkspaceFromCache: () => ({ uuid: "current" }),
    workspaceElement: () => backdrop,
    updateTabsContainers: () => cleanup.push("layout"),
    _organizeWorkspaceStripLocations: (_space, _move, offset) => moves.push(offset),
    changeWorkspaceShortcut: (...args) => {
      switches.push(args);
      return options.switchResult;
    },
    beginSpaceSwipe: () => options.presentation,
  };
  const context = vm.createContext({
    SimpleGestureEvent: { DIRECTION_RIGHT: 1 },
    document: {
      documentElement: { matches: () => false },
      getElementById: () => backdrop,
      querySelectorAll: () => [{ toggleAttribute: (...args) => attrs.push(args) }],
      addEventListener() {},
      removeEventListener() {},
    },
    window: { windowUtils: { getBoundsWithoutFlushing: () => ({ width }) } },
    ChromeUtils: {
      defineLazyGetter: (object, key, getter) =>
        Object.defineProperty(object, key, { get: getter }),
      defineESModuleGetters: object => {
        object.ZenLibrary = {
          swipeReset() {},
          isLibraryOpen: false,
          readySwipeOpenLibrary: () => !!options.library,
          libraryOnRight: false,
          startSwipe() {},
          swipeProgress: value => libraryMoves.push(value),
          swipeAnimationEnd() {},
        };
      },
    },
    ZenSpaceAddSwipe: class {
      swipeReset() {}
      readySwipeAddSpace() { return !!options.addSpace; }
      startSwipe() {}
      swipeProgress(value) { addMoves.push(value); }
      onSwipeAnimationEnd() {}
    },
    gZenUIManager: { tabsWrapper: { style: { removeProperty: key => cleanup.push(key) } } },
    gNavToolbox: { addEventListener() {}, removeEventListener() {} },
    gZenFolders: { cancelPopupTimer() {} },
    Services: {
      prefs: {
        getIntPref: name => name === "widget.swipe.pixel_size" ? 550 : 100,
      },
    },
    gZenWorkspaces: workspaces,
  });
  vm.runInContext(source + "\nglobalThis.Manager = ZenSpacesSwipe", context);
  const manager = new context.Manager();
  let nativeOffset = 0;
  const event = (type, delta = 0) => {
    if (type === "MozSwipeGestureStart") nativeOffset = 0;
    const input = {
      type, delta: delta + nativeOffset, direction: 1, preventDefault() {}, stopPropagation() {},
      ...(options.presentation ? { swipeConsumerHandlesRelease: false, swipeProgressOffset: 0 } : {}),
    };
    manager.handleEvent(input);
    nativeOffset += input.swipeProgressOffset || 0;
    return input;
  };
  event("MozSwipeGestureStart");
  return {
    moves, libraryMoves, addMoves, cleanup, switches, attrs, workspaces, event, manager,
    update: value => event("MozSwipeGestureUpdate", value),
    end: () => event("MozSwipeGestureEnd"),
  };
}

const position = (samples, width) => {
  const f = fixture(width);
  samples.forEach(f.update);
  return f.moves.at(-1);
};

test("same finger position is independent of intermediate event count", () => {
  const sparse = [.1, .2, .3, .4];
  const dense = Array.from({ length: 40 }, (_, index) => (index + 1) / 100);
  assert.equal(position(sparse), position(dense));
});

test("coalesced and duplicate updates cannot advance the strip", () => {
  assert.equal(position([.4]), position([.4, .4, .4]));
});

test("returning fingers to the start returns the strip to zero before release", () => {
  assert.equal(position([.1, .3, .5, .3, .1, 0]), 0);
});

test("reversing the same gesture follows the current side of the start position", () => {
  assert.equal(position([.3, .1, -.1, -.3]), position([-.3]));
});

test("pinned and floating strips travel the same distance despite different widths", () => {
  for (const width of [216, 228, 300]) {
    const offset = position([240 / 550], width);
    assert.ok(Math.abs(offset / 200 * width - 120) < 1e-10);
  }
});

test("long gestures stay within the adjacent strip and reverse without sticking", () => {
  assert.equal(position([2]), 200);
  assert.equal(position([-2]), -200);
  assert.equal(position([2, .1]), position([.1]));
});

test("native cancellation samples converge to zero and end further updates", () => {
  const f = fixture();
  [.4, .3, .18, .05, .001, 0].forEach(f.update);
  assert.equal(f.moves.at(-1), 0);
  const count = f.moves.length;
  f.end();
  f.update(.4);
  assert.equal(f.moves.length, count);
});

test("library edge action follows the same fraction of the strip", () => {
  const f = fixture(220, { library: true });
  f.update(.2);
  f.update(.2);
  f.update(0);
  assert.deepEqual(f.libraryMoves, [.25, .25, 0]);
  assert.deepEqual(f.moves, [0, 0, 0]);
});

test("new-space edge action retains native progress and its independent threshold", () => {
  const f = fixture(220, { addSpace: true });
  f.update(-.2);
  f.update(-.8);
  f.update(-1.6);
  f.update(0);
  assert.deepEqual(f.addMoves, [-.2, -.8, -1.6, 0]);
  assert.deepEqual(f.moves, []);
});

test("edge handoff rebases New Space entry and subsequent native progress once", () => {
  let handoffs = 0;
  const presentation = {
    isCurrent: () => true,
    offsetFor: offset => 100 + offset,
    move() {},
    handToEdge: () => handoffs++,
  };
  const f = fixture(220, { addSpace: true, presentation });
  // 100 percent units = .4 native progress with these dimensions. The first
  // .4 of this pan merely finishes the interrupted Space transition.
  const first = f.update(-.42);
  assert.equal(first.swipeConsumerHandlesRelease, false);
  assert.equal(first.swipeProgressOffset, .4);
  f.update(-.42);
  f.update(-.5);
  f.update(-.4);
  assert.equal(handoffs, 1);
  assert.equal(f.addMoves.length, 4);
  [-.02, -.02, -.1, 0].forEach((expected, index) =>
    assert.ok(Math.abs(f.addMoves[index] - expected) < 1e-12));
});

test("Library handoff preserves the same origin for duplicate and return samples", () => {
  const presentation = {
    isCurrent: () => true,
    offsetFor: offset => offset - 100,
    move() {}, handToEdge() {},
  };
  const f = fixture(220, { library: true, presentation });
  const first = f.update(.42);
  assert.equal(first.swipeProgressOffset, -.4);
  f.update(.42);
  f.update(.5);
  f.update(.4);
  [.025, .025, .125, 0].forEach((expected, index) =>
    assert.ok(Math.abs(f.libraryMoves[index] - expected) < 1e-12));
});

test("a superseded native paging gesture cannot fall back to legacy navigation", async () => {
  const f = fixture(220, { presentation: {
    isCurrent: () => false,
    settle: () => Promise.resolve(),
  } });
  f.update(.4);
  f.event("MozSwipeGesture");
  f.end();
  await Promise.resolve();
  assert.deepEqual(f.moves, []);
  assert.deepEqual(f.switches, []);
});

test("gesture-end keeps the successful switch's presentation before its queue starts", async () => {
  let settle;
  const f = fixture(230, { switchResult: new Promise(resolve => { settle = resolve; }) });
  f.update(-.3);
  f.event("MozSwipeGesture");
  // Native end is a later task, but ownership also covers a synchronous end
  // before the asynchronous workspace queue marks itself busy.
  f.end();
  assert.deepEqual(f.switches, [[1, true]]);
  assert.deepEqual(f.cleanup, []);
  assert.equal(f.manager.isGestureActive, false);
  assert.equal(f.attrs.at(-1)[1], false);
  settle();
  await Promise.resolve();
  assert.deepEqual(f.cleanup, []);
});

test("duplicate native end signals cannot reset an in-flight switch", () => {
  const f = fixture(230, { switchResult: new Promise(() => {}) });
  f.event("MozSwipeGesture");
  f.end();
  f.end();
  f.event("popupshown");
  assert.equal(f.switches.length, 1);
  assert.deepEqual(f.cleanup, []);
});

test("standalone completion gestures still navigate without a start event", () => {
  const f = fixture();
  f.end();
  f.event("MozSwipeGesture");
  f.event("MozSwipeGesture");
  assert.deepEqual(f.switches, [[1, true], [1, true]]);
});

test("gesture cleanup preserves a keyboard switch that took over the presentation", () => {
  const f = fixture();
  f.update(-.3);
  f.workspaces.isChangingWorkspace = true;
  f.end();
  assert.deepEqual(f.cleanup, []);
  assert.equal(f.manager.isGestureActive, false);
});

test("native cancellation still restores idle layout and background exactly once", () => {
  const f = fixture();
  f.update(.2);
  f.update(0);
  f.end();
  assert.deepEqual(f.cleanup, ["scrollbar-width",
    ["--zen-background-opacity", "1"], ["--zen-background-opacity", "1"], "layout"]);
  const count = f.cleanup.length;
  f.end();
  assert.equal(f.cleanup.length, count);
});

test("completion of an old switch cannot release a newer gesture's ownership", async () => {
  let settle;
  const f = fixture(230, { switchResult: new Promise(resolve => { settle = resolve; }) });
  f.event("MozSwipeGesture");
  f.end();
  f.event("MozSwipeGestureStart");
  settle();
  await Promise.resolve();
  assert.equal(f.manager.isGestureActive, true);
  f.update(-.2);
  assert.equal(f.moves.length, 1);
  f.end();
  assert.ok(f.cleanup.includes("layout"));
});
