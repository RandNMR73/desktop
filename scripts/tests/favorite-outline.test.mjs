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
  const media = target();
  let appearanceChanged, disconnected = false;
  const api = {
    start(bytes, size, scale) { const id = ++serial; starts.push({ id, bytes, size, scale }); return id; },
    read: id => results.get(id) ?? 0,
    release: id => released.push(id),
  };
  const window = Object.assign(target(), {
    MutationObserver: class {
      constructor(callback) { appearanceChanged = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    },
    matchMedia: () => media,
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
    gBrowser: { tabContainer: target(), selectedTab: null, tabs: [] },
  });
  const context = vm.createContext({ api, window, console, btoa });
  const Outline = vm.runInContext(source + "\nbackend = api; ZenFavoriteOutline", context);
  const outline = new Outline(window);
  function tab(image = "data:image/png;base64,AAAA", icon = {}) {
    const attrs = new Map([["zen-essential", "true"], ["image", image]]), properties = new Map();
    const item = { isConnected: true, icon, properties, getAttribute: n => attrs.get(n),
      setAttribute: (n, v) => attrs.set(n, v), removeAttribute: n => attrs.delete(n), hasAttribute: n => attrs.has(n),
      querySelector: () => icon, style: { setProperty: (n, v) => properties.set(n, v), removeProperty: n => properties.delete(n) } };
    window.gBrowser.tabs.push(item); return item;
  }
  const select = tab => { window.gBrowser.selectedTab = tab; outline.update(tab); };
  const flush = () => { const [id, fn] = timers.entries().next().value; timers.delete(id); fn(); };
  const complete = () => {
    images.at(-1).onload?.();
    const id = starts.at(-1).id;
    results.set(id, "data:image/png;base64,T1VUTElORQ==");
    flush();
    images.at(-1).onload();
  };
  return { outline, window, tab, select, images, starts, results, released, timers, flush, complete,
    media, appearanceChanged, disconnected: () => disconnected };
}

test("unselected Favorites prepare their outlines and identical artwork shares one render", () => {
  const f = fixture(), a = f.tab(), b = f.tab();
  f.outline.invalidate(b, b.getAttribute("image"));
  assert.equal(f.images.length, 1);
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

test("selection changes preserve in-flight preparation for both Favorites", () => {
  const f = fixture(), first = f.tab(), second = f.tab("data:image/png;base64,Qg==");
  f.select(first); f.select(second);
  assert.equal(f.images.length, 1, "one bounded render at a time");
  f.complete();
  assert.equal(first.hasAttribute("zen-favorite-outline-ready"), true);
  assert.equal(second.hasAttribute("zen-favorite-outline-ready"), false);
  f.complete();
  assert.equal(second.hasAttribute("zen-favorite-outline-ready"), true);
  f.select(first);
  assert.equal(f.starts.length, 2);
});

test("a removed icon cannot reuse the previous tab attribute before Gecko clears it", () => {
  const f = fixture(), tab = f.tab();
  f.select(tab); f.complete();
  f.outline.invalidate(tab, "");
  assert.equal(f.images.length, 2);
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
  assert.equal(f.media.listeners.size, 0);
  assert.equal(f.disconnected(), true);
});

test("Space and system appearance changes refresh the selected icon's outline without a tab switch", () => {
  const f = fixture(), icon = { content: 'url("chrome://browser/light.svg")', width: "40px" };
  const tab = f.tab("page-favicon", icon);
  f.select(tab); f.complete();
  icon.content = 'url("chrome://browser/dark.svg")';
  f.appearanceChanged();
  assert.equal(f.images.at(-1).src, "chrome://browser/dark.svg");
  assert.equal(tab.hasAttribute("zen-favorite-outline-ready"), false);
  f.complete();
  icon.content = 'url("chrome://browser/light.svg")';
  f.media.listeners.get("change")();
  assert.equal(tab.hasAttribute("zen-favorite-outline-ready"), true);
  assert.equal(f.starts.length, 2);
});


test("the first click keeps a predecoded border and repeated favicon events do not reset it", () => {
  const f = fixture(), tab = f.tab();
  f.outline.invalidate(tab, tab.getAttribute("image")); f.complete();
  const before = tab.properties.get("--zen-favorite-outline-image");
  f.outline.invalidate(tab, tab.getAttribute("image"));
  f.select(tab);
  assert.equal(tab.hasAttribute("zen-favorite-outline-ready"), true);
  assert.equal(tab.properties.get("--zen-favorite-outline-image"), before);
  assert.equal(f.images.length, 2);
  assert.equal(f.starts.length, 1);
});

test("obsolete source decoding cannot replace a newly supplied icon", () => {
  const f = fixture(), tab = f.tab();
  f.outline.invalidate(tab); const late = f.images[0].onload;
  f.outline.invalidate(tab, "data:image/png;base64,TkVX"); late();
  assert.equal(f.starts.length, 0);
  f.complete();
  assert.equal(f.starts.length, 1);
  assert.equal(tab.hasAttribute("zen-favorite-outline-ready"), true);
});

test("an outline is ready only after the generated border image loads", () => {
  const f = fixture(), tab = f.tab(); f.outline.invalidate(tab);
  f.images[0].onload(); f.results.set(f.starts[0].id, "data:image/png;base64,T1VUTElORQ==");f.flush();
  assert.equal(tab.hasAttribute("zen-favorite-outline-ready"), false);
  f.images.at(-1).onload();
  assert.equal(tab.hasAttribute("zen-favorite-outline-ready"), true);
});

test("failed artwork advances the queue and a pending selection gets priority", () => {
  const f = fixture(), tabs = ['A','B','C','D'].map(s => f.tab(`data:image/png;base64,${btoa(s)}`));
  for (const tab of tabs) f.outline.invalidate(tab);
  f.select(tabs[3]);
  f.images[0].onerror();
  assert.equal(f.images.at(-1).src, tabs[3].getAttribute('image'));
  f.complete();
  assert.equal(tabs[3].hasAttribute('zen-favorite-outline-ready'), true);
  assert.equal(tabs[1].hasAttribute('zen-favorite-outline-ready'), false);
  f.complete(); f.complete();
  assert.equal(f.timers.size, 0);
});

test("background work survives selecting an ordinary tab and times out stalled artwork", () => {
  const f = fixture(), a = f.tab(), b = f.tab('data:image/png;base64,Qg=='), ordinary = f.tab();
  ordinary.removeAttribute('zen-essential');
  f.outline.invalidate(a); f.outline.invalidate(b); f.select(ordinary);
  assert.equal(f.images.length, 1);
  f.flush();
  assert.equal(f.images.at(-1).src, b.getAttribute('image'));
  f.complete();
  assert.equal(b.hasAttribute('zen-favorite-outline-ready'), true);
  assert.equal(f.timers.size, 0);
});
