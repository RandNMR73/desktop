import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/zen/common/modules/ZenVerticalTabsManager.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\n/m, "");

function fixture() {
  const frames = [], calls = [], removed = [];
  const item = {
    isConnected: true,
    hasAttribute: () => false,
    getBoundingClientRect: () => ({ height: 32 }),
    style: { removeProperty: name => removed.push(name) },
  };
  const context = vm.createContext({
    console, gReduceMotion: false,
    gZenStartup: { isReady: true },
    gBrowser: { tabContainer: { ariaFocusableItems: [item] } },
    document: { hidden: false },
    XPCOMUtils: { defineLazyPreferenceGetter() {} },
    requestAnimationFrame: callback => frames.push(callback),
    windowUtils: { getBoundsWithoutFlushing: () => ({ height: 32 }) },
    gZenUIManager: {
      _hasLoadedDOM: true,
      motion: { animate(target, keyframes) {
        let finish;
        const promise = new Promise(resolve => { finish = resolve; });
        calls.push({ target, keyframes, finish });
        return promise;
      } },
    },
  });
  vm.runInContext("globalThis.window = globalThis;\n" + source, context);
  return { manager: context.gZenVerticalTabsManager, item, frames, calls, removed };
}

const drain = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test("deferred folder opening never replaces a closing animation", async () => {
  const f = fixture();
  f.manager.animateItemOpen(f.item);
  const closing = f.manager.animateItemClose(f.item);
  f.frames.shift()();
  assert.equal(f.calls.length, 1, "only the close animation runs");
  assert.deepEqual([...f.calls[0].keyframes.opacity], [1, 0]);
  assert.deepEqual(f.removed, [], "the abandoned opening frame must not clear closing styles");
  f.calls[0].finish();
  await closing;
});

test("finishing an earlier open cannot clear closing styles", async () => {
  const f = fixture();
  f.manager.animateItemOpen(f.item);
  f.frames.shift()();
  const closing = f.manager.animateItemClose(f.item);
  f.calls[0].finish();
  await drain();
  assert.deepEqual(f.removed, []);
  f.calls[1].finish();
  await closing;
});

test("ordinary opening still releases its temporary styles", async () => {
  const f = fixture();
  f.manager.animateItemOpen(f.item);
  f.frames.shift()();
  f.calls[0].finish();
  await drain();
  assert.deepEqual(f.removed, ["margin-bottom", "transform", "opacity"]);
});
