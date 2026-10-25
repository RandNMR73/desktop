import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../../src/zen/tabs/ZenTabRenamer.mjs", import.meta.url),
  "utf8",
).replace(/^import .*;\n/m, "");

function fixture() {
  let enabled = true;
  let finish;
  let bag;
  let opens = 0;
  let dialogURL;
  let notifyOpen;
  let ready = new Promise((resolve) => {
    notifyOpen = resolve;
  });
  const updates = [];
  const browser = {
    _setTabLabel(tab, name, options) {
      tab.label = name;
      updates.push({ name, options });
    },
    setTabTitle(tab) {
      tab.label = "Page title";
    },
    updateTitlebar() {
      updates.push("titlebar");
    },
  };
  const window = {
    closed: false,
    gDialogBox: {
      open(url, args) {
        dialogURL = url;
        opens++;
        bag = args;
        const result = new Promise((resolve) => {
          finish = resolve;
        });
        notifyOpen();
        return result;
      },
    },
  };
  const context = vm.createContext({
    window,
    document: {
      l10n: {
        formatValues: async () => [
          "Rename Tab…",
          "Rename",
          "Cancel",
          "Keep it short and sweet!",
        ],
      },
    },
    Services: { prefs: { getBoolPref: () => enabled } },
    Ci: { nsIPrompt: { MODAL_TYPE_WINDOW: 1 } },
    ChromeUtils: {
      importESModule: () => ({
        PromptUtils: {
          objectToPropBag: (args) => ({ ...args }),
          propBagToObject: (result, args) => Object.assign(args, result),
        },
      }),
    },
    nsZenDOMOperatedFeature: class {},
    gBrowser: browser,
  });
  vm.runInContext(source, context);
  const tab = {
    isConnected: true,
    selected: true,
    label: "Original favorite",
    essential: true,
    hasAttribute(name) {
      return name === "zen-essential" && this.essential;
    },
  };
  return {
    tab,
    window,
    updates,
    renamer: window.gZenTabRenamer,
    get opens() {
      return opens;
    },
    get bag() {
      return bag;
    },
    get dialogURL() {
      return dialogURL;
    },
    disable() {
      enabled = false;
    },
    opened() {
      return ready;
    },
    finish(ok, value = bag.value) {
      Object.assign(bag, { ok, value });
      finish();
      ready = new Promise((resolve) => {
        notifyOpen = resolve;
      });
    },
  };
}

test("favorite rename commits the title as text and updates the selected window", async () => {
  const f = fixture();
  const result = f.renamer.renameFavorite(f.tab);
  await f.opened();
  assert.equal(f.bag.value, "Original favorite");
  assert.equal(f.bag.button0Label, "Rename");
  assert.equal(f.bag.button1Label, "Cancel");
  assert.equal(f.bag.placeholder, "Keep it short and sweet!");
  assert.equal(
    f.dialogURL,
    "chrome://browser/content/zen-dialogs/favorite-rename.html",
  );
  f.finish(true, "  https://www.keep-this-name.test  ");
  assert.equal(await result, true);
  assert.equal(f.tab.zenStaticLabel, "https://www.keep-this-name.test");
  assert.equal(f.tab.label, f.tab.zenStaticLabel);
  assert.equal(f.updates[0].options.isContentTitle, true);
  assert.equal(f.updates[1], "titlebar");
});

test("cancel preserves the old custom title and permits another rename", async () => {
  const f = fixture();
  f.tab.zenStaticLabel = f.tab.label;
  const result = f.renamer.renameFavorite(f.tab);
  await f.opened();
  f.finish(false, "Must not be saved");
  assert.equal(await result, false);
  assert.equal(f.tab.zenStaticLabel, "Original favorite");
  assert.equal(f.updates.length, 0);
  const again = f.renamer.renameFavorite(f.tab);
  await f.opened();
  assert.equal(f.opens, 2);
  f.finish(false);
  await again;
});

test("empty input restores the page title", async () => {
  const f = fixture();
  f.tab.zenStaticLabel = f.tab.label;
  const result = f.renamer.renameFavorite(f.tab);
  await f.opened();
  f.finish(true, " \t ");
  assert.equal(await result, true);
  assert.equal("zenStaticLabel" in f.tab, false);
  assert.equal(f.tab.label, "Page title");
});

test("only one favorite prompt can be pending", async () => {
  const f = fixture();
  const first = f.renamer.renameFavorite(f.tab);
  assert.equal(await f.renamer.renameFavorite({ ...f.tab }), false);
  await f.opened();
  assert.equal(f.opens, 1);
  f.finish(false);
  await first;
});

test("closing or unpinning the target prevents a stale prompt from changing it", async () => {
  for (const property of ["isConnected", "essential"]) {
    const f = fixture();
    const result = f.renamer.renameFavorite(f.tab);
    await f.opened();
    f.tab[property] = false;
    f.finish(true, "Stale title");
    assert.equal(await result, false);
    assert.equal(f.tab.label, "Original favorite");
    assert.equal(f.updates.length, 0);
  }
});

test("disabled renaming and an already closed target never open a dialog", async () => {
  for (const setup of [
    (f) => f.disable(),
    (f) => {
      f.tab.isConnected = false;
    },
  ]) {
    const f = fixture();
    setup(f);
    assert.equal(await f.renamer.renameFavorite(f.tab), false);
    assert.equal(f.opens, 0);
  }
});

test("a failed dialog releases the rename guard", async () => {
  const f = fixture();
  const open = f.window.gDialogBox.open;
  f.window.gDialogBox.open = async () => {
    throw new Error("dialog failed");
  };
  await assert.rejects(f.renamer.renameFavorite(f.tab), /dialog failed/);
  f.window.gDialogBox.open = open;
  const result = f.renamer.renameFavorite(f.tab);
  await f.opened();
  f.finish(false);
  assert.equal(await result, false);
});
