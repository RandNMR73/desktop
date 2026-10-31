import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../../src/zen/tabs/ZenPinnedTabManager.mjs", import.meta.url),
  "utf8",
).replace(/^import .*;\n/m, "");
function fixture() {
  const window = new EventTarget();
  let writes = 0;
  const context = vm.createContext({
    window,
    AbortController,
    nsZenDOMOperatedFeature: class {},
    document: {
      l10n: {
        getAttributes: (label) => ({ args: label.args }),
        setArgs(label, args) {
          label.args = args;
          writes++;
        },
      },
    },
  });
  vm.runInContext(source, context);
  const tab = (subtitle = "zen-default-pinned") =>
    Object.assign(new EventTarget(), {
      isConnected: true,
      label:
        subtitle === null
          ? null
          : {
              attributes: new Map(),
              setAttribute(name, value) {
                this.attributes.set(name, value);
              },
              args:
                subtitle === undefined ? undefined : { tabSubtitle: subtitle },
            },
      providerLabel: { args: { tabSubtitle: "Live folder update" } },
      querySelector(selector) {
        if (selector === ".zen-tab-sublabel") return this.providerLabel;
        assert.equal(selector, ".zen-tab-reset-sublabel");
        return this.label;
      },
      hasAttribute: () => false,
    });
  const event = (type, held) =>
    Object.assign(new Event(type), {
      getModifierState: () => held,
      metaKey: held,
    });
  const manager = window.gZenPinnedTabManager;
  const activeListeners = () =>
    ["keydown", "keyup", "blur", "unload"].map(
      (type) => getEventListeners(window, type).length,
    );
  return {
    window,
    tab,
    event,
    manager,
    activeListeners,
    get writes() {
      return writes;
    },
  };
}

test("repeated hovers and key repeats keep one listener set and no redundant label writes", () => {
  const f = fixture(),
    tab = f.tab();
  for (let i = 0; i < 100; i++)
    f.manager.onResetPinButtonMouseOver(tab, f.event("mouseover", false));
  assert.deepEqual(f.activeListeners(), [1, 1, 1, 1]);
  assert.equal(getEventListeners(tab, "TabClose").length, 1);
  assert.equal(f.writes, 0);
  for (let i = 0; i < 100; i++)
    f.window.dispatchEvent(f.event("keydown", true));
  assert.equal(tab.label.args.tabSubtitle, "zen-default-pinned-cmd");
  assert.equal(f.writes, 1);
  f.window.dispatchEvent(f.event("keyup", false));
  assert.equal(tab.label.args.tabSubtitle, "zen-default-pinned");
  assert.equal(f.writes, 2);
  f.manager.onResetPinButtonMouseOut(tab);
  assert.deepEqual(f.activeListeners(), [0, 0, 0, 0]);
  assert.equal(getEventListeners(tab, "TabClose").length, 0);
});

test("leaving while Command is held restores the hint and removes every listener", () => {
  const f = fixture(),
    tab = f.tab();
  for (let i = 0; i < 100; i++) {
    f.manager.onResetPinButtonMouseOver(tab, f.event("mouseover", true));
    assert.equal(tab.label.args.tabSubtitle, "zen-default-pinned-cmd");
    f.manager.onResetPinButtonMouseOut(tab);
    assert.equal(tab.label.args.tabSubtitle, "zen-default-pinned");
    assert.deepEqual(f.activeListeners(), [0, 0, 0, 0]);
  }
});

test("moving between tabs clears the old hint; an unrelated mouseout cannot clear the new hover", () => {
  const f = fixture(),
    first = f.tab(),
    second = f.tab();
  f.manager.onResetPinButtonMouseOver(first, f.event("mouseover", true));
  f.manager.onResetPinButtonMouseOver(second, f.event("mouseover", true));
  f.manager.onResetPinButtonMouseOut(first);
  assert.equal(first.label.args.tabSubtitle, "zen-default-pinned");
  assert.equal(second.label.args.tabSubtitle, "zen-default-pinned-cmd");
  assert.deepEqual(f.activeListeners(), [1, 1, 1, 1]);
  assert.equal(getEventListeners(first, "TabClose").length, 0);
  f.manager.onResetPinButtonMouseOut(second);
});

for (const reason of ["blur", "unload", "TabClose", "reset", "disconnected"]) {
  test(`${reason} ends the reset hover and releases the tab`, () => {
    const f = fixture(),
      tab = f.tab();
    f.manager.onResetPinButtonMouseOver(tab, f.event("mouseover", true));
    if (reason === "reset") f.manager.resetPinChangedUrl(tab);
    else if (reason === "disconnected") {
      tab.isConnected = false;
      f.window.dispatchEvent(f.event("keyup", false));
    } else
      (reason === "TabClose" ? tab : f.window).dispatchEvent(new Event(reason));
    assert.deepEqual(f.activeListeners(), [0, 0, 0, 0]);
    assert.equal(getEventListeners(tab, "TabClose").length, 0);
    assert.equal(f.manager._tabWithResetPinButtonHovered, undefined);
    assert.equal(tab.label.args.tabSubtitle, "zen-default-pinned");
  });
}

test("missing and unrecognized reset controls do not install listeners", () => {
  const f = fixture();
  for (const subtitle of [null, "live-folder-update"]) {
    const tab = f.tab(subtitle);
    f.manager.onResetPinButtonMouseOver(tab, f.event("mouseover", true));
    assert.deepEqual(f.activeListeners(), [0, 0, 0, 0]);
    assert.equal(tab.label?.args.tabSubtitle ?? null, subtitle);
  }
  const tab = f.tab();
  tab.label.args = undefined;
  f.manager.onResetPinButtonMouseOver(tab, f.event("mouseover", true));
  assert.deepEqual(f.activeListeners(), [0, 0, 0, 0]);
  assert.equal(f.writes, 0);
});

test("a replaced reset control is not overwritten on exit", () => {
  const f = fixture(),
    tab = f.tab();
  f.manager.onResetPinButtonMouseOver(tab, f.event("mouseover", true));
  tab.label.args = { tabSubtitle: "live-folder-update" };
  f.manager.onResetPinButtonMouseOut(tab);
  assert.equal(tab.label.args.tabSubtitle, "live-folder-update");
  assert.deepEqual(f.activeListeners(), [0, 0, 0, 0]);
});

test("provider updates remain intact while the separate reset hint tracks Command", () => {
  const f = fixture(),
    tab = f.tab();
  f.manager.onResetPinButtonMouseOver(tab, f.event("mouseover", false));
  assert.equal(tab.label.attributes.get("aria-hidden"), "false");
  f.window.dispatchEvent(f.event("keydown", true));
  assert.equal(tab.label.args.tabSubtitle, "zen-default-pinned-cmd");
  tab.providerLabel.args = { tabSubtitle: "A newer live folder update" };
  f.manager.onResetPinButtonMouseOut(tab);
  assert.equal(
    tab.providerLabel.args.tabSubtitle,
    "A newer live folder update",
  );
  assert.equal(tab.label.attributes.get("aria-hidden"), "true");
  assert.deepEqual(f.activeListeners(), [0, 0, 0, 0]);
});
