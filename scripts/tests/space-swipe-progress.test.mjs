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
  const backdrop = { style: { setProperty() {} } };
  const context = vm.createContext({
    document: {
      getElementById: () => backdrop,
      querySelectorAll: () => [],
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
    gZenUIManager: { tabsWrapper: { style: { removeProperty() {} } } },
    gNavToolbox: { addEventListener() {}, removeEventListener() {} },
    gZenFolders: { cancelPopupTimer() {} },
    Services: {
      prefs: {
        getIntPref: name => name === "widget.swipe.pixel_size" ? 550 : 100,
      },
    },
    gZenWorkspaces: {
      workspaceEnabled: true,
      getActiveWorkspaceFromCache: () => ({ uuid: "current" }),
      workspaceElement: () => backdrop,
      updateTabsContainers() {},
      _organizeWorkspaceStripLocations: (_space, _move, offset) => moves.push(offset),
    },
  });
  vm.runInContext(source + "\nglobalThis.Manager = ZenSpacesSwipe", context);
  const manager = new context.Manager();
  const event = (type, delta = 0) => manager.handleEvent({
    type, delta, preventDefault() {}, stopPropagation() {},
  });
  event("MozSwipeGestureStart");
  return {
    moves, libraryMoves, addMoves,
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
  f.update(0);
  assert.deepEqual(f.addMoves, [-.2, -.8, 0]);
  assert.deepEqual(f.moves, []);
});
