import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
const read = name => readFileSync(new URL(`../../src/zen/split-view/${name}`, import.meta.url), "utf8");

function childFixture() {
  const sent = [], frames = new Map(), events = new Map(), observed = [];
  let reads = 0, serial = 0, disconnected = 0;
  const doc = { documentElement: { backgroundColor: "rgb(20, 30, 40)", colorScheme: "dark" }, body: { backgroundColor: "white" }, head: {} };
  const media = { addEventListener: (name, fn) => events.set(`media:${name}`, fn), removeEventListener: name => events.delete(`media:${name}`) };
  let observer;
  const win = {
    MutationObserver: class {
      constructor(fn) { observer = fn; }
      observe(node, options) { observed.push({ node, options }); }
      disconnect() { disconnected++; }
    },
    matchMedia: () => media,
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: name => events.delete(name),
    requestAnimationFrame: fn => { frames.set(++serial, fn); return serial; },
    cancelAnimationFrame: id => frames.delete(id),
    getComputedStyle: node => { reads++; return node; },
  };
  class Actor {
    contentWindow = win;
    document = doc;
    sendAsyncMessage(name, data) { sent.push({ name, data: JSON.parse(JSON.stringify(data)) }); }
  }
  const Child = vm.runInNewContext(read("actors/ZenSplitToolbarChild.sys.mjs").replace("export class", "class") + ";ZenSplitToolbarChild", { JSWindowActorChild: Actor });
  const actor = new Child();
  return { actor, doc, sent, frames, events, observed, get reads() { return reads; }, get disconnected() { return disconnected; },
    send: name => actor.receiveMessage({ name: `ZenSplitToolbar:${name}` }),
    change: () => observer(),
    paint: () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); },
  };
}

test("color observer is dormant until a visible split subscribes", () => {
  const f = childFixture();
  f.send("Unknown");
  assert.equal(f.reads, 0);
  assert.equal(f.observed.length, 0);
  f.send("Observe");
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.sent[0].data, { color: "rgb(20, 30, 40)", scheme: "dark" });
  f.send("Observe");
  assert.equal(f.sent.length, 1);
});

test("style bursts cost one computed-style read per frame and no duplicate IPC", () => {
  const f = childFixture(); f.send("Observe");
  for (let i = 0; i < 100; i++) f.change();
  assert.equal(f.frames.size, 1);
  assert.equal(f.reads, 1);
  f.paint();
  assert.equal(f.reads, 2);
  assert.equal(f.sent.length, 1);
  f.doc.documentElement.backgroundColor = "rgb(80, 90, 100)";
  f.change(); f.paint();
  assert.equal(f.sent.length, 2);
});

test("leaving a split cancels its pending frame and every subscription", () => {
  const f = childFixture(); f.send("Observe"); f.change(); f.send("Stop");
  assert.equal(f.frames.size, 0);
  assert.equal(f.events.size, 0);
  f.paint(); assert.equal(f.sent.length, 1);
  f.send("Observe");
  assert.equal(f.sent.length, 2, "returning to a split publishes a fresh snapshot");
  f.actor.didDestroy();
  assert.equal(f.frames.size, 0); assert.equal(f.events.size, 0);
});

test("early documents and transparent page roots have a usable fallback", () => {
  const f = childFixture(), root = f.doc.documentElement;
  f.doc.documentElement = null; f.send("Observe");
  assert.equal(f.reads, 0);
  f.doc.documentElement = root; root.backgroundColor = "rgba(0, 0, 0, 0)";
  f.events.get("DOMContentLoaded")(); f.paint();
  assert.equal(f.sent[0].data.color, "white");
  f.doc.body.backgroundColor = "transparent"; f.change(); f.paint();
  assert.equal(f.sent[1].data.color, "Canvas");
});

test("ordinary body descendants are outside the theme observer", () => {
  const f = childFixture(); f.send("Observe");
  const body = f.observed.find(x => x.node === f.doc.body);
  assert.equal(body.options.subtree, undefined);
  assert.equal(body.options.childList, undefined);
  assert.deepEqual(Array.from(body.options.attributeFilter), ["class", "style"]);
});

test("parent uses the owning chrome window and excludes nested documents", () => {
  const received = [], browser = {}, top = { embedderElement: browser, topChromeWindow: { gZenViewSplitter: { paneToolbar: { updateColor: (...args) => received.push(args) } } } };
  top.top = top;
  const Parent = vm.runInNewContext(read("actors/ZenSplitToolbarParent.sys.mjs").replace("export class", "class") + ";ZenSplitToolbarParent", { JSWindowActorParent: class {} });
  const actor = new Parent(); actor.browsingContext = top;
  actor.receiveMessage({ name: "ZenSplitToolbar:Color", data: { color: "white" } });
  assert.equal(received[0][0], browser); assert.equal(received[0][1], actor);
  actor.browsingContext = { top };
  actor.receiveMessage({ name: "ZenSplitToolbar:Color", data: { color: "black" } });
  assert.equal(received.length, 1);
});

function validatorFixture() {
  const writes = [], browser = {}, actor = {}, pane = { active: true, actor, container: { style: { setProperty: (...args) => writes.push(args) } } };
  const src = read("ZenSplitToolbar.mjs"), method = src.slice(src.indexOf("  updateColor(browser, actor, data) {"), src.indexOf("  showMenu("));
  const validator = vm.runInNewContext(`new (class { #panes=new Map([[browser,pane]]); #window={CSS:{supports:(kind,value)=>kind==='color' ? ['white','black'].includes(value) : ['light','dark','normal'].includes(value)}}; ${method} })()`, { browser, pane });
  return { writes, pane, actor, browser, update: (data, sender = actor) => validator.updateColor(browser, sender, data) };
}

test("stale or hidden page actors cannot recolor a pane", () => {
  const f = validatorFixture(); f.update({ color: "white" }, {});
  f.pane.active = false; f.update({ color: "white" });
  assert.equal(f.writes.length, 0);
});

test("content color messages cannot inject CSS declarations or excessive data", () => {
  const f = validatorFixture();
  for (const value of [null, [], { color: 7 }, { color: "w".repeat(257) }, { color: "url(https://invalid.test/payload)" }, { color: "white;display:none" }]) f.update(value);
  // Use the real CSS parser in the Gecko smoke test; this mock only accepts
  // a small color vocabulary, so declaration injection remains rejected.
  assert.equal(f.writes.length, 0);
});

test("unchanged valid color and scheme do not write browser styles again", () => {
  const f = validatorFixture();
  for (let i = 0; i < 100; i++) f.update({ color: "white", scheme: "light" });
  assert.equal(f.writes.length, 2);
});
