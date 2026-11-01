import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../../src/zen/compact-mode/ZenNativeSidebar.sys.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "").replace("export class ZenNativeSidebar", "class ZenNativeSidebar");
const tick = async () => { for (let i = 0; i < 6; ++i) await Promise.resolve(); };

function fixture({ delayed = false, available = true, status = 1 } = {}) {
  const frames = new Map(), observations = [], resize = [], sheets = new Set();
  let now = 0, frameId = 0, release;
  class Target {
    listeners = new Map();
    addEventListener(name, listener) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(listener);
    }
    removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
    emit(type) {
      for (const listener of [...this.listeners.get(type) ?? []]) {
        const event = { type, target: this };
        if (typeof listener === "function") listener(event); else listener.handleEvent(event);
      }
    }
  }
  class Node extends Target {
    children = []; parentNode = null; attributes = new Map(); state = "closed"; animations = [];
    style = { values: new Map(), setProperty(name, value) { this.values.set(name, value); },
      getPropertyValue(name) { return this.values.get(name) ?? ""; } };
    constructor(id = "") { super(); this.id = id; }
    get isConnected() { return this === root || !!this.parentNode?.isConnected; }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    setAttribute(name, value) { this.attributes.set(name, value); this.changed(name); }
    removeAttribute(name) { if (this.attributes.delete(name)) this.changed(name); }
    changed(name) {
      for (const o of observations) if (o.active && o.targets.some(([node, opts]) =>
        node === this && opts.attributeFilter.includes(name))) o.callback();
    }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    append(child) { this.moveBefore(child, null); }
    moveBefore(child, before) {
      child.remove();
      this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, child);
      child.parentNode = this;
    }
    before(child) { this.parentNode.moveBefore(child, this); }
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
      this.parentNode = null;
    }
    getBoundingClientRect() { return rects[this.id] ?? { x: 0, y: 0, width: 0, height: 0 }; }
    getAnimations() { return this.animations; }
    openPopupAtScreen(x, y) {
      if (native.openError) throw Error("popup failed");
      this.position = [x, y]; this.state = "open";
    }
    moveTo(x, y) { this.position = [x, y]; }
    hidePopup() {
      if (this.state === "closed") return;
      this.state = "closed"; this.emit("popuphidden");
    }
  }
  const root = new Node("root"), browser = new Node("browser"), popupSet = new Node("mainPopupSet");
  const toolbox = new Node("navigator-toolbox"), bar = new Node("urlbar");
  root.append(browser); root.append(popupSet); browser.append(toolbox); toolbox.append(bar);
  for (const name of ["zen-compact-mode", "zen-single-toolbar", "zen-sidebar-expanded"])
    root.attributes.set(name, "true");
  root.attributes.set("zen-native-theme", "");
  const rects = {
    "zen-native-sidebar-layout": { x: -4, y: 4, width: 246, height: 883 },
    "zen-native-sidebar-titlebar-layout": { x: 4, y: 4, width: 230, height: 883 },
  };
  const native = { status, calls: [], activations: [], clears: 0, destroys: 0, moves: [], applyResult: 0, activateResult: 0 };
  const surface = {
    apply: (rect, ticket) => { native.calls.push({ rect: Array.from(rect), ticket }); return native.applyResult; },
    status: () => native.status,
    activate: ticket => { native.activations.push(ticket); return native.activateResult; },
    clear: () => { native.clears++; }, destroy: () => { native.destroys++; },
  };
  bar.view = { isOpen: false };
  bar.moveToolbarForNativePopover = (parent, before, node) => {
    native.moves.push(node); parent.moveBefore(node, before);
  };
  const document = {
    documentElement: root,
    getElementById(id) {
      const find = node => node.id === id ? node : node.children.map(find).find(Boolean);
      return find(root);
    },
    createXULElement: () => new Node(), createElementNS: () => new Node(),
  };
  const window = Object.assign(new Target(), {
    document, gURLBar: bar, innerWidth: 1280, innerHeight: 891, mozInnerScreenX: 100, mozInnerScreenY: 50,
    performance: { now: () => now },
    getComputedStyle: () => ({ getPropertyValue: () => "8px" }),
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    windowUtils: { USER_SHEET: 1, loadSheetUsingURIString: uri => sheets.add(uri),
      removeSheetUsingURIString: uri => sheets.delete(uri) },
    MutationObserver: class {
      active = true; targets = [];
      constructor(callback) { this.callback = callback; observations.push(this); }
      observe(node, opts) { this.targets.push([node, opts]); }
      disconnect() { this.active = false; }
    },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; resize.push(this); }
      observe() {} disconnect() { this.disconnected = true; }
    },
  });
  const host = { destroys: 0, destroy() { this.destroys++; } };
  const pending = new Promise(resolve => { release = resolve; });
  const context = vm.createContext({
    createNativeSidebarSurface: () => delayed ? pending : Promise.resolve(available ? surface : null),
    ZenUrlbarNativeHost: class { constructor() { return host; } },
  });
  vm.runInContext(source + "\nglobalThis.Controller = ZenNativeSidebar;", context);
  const controller = new context.Controller(window);
  return {
    controller, window, root, browser, toolbox, bar, native, frames, rects, host, sheets, observations, resize,
    release: () => release(available ? surface : null),
    async frame(delta = 16) {
      await tick(); now += delta;
      const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn());
      await tick();
    },
    show() { toolbox.setAttribute("zen-user-show", "true"); },
    hide() { toolbox.removeAttribute("zen-user-show"); },
  };
}

test("compact reveal preserves original controls, applies measured geometry, and becomes idle", async () => {
  const f = fixture(); await f.frame();
  assert.equal(f.controller.isOpen, false);
  f.show(); await f.frame();
  assert.equal(f.toolbox.parentNode, f.controller.panel);
  assert.equal(f.toolbox.children[0], f.bar);
  assert.deepEqual(f.native.moves, [f.toolbox]);
  assert.deepEqual(f.native.calls[0].rect, [4, 4, 230, 883, 1280, 891]);
  assert.deepEqual(f.controller.panel.position, [104, 54]);
  assert.equal(f.controller.panel.hasAttribute("native-ready"), true);
  assert.equal(f.controller.urlbarHost, f.host);
  assert.equal(f.frames.size, 0, "ready surface does not poll");
  f.hide(); await f.frame();
  assert.equal(f.toolbox.parentNode, f.browser);
  assert.equal(f.bar.parentNode, f.toolbox);
  assert.equal(f.controller.panel.state, "closed");
  assert.equal(f.controller.urlbarHost, null);
  assert.equal(f.window.document.getElementById("zen-native-sidebar-layout"), undefined);
});

test("unsupported native bundles keep the original sidebar in place", async () => {
  const f = fixture({ available: false }); f.show(); await f.frame();
  assert.equal(f.controller.isOpen, false);
  assert.equal(f.toolbox.parentNode, f.browser);
  assert.equal(f.native.moves.length, 0);
  assert.equal(f.frames.size, 0);
});

test("hide or destruction during native loading cannot attach a late popup", async () => {
  for (const destroy of [false, true]) {
    const f = fixture({ delayed: true }); f.show(); await f.frame();
    if (destroy) f.controller.destroy(); else { f.hide(); await f.frame(); }
    f.release(); await f.frame();
    assert.equal(f.toolbox.parentNode, f.browser);
    assert.equal(f.controller.isOpen, false);
    assert.equal(f.native.calls.length, 0);
    assert.equal(f.native.destroys, destroy ? 1 : 0);
    assert.equal(f.frames.size, 0);
  }
});

test("late readiness reveals only the current request and stops waiting", async () => {
  const f = fixture({ status: 0 }); f.show(); await f.frame();
  assert.equal(f.controller.panel.hasAttribute("native-ready"), false);
  const oldTicket = f.native.calls[0].ticket;
  f.window.emit("ZenWorkspaceDataChanged"); await f.frame();
  const newTicket = f.native.calls.at(-1).ticket;
  assert.notEqual(oldTicket, newTicket);
  f.native.status = 1; await f.frame();
  assert.deepEqual(f.native.activations, [newTicket]);
  assert.equal(f.frames.size, 0);
});

test("timeout restores controls and retries only after a fresh reveal", async () => {
  const f = fixture({ status: 0 }); f.show(); await f.frame(); await f.frame(2001);
  assert.equal(f.controller.isOpen, false);
  assert.equal(f.toolbox.parentNode, f.browser);
  assert.equal(f.frames.size, 0);
  f.native.status = 1; f.window.emit("resize"); await f.frame();
  assert.equal(f.controller.isOpen, false);
  f.hide(); await f.frame(); f.show(); await f.frame();
  assert.equal(f.controller.isOpen, true);
  assert.equal(f.controller.panel.hasAttribute("native-ready"), true);
});

test("failed status, popup opening, or unexpected closure restores original controls", async () => {
  for (const failure of ["status", "open", "hidden"]) {
    const f = fixture();
    if (failure === "status") f.native.status = -1;
    if (failure === "open") f.native.openError = true;
    f.show(); await f.frame();
    if (failure === "hidden") f.controller.panel.hidePopup();
    assert.equal(f.toolbox.parentNode, f.browser, failure);
    assert.equal(f.controller.isOpen, false, failure);
    assert.equal(f.controller.panel.hasAttribute("native-ready"), false, failure);
    assert.equal(f.frames.size, 0, failure);
  }
});

test("native fallback, fullscreen, and pinned mode release the popup", async () => {
  for (const change of [
    f => f.root.removeAttribute("zen-native-theme"),
    f => f.root.setAttribute("inDOMFullscreen", "true"),
    f => f.root.setAttribute("zen-compact-mode", "false"),
    f => f.root.setAttribute("customizing", "true"),
  ]) {
    const f = fixture(); f.show(); await f.frame(); change(f); await f.frame();
    assert.equal(f.toolbox.parentNode, f.browser);
    assert.equal(f.controller.isOpen, false);
    assert.equal(f.frames.size, 0);
  }
});

test("hover, popup hold, drag, and rename preserve the existing show policy", async () => {
  for (const name of ["zen-has-hover", "has-popup-menu", "movingtab", "zen-has-empty-tab"]) {
    const f = fixture(); f.toolbox.setAttribute(name, "true"); await f.frame();
    assert.equal(f.controller.isOpen, true, name);
    f.toolbox.removeAttribute(name); await f.frame();
    assert.equal(f.controller.isOpen, false, name);
  }
  const f = fixture(); f.root.setAttribute("zen-renaming-tab", "true"); await f.frame();
  assert.equal(f.controller.isOpen, true);
  f.root.setAttribute("zen-renaming-tab", "false"); await f.frame();
  assert.equal(f.controller.isOpen, false);
});

test("an open editor delays the first move until it closes", async () => {
  const f = fixture(); f.bar.view.isOpen = true; f.show(); await f.frame();
  assert.equal(f.native.moves.length, 0);
  assert.equal(f.frames.size, 0);
  f.bar.view.isOpen = false; f.bar.setAttribute("open", "false"); await f.frame();
  assert.equal(f.controller.isOpen, true);
});

test("finite reveal animation finishes before the original controls move", async () => {
  const f = fixture(); f.toolbox.animations = [{ playState: "running" }];
  f.show(); await f.frame(); assert.equal(f.native.moves.length, 0);
  f.toolbox.animations[0].playState = "finished"; await f.frame();
  assert.equal(f.controller.isOpen, true);
  assert.equal(f.frames.size, 0);
});

test("resize coalesces and updates geometry without moving the live editor", async () => {
  const f = fixture(); f.show(); await f.frame();
  f.rects["zen-native-sidebar-layout"].height = 700;
  f.rects["zen-native-sidebar-titlebar-layout"].height = 700;
  f.window.innerHeight = 708;
  for (let i = 0; i < 20; ++i) f.window.emit("resize");
  assert.equal(f.frames.size, 1);
  await f.frame();
  assert.deepEqual(f.native.calls.at(-1).rect, [4, 4, 230, 700, 1280, 708]);
  assert.equal(f.controller.panel.style.getPropertyValue("--zen-native-sidebar-height"), "700px");
  assert.equal(f.native.moves.length, 1, "resize never detaches the editor");
  assert.equal(f.frames.size, 0);
});

test("destroy cancels readiness and removes listeners, sheets, and temporary nodes once", async () => {
  const f = fixture({ status: 0 }); f.show(); await f.frame();
  f.controller.destroy(); f.controller.destroy(); await f.frame();
  assert.equal(f.toolbox.parentNode, f.browser);
  assert.equal(f.native.destroys, 1);
  assert.equal(f.host.destroys, 1);
  assert.equal(f.sheets.size, 0);
  assert.equal(f.frames.size, 0);
  assert.equal(f.controller.panel.isConnected, false);
  assert.ok(f.observations.every(o => !o.active));
  assert.ok(f.resize.every(o => o.disconnected));
  assert.ok([...f.window.listeners.values()].every(listeners => !listeners.size));
});

test("unavailable apply or activation is bounded and restores the original sidebar", async () => {
  for (const result of ["applyResult", "activateResult"]) {
    const f = fixture(); f.native[result] = 1; f.show(); await f.frame();
    assert.equal(f.controller.panel.hasAttribute("native-ready"), false);
    await f.frame(2001);
    assert.equal(f.controller.isOpen, false);
    assert.equal(f.toolbox.parentNode, f.browser);
    assert.equal(f.frames.size, 0);
  }
});
