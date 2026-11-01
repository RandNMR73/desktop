import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../src/zen/tabs/ZenFavoriteOutline.sys.mjs", import.meta.url), "utf8")
  .replaceAll("export ", "");

function fixture() {
  let serial = 0;
  const images = [], starts = [], released = [], results = new Map(), timers = new Map();
  const target = () => ({ listeners: new Map(),
    addEventListener(name, fn) { this.listeners.set(name, fn); },
    removeEventListener(name) { this.listeners.delete(name); } });
  const api = {
    start(bytes, size, scale) { starts.push({ bytes, size, scale }); return ++serial; },
    read: id => results.get(id) ?? 0,
    release: id => released.push(id),
  };
  const window = Object.assign(target(), {
    devicePixelRatio: 2, performance: { now: () => 0 }, atob,
    setTimeout(fn) { timers.set(++serial, fn); return serial; },
    clearTimeout: id => timers.delete(id),
    getComputedStyle: icon => ({ content: "normal", width: "16px", filter: "none", ...icon }),
    Image: class {
      constructor() { this.naturalWidth = this.naturalHeight = 32; images.push(this); }
    },
    document: { createElementNS: () => ({
      getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/png;base64,AQID",
    }) },
    gBrowser: { tabContainer: target(), selectedTab: null },
  });
  const context = vm.createContext({ api, window, console, btoa });
  const Outline = vm.runInContext(source + "\nbackend = api; ZenFavoriteOutline", context);
  const outline = new Outline(window);
  function tab(image = "data:image/png;base64,AAAA", icon = {}) {
    const attrs = new Map([["zen-essential", "true"], ["image", image]]), properties = new Map();
    return { isConnected: true, icon, properties, getAttribute: n => attrs.get(n),
      setAttribute: (n, v) => attrs.set(n, v), removeAttribute: n => attrs.delete(n), hasAttribute: n => attrs.has(n),
      querySelector: () => icon, style: { setProperty: (n, v) => properties.set(n, v), removeProperty: n => properties.delete(n) } };
  }
  const select = tab => { window.gBrowser.selectedTab = tab; outline.update(tab); };
  const flush = () => { const [id, fn] = timers.entries().next().value; timers.delete(id); fn(); };
  const complete = () => {
    images.at(-1).onload();
    const id = serial - 1;
    results.set(id, "data:image/png;base64,T1VUTElORQ==");
    flush();
  };
  return { outline, window, tab, select, images, starts, results, released, timers, flush, complete };
}

test("identical artwork on unrelated Favorites reuses one render; unselected tabs do no work", () => {
  const f = fixture(), a = f.tab(), b = f.tab();
  f.outline.invalidate(b, b.getAttribute("image"));
  assert.equal(f.images.length, 0);
  f.select(a); f.complete();
  assert.equal(a.hasAttribute("zen-favorite-outline-ready"), true);
  f.select(b);
  assert.equal(f.starts.length, 1);
  assert.equal(b.properties.get("--zen-favorite-outline-image"), a.properties.get("--zen-favorite-outline-image"));
  assert.equal(f.timers.size, 0);
});

test("an icon event before tab.image is assigned uses the incoming icon and clears the old result", () => {
  const f = fixture(), tab = f.tab();
  f.select(tab); f.complete();
  f.outline.invalidate(tab, "data:image/png;base64,TkVX");
  assert.equal(f.images.at(-1).src, "data:image/png;base64,TkVX");
  assert.equal(tab.hasAttribute("zen-favorite-outline-ready"), false);
  assert.equal(tab.properties.has("--zen-favorite-outline-image"), false);
  f.complete();
  assert.equal(f.starts.length, 2);
});

test("late decoding after selection changes cannot start a render or paint the wrong tab", () => {
  const f = fixture(), first = f.tab(), second = f.tab("data:image/png;base64,Qg==");
  f.select(first);
  const late = f.images[0].onload;
  f.select(second); late();
  assert.equal(f.starts.length, 0);
  f.complete();
  assert.equal(first.hasAttribute("zen-favorite-outline-ready"), false);
  assert.equal(second.hasAttribute("zen-favorite-outline-ready"), true);
});

test("a removed icon cannot reuse the previous tab attribute before Gecko clears it", () => {
  const f = fixture(), tab = f.tab();
  f.select(tab); f.complete();
  f.outline.invalidate(tab, "");
  assert.equal(f.images.length, 1);
  assert.equal(tab.hasAttribute("zen-favorite-outline-ready"), false);
  assert.equal(tab.properties.has("--zen-favorite-outline-image"), false);
});

test("unpinning during processing cancels the handle and timer; stale completion is ignored", () => {
  const f = fixture(), tab = f.tab();
  f.select(tab); f.images[0].onload();
  const late = f.timers.values().next().value;
  tab.removeAttribute("zen-essential"); f.outline.invalidate(tab);
  assert.equal(f.released.length, 1);
  assert.equal(f.timers.size, 0);
  late();
  assert.equal(tab.hasAttribute("zen-favorite-outline-ready"), false);
});

test("displayed vector artwork supplies the intrinsic pixels and logical size without a site palette", () => {
  const f = fixture(), tab = f.tab("page-favicon", { content: 'url("chrome://browser/content/art.svg")', width: "40px" });
  f.select(tab);
  assert.equal(f.images[0].src, "chrome://browser/content/art.svg");
  f.complete();
  assert.equal(f.starts[0].size, 40);
  assert.equal(f.starts[0].scale, 2);
});

test("closing the window stops pending decoding, timers and listeners", () => {
  const f = fixture(); f.select(f.tab()); f.images[0].onload();
  f.outline.destroy(); f.outline.destroy();
  assert.equal(f.released.length, 1);
  assert.equal(f.timers.size, 0);
  assert.equal(f.window.listeners.size, 0);
  assert.equal(f.window.gBrowser.tabContainer.listeners.size, 0);
});
