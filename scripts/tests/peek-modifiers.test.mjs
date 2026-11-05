import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/zen/glance/actors/ZenGlanceChild.sys.mjs", import.meta.url), "utf8")
  .replace(/^import .*;$/m, "")
  .replace("export class ZenGlanceChild", "globalThis.Actor = class ZenGlanceChild");

function fixture(activationMethod = "shift", options = {}) {
  const messages = [];
  const principal = {};
  const node = { getBoundingClientRect: () => ({ left: 1, top: 2, width: 30, height: 20 }) };
  const context = vm.createContext({
    JSWindowActorChild: class { sendAsyncMessage(name, data) { messages.push({ name, data }); } },
    XPCOMUtils: { defineLazyPreferenceGetter(target, key, pref, fallback) {
      target[key] = key === "activationMethod" ? activationMethod : fallback;
    } },
    ChromeUtils: { defineESModuleGetters(target) {
      target.BrowserUtils = { hrefAndLinkNodeForClickEvent: () =>
        [options.href ?? "https://example.test/preview", options.noLink ? null : node, principal] };
    } },
    Services: {
      io: { extractScheme: href => href.split(":")[0] },
      scriptSecurityManager: { checkLoadURIStrWithPrincipal() {
        if (options.denied) throw new Error("Denied");
      } },
    },
  });
  vm.runInContext(source, context);
  const actor = new context.Actor();
  actor.browsingContext = { fullZoom: 1 };
  const click = overrides => {
    const event = { button: 0, defaultPrevented: false, target: node, clientX: 10, clientY: 20,
      ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; }, ...overrides };
    actor.on_click(event);
    return event;
  };
  return { actor, click, messages, node, principal };
}

const keys = ["ctrl", "alt", "shift", "meta"];
for (const activation of keys) {
  for (let mask = 0; mask < 16; mask++) {
    test(`Peek configured for ${activation}: modifier mask ${mask}`, () => {
      const f = fixture(activation);
      const event = f.click(Object.fromEntries(keys.map((key, bit) => [key + "Key", !!(mask & (1 << bit))])));
      const expected = mask === (1 << keys.indexOf(activation));
      assert.equal(f.messages.length, expected ? 1 : 0);
      assert.equal(event.defaultPrevented, expected);
      assert.equal(!!event.stopped, expected);
      if (expected) {
        assert.equal(f.messages[0].name, "ZenGlance:OpenGlance");
        assert.equal(f.messages[0].data.url, "https://example.test/preview");
        assert.equal(f.messages[0].data.triggeringPrincipal, f.principal);
      }
    });
  }
}

for (const [name, options, event] of [
  ["middle button", {}, { button: 1 }],
  ["right button", {}, { button: 2 }],
  ["cancelled click", {}, { defaultPrevented: true }],
  ["non-link", { noLink: true }, {}],
  ["javascript link", { href: "javascript:alert(1)" }, {}],
  ["denied principal", { denied: true }, {}],
]) {
  test(`Peek preserves the ${name} guard`, () => {
    const f = fixture("shift", options);
    const result = f.click({ shiftKey: true, ...event });
    assert.equal(f.messages.length, 0);
    assert.equal(result.defaultPrevented, !!event.defaultPrevented);
    assert.equal(!!result.stopped, false);
  });
}

test("text-selection drag does not trigger Peek; the next click still works", () => {
  const f = fixture();
  f.actor.on_mousedown({ target: f.node, clientX: 10, clientY: 20 });
  assert.equal(f.messages.pop().name, "ZenGlance:RecordLinkClickData");
  assert.equal(f.click({ shiftKey: true, clientX: 15 }).defaultPrevented, false);
  assert.equal(f.messages.length, 0);
  assert.equal(f.click({ shiftKey: true }).defaultPrevented, true);
});

test("minor mouse jitter and lock-state keys do not block Shift-click", () => {
  const f = fixture();
  f.actor.on_mousedown({ target: f.node, clientX: 10, clientY: 20 });
  f.messages.length = 0;
  assert.equal(f.click({ shiftKey: true, clientX: 14, getModifierState: () => true }).defaultPrevented, true);
  assert.equal(f.messages.length, 1);
});
