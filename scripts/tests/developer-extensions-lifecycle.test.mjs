import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";

test("extension presentation releases both listeners and ignores queued refresh after teardown", () => {
  const cui = new Set(),
    addons = new Set(),
    pending = [];
  const source = fs
    .readFileSync(
      new URL(
        "../../src/zen/urlbar/ZenDeveloperExtensions.sys.mjs",
        import.meta.url,
      ),
      "utf8",
    )
    .replace("export class", "class");
  const Controller = vm.runInNewContext(`${source}; ZenDeveloperExtensions`, {
    ChromeUtils: {
      defineESModuleGetters(target) {
        target.AddonManager = {
          addAddonListener: (listener) => addons.add(listener),
          removeAddonListener: (listener) => addons.delete(listener),
        };
      },
    },
  });
  const window = {
    CustomizableUI: {
      addListener: (listener) => cui.add(listener),
      removeListener: (listener) => cui.delete(listener),
    },
    queueMicrotask: (callback) => pending.push(callback),
  };
  for (let i = 0; i < 3; i++) {
    const controller = new Controller(window);
    assert.equal(cui.size, 1);
    assert.equal(addons.size, 1);
    controller.refresh();
    controller.refresh();
    assert.equal(pending.length, 1, "coalesce notifications within a turn");
    controller.destroy();
    controller.destroy();
    assert.equal(cui.size, 0);
    assert.equal(addons.size, 0);
    pending.shift()();
    controller.refresh();
    assert.equal(pending.length, 0, "do not schedule work after teardown");
  }
});
