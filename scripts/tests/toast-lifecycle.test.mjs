import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(
  new URL("../../src/zen/common/modules/ZenToasts.mjs", import.meta.url),
  "utf8",
);

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attributes = new Map();
    this.style = {};
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((n) => this.classes.add(n)),
    };
  }
  get isConnected() {
    return this.root || !!this.parent?.isConnected;
  }
  appendChild(child) {
    child.remove();
    this.children.push(child);
    child.parent = this;
    return child;
  }
  remove() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
    }
  }
  replaceChildren() {
    for (const c of [...this.children]) c.remove();
  }
  setAttribute(k, v) {
    this.attributes.set(k, String(v));
  }
  getAttribute(k) {
    return this.attributes.get(k);
  }
  removeAttribute(k) {
    this.attributes.delete(k);
  }
  hasAttribute(k) {
    return this.attributes.has(k);
  }
  contains(node) {
    return (
      !!node && (node === this || this.children.some((c) => c.contains(node)))
    );
  }
  querySelector(selector) {
    return this.children
      .flatMap((c) => [c, ...c.descendants()])
      .find((c) =>
        selector.startsWith(".")
          ? c.classes.has(selector.slice(1))
          : c.tag === selector,
      );
  }
  descendants() {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  addEventListener(name, fn) {
    this.listeners.set(name, fn);
  }
  fire(name, relatedTarget = null) {
    this.listeners.get(name)?.({ relatedTarget });
  }
}

function fixture(native = null, translate = async () => "Copied Current URL") {
  const container = new Element("container");
  container.root = true;
  const timers = new Map(),
    animations = [];
  let nextTimer = 0,
    disableAutohide = false;
  const window = { innerHeight: 900, closed: false, workspace: "main" };
  window.gZenWorkspaces = { getActiveWorkspace: () => ({ uuid: window.workspace }) };
  const listeners = new Set();
  window.gZenWorkspaces.addChangeListeners = callback => listeners.add(callback);
  window.gZenWorkspaces.removeChangeListeners = callback => listeners.delete(callback);
  const Manager = vm.runInNewContext(
    source.replace("export class", "class") + "\nnsZenToastManager",
    {
      window,
      ChromeUtils: { importESModule: () => ({ showNativeCopyToast: native }) },
      document: {
        getElementById: () => container,
        createXULElement: (tag) => new Element(tag),
        l10n: {
          formatValue: translate,
          setAttributes: (el, id, args) => {
            el.setAttribute("data-l10n-id", id);
            el.args = args;
          },
        },
      },
      Services: { prefs: { getBoolPref: () => disableAutohide } },
      setTimeout: (fn, ms) => {
        const id = nextTimer++;
        timers.set(id, { fn, ms });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
      gZenUIManager: {
        motion: {
          animate: (el, values, options) => {
            let finish;
            const promise = new Promise((resolve) => {
              finish = resolve;
            });
            const a = {
              el,
              values,
              finish,
              stopped: false,
              stop() {
                this.stopped = true;
              },
              then: promise.then.bind(promise),
            };
            a.options = options;
            animations.push(a);
            if (options.duration === 0) {
              el.style.opacity = String(values.opacity);
              el.style.transform = `scale(${values.scale})`;
              finish();
            }
            return a;
          },
        },
      },
    },
  );
  return {
    manager: new Manager(),
    window,
    listeners,
    changeWorkspace(workspace) {
      window.workspace = workspace;
      for (const listener of listeners) listener();
    },
    container,
    timers,
    animations,
    fireTimer() {
      assert.equal(timers.size, 1);
      const [id, { fn }] = [...timers][0];
      timers.delete(id);
      fn();
    },
    disableAutohide() {
      disableAutohide = true;
    },
  };
}
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
async function show(f, options = {}, id = "copy") {
  const p = f.manager.show(id, options);
  f.animations.at(-1)?.finish();
  await p;
  return f.container.children[0];
}

test("copying a non-shareable URL removes the preceding URL's action", async () => {
  const f = fixture();
  let shared;
  const toast = await show(f, {
    button: { id: "share", command: () => (shared = "first") },
  });
  await f.manager.show("copy", {
    button: { id: "share", command: () => (shared = "second") },
  });
  toast.querySelector("button").fire("command");
  assert.equal(shared, "second");
  await f.manager.show("copy");
  assert.equal(toast.querySelector("button"), undefined);
  assert.equal(toast.hasAttribute("button"), false);
  assert.equal(f.container.children.length, 1);
});

test("repeated messages refresh their text arguments and optional description", async () => {
  const f = fixture();
  const toast = await show(f, {
    l10nArgs: { count: 1 },
    descriptionId: "detail",
  });
  await f.manager.show("copy", { l10nArgs: { count: 2 } });
  assert.equal(toast.querySelector("label").args.count, 2);
  assert.equal(toast.querySelector(".description"), undefined);
  assert.equal(toast.getAttribute("data-zen-toast-message"), "copy");
});

test("an obsolete entrance cannot replace the newest timeout or leave its caller waiting", async () => {
  const f = fixture();
  const first = f.manager.show("copy", { timeout: 100 });
  const entrance = f.animations[0];
  await f.manager.show("copy", { timeout: 900 });
  await first;
  assert.equal(entrance.stopped, true);
  assert.equal(
    f.animations.at(-1).options.duration,
    0,
    "repeat does not shrink/reanimate the visible toast",
  );
  entrance.finish();
  await tick();
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].ms, 900);
});

test("an obsolete fade completion cannot remove a renewed notification", async () => {
  const f = fixture();
  const toast = await show(f, { timeout: 100 });
  f.fireTimer();
  const fade = f.animations.at(-1);
  await f.manager.show("copy", { timeout: 900 });
  fade.finish();
  await tick();
  assert.equal(toast.isConnected, true);
  assert.equal(toast.style.opacity, "1");
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].ms, 900);
  f.fireTimer();
  f.animations.at(-1).finish();
  await tick();
  assert.equal(toast.isConnected, false);
  assert.equal(f.container.hasAttribute("hidden"), true);
});

test("hover during entry prevents timeout; descendant transitions keep the toast visible", async () => {
  const f = fixture();
  const p = f.manager.show("copy", {
    timeout: 100,
    button: { id: "share", command() {} },
  });
  const toast = f.container.children[0];
  toast.fire("mouseover");
  f.animations[0].finish();
  await p;
  assert.equal(f.timers.size, 0);
  toast.fire("mouseout", toast.querySelector("button"));
  assert.equal(f.timers.size, 0);
  await f.manager.show("copy", { timeout: 900 });
  assert.equal(f.timers.size, 0);
  toast.fire("mouseout");
  assert.equal([...f.timers.values()][0].ms, 900);
});

test("entering a fading toast restores it and cancels its removal", async () => {
  const f = fixture();
  const toast = await show(f);
  f.fireTimer();
  const fade = f.animations.at(-1);
  toast.fire("mouseover");
  fade.finish();
  await tick();
  assert.equal(toast.isConnected, true);
  assert.equal(f.timers.size, 0);
  assert.equal(toast.style.opacity, "1");
  toast.fire("mouseout");
  assert.equal(f.timers.size, 1);
});

test("leaving during entry starts the timeout only after entry completes", async () => {
  const f = fixture();
  const p = f.manager.show("copy");
  const toast = f.container.children[0];
  toast.fire("mouseover");
  toast.fire("mouseout");
  assert.equal(f.timers.size, 0);
  f.animations[0].finish();
  await p;
  assert.equal(f.timers.size, 1);
});

test("independent messages have independent lifetimes and leave the container visible", async () => {
  const f = fixture();
  await show(f, { timeout: 100 });
  await show(f, { timeout: 900 }, "other");
  assert.equal(f.timers.size, 2);
  const [id, timer] = [...f.timers].find(([, t]) => t.ms === 100);
  f.timers.delete(id);
  timer.fn();
  f.animations.at(-1).finish();
  await tick();
  assert.equal(f.container.children.length, 1);
  assert.equal(f.container.hasAttribute("hidden"), false);
  assert.equal(f.container.children[0]._messageId, "other");
});

test("debug autohide preference keeps the notification visible without a polling timer", async () => {
  const f = fixture();
  const toast = await show(f);
  f.disableAutohide();
  f.fireTimer();
  await tick();
  assert.equal(toast.isConnected, true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.animations.length, 1);
});

test("native copy replaces an existing DOM toast and passes only its current share URL", async () => {
  const requests = [];
  const f = fixture(async (_window, request) => { requests.push(request); return true; });
  const id = "zen-copy-current-url-confirmation";
  await show(f, {}, id);
  assert.equal(f.container.children.length, 1);
  await f.manager.show(id, { nativeCopyURL: { url: "https://example.org/new" }, timeout: 3000 });
  assert.equal(f.container.children.length, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(requests[0].label, "Copied Current URL");
  assert.equal(requests[0].url, "https://example.org/new");
  assert.equal(requests[0].timeout, 3000);
  await f.manager.show(id, { nativeCopyURL: {} });
  assert.equal(requests[1].url, null, "non-shareable copy cannot retain the old native URL");
});

test("unavailable native toast retains the localized DOM fallback", async () => {
  for (const native of [async () => false, async () => { throw Error("missing library"); }]) {
    const f = fixture(native);
    const promise = f.manager.show("zen-copy-current-url-confirmation", { nativeCopyURL: {} });
    await tick();
    f.animations.at(-1).finish();
    await promise;
    assert.equal(f.container.children.length, 1);
    assert.equal(f.timers.size, 1);
  }
});

test("slow localization from an earlier copy cannot replace the current native notification", async () => {
  const pending = [], requests = [];
  const f = fixture(async (_window, request) => { requests.push(request); return true; },
    () => new Promise(resolve => pending.push(resolve)));
  const id = "zen-copy-current-url-confirmation";
  const first = f.manager.show(id, { nativeCopyURL: { url: "https://example.org/old" } });
  const second = f.manager.show(id, { nativeCopyURL: { url: "https://example.org/new" } });
  pending[1]("Copied Current URL"); await second;
  pending[0]("Copied Current URL"); await first;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://example.org/new");
  assert.equal(f.container.children.length, 0);
});

test("changing Spaces while copy localization is pending discards the old notification", async () => {
  let translated;
  const requests = [];
  const f = fixture(async (_window, request) => { requests.push(request); return true; },
    () => new Promise(resolve => { translated = resolve; }));
  const shown = f.manager.show("zen-copy-current-url-confirmation", {
    nativeCopyURL: { url: "https://example.org/previous-space" },
  });
  f.window.workspace = "stanford";
  translated("Copied Current URL");
  await shown;
  assert.equal(requests.length, 0, "a completed translation must not resurrect the old Space's copy");
  assert.equal(f.container.children.length, 0);
});

test("a late native failure cannot create a fallback notification in a new Space or closed window", async () => {
  for (const change of [window => { window.workspace = "stanford"; }, window => { window.closed = true; }]) {
    for (const reject of [false, true]) {
      let finish;
      const f = fixture(() => new Promise((resolve, fail) => { finish = () => reject ? fail(Error("late failure")) : resolve(false); }));
      const shown = f.manager.show("zen-copy-current-url-confirmation", {
        nativeCopyURL: { url: "https://example.org/previous-space" },
      });
      await tick();
      change(f.window);
      finish();
      await tick();
      assert.equal(f.container.children.length, 0, "stale native completion must not start a DOM toast");
      assert.equal(f.animations.length, 0);
      await shown;
    }
  }
});

test("returning to the original Space cannot revive an old pending copy", async () => {
  let translated;
  const requests = [];
  const f = fixture(async (_window, request) => { requests.push(request); return true; },
    () => new Promise(resolve => { translated = resolve; }));
  const shown = f.manager.show("zen-copy-current-url-confirmation", {
    nativeCopyURL: { url: "https://example.org/previous-space" },
  });
  f.changeWorkspace("stanford");
  f.changeWorkspace("main");
  translated("Copied Current URL");
  await shown;
  assert.equal(requests.length, 0);
  assert.equal(f.container.children.length, 0);
  assert.equal(f.listeners.size, 0, "completed requests release the temporary Space listener");
});
