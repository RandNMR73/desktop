import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../../src/zen/common/sys/ZenQuitPrompt.sys.mjs", import.meta.url),
  "utf8",
).replace("export const ZenQuitPrompt", "globalThis.ZenQuitPrompt");

function fixture({
  choice = 0,
  failure = false,
  shutdown = false,
  strings = true,
} = {}) {
  let bag, resolve, reject, finalize;
  const calls = { opens: 0, replaces: 0, errors: 0 };
  const pending = {
    then(fn) {
      resolve = fn;
      return this;
    },
    catch(fn) {
      reject = fn;
      return this;
    },
    finally(fn) {
      finalize = fn;
      return this;
    },
  };
  const win = {
    closed: false,
    gDialogBox: {
      replaceDialogIfOpen() {
        calls.replaces++;
      },
      open(url, value) {
        calls.opens++;
        calls.url = url;
        bag = value;
        return pending;
      },
    },
  };
  const context = vm.createContext({
    console: {
      error() {
        calls.errors++;
      },
    },
    Ci: { nsIPrompt: { MODAL_TYPE_WINDOW: 1 } },
    Localization: class {
      formatValuesSync() {
        return strings
          ? ["Quit Zen?", "Quit", "Cancel", "Quit, and don’t ask again"]
          : [];
      }
    },
    ChromeUtils: {
      defineLazyGetter(target, key, fn) {
        Object.defineProperty(target, key, { get: fn });
      },
      defineESModuleGetters(target) {
        target.PromptUtils = {
          objectToPropBag: (args) => ({ ...args }),
          propBagToObject: (result, args) => Object.assign(args, result),
        };
      },
    },
    Services: {
      tm: {
        spinEventLoopUntilOrQuit(reason, done) {
          assert.equal(done(), false);
          calls.duringModal?.();
          if (shutdown) return;
          try {
            if (failure) throw new Error("Dialog load failed");
            bag.buttonNumClicked = choice;
            resolve();
          } catch (error) {
            reject(error);
          }
          finalize();
          assert.equal(done(), true);
        },
      },
    },
  });
  vm.runInContext(source, context);
  return {
    prompt: context.ZenQuitPrompt,
    win,
    calls,
    get bag() {
      return bag;
    },
  };
}

test("quit confirmation returns distinct quit, cancel and never-ask results", () => {
  for (const choice of [0, 1, 2]) {
    const f = fixture({ choice });
    assert.equal(f.prompt.confirm(f.win), choice);
    assert.equal(f.calls.opens, 1);
    assert.equal(f.calls.replaces, 1);
    assert.equal(f.bag.button1Label, "Cancel");
    assert.equal(f.prompt._open, false);
  }
});

test("nested quit requests preserve the in-flight confirmation", () => {
  const f = fixture();
  f.calls.duringModal = () => {
    assert.equal(f.prompt.confirm(f.win), 1);
    assert.equal(f.calls.opens, 1);
    assert.equal(f.calls.replaces, 1);
  };
  assert.equal(f.prompt.confirm(f.win), 0);
});

test("failed loads, shutdown and invalid responses cancel rather than quit", () => {
  for (const options of [
    { failure: true },
    { shutdown: true },
    { choice: 99 },
    { choice: "0" },
    { strings: false },
  ]) {
    const f = fixture(options);
    assert.equal(f.prompt.confirm(f.win), 1);
    assert.equal(f.prompt._open, false);
  }
});

test("closed or absent windows cannot accept a quit confirmation", () => {
  const f = fixture();
  assert.equal(f.prompt.confirm(null), 1);
  assert.equal(
    f.prompt.confirm({ closed: true, gDialogBox: f.win.gDialogBox }),
    1,
  );
  assert.equal(f.calls.opens, 0);
});

test("dialog close failures clear the modal guard for later requests", () => {
  const f = fixture();
  const replace = f.win.gDialogBox.replaceDialogIfOpen;
  f.win.gDialogBox.replaceDialogIfOpen = () => {
    throw new Error("Window closed");
  };
  assert.equal(f.prompt.confirm(f.win), 1);
  f.win.gDialogBox.replaceDialogIfOpen = replace;
  assert.equal(f.prompt.confirm(f.win), 0);
});
