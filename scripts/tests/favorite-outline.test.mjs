import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { favoriteOutlineCacheSource } from "../../src/zen/tabs/ZenFavoriteOutlineCache.sys.mjs";

const source = readFileSync(new URL("../../src/zen/tabs/ZenFavoriteOutline.sys.mjs", import.meta.url), "utf8")
  .replaceAll("export ", "");

function fixture(shared) {
  let serial = 0;
  const images = [], identities = [], starts = shared?.starts ?? [], released = shared?.released ?? [];
  const results = shared?.results ?? new Map(), timers = new Map(), frames = new Map(), idles = new Map();
  const target = () => ({ listeners: new Map(),
    addEventListener(name, fn) { this.listeners.set(name, fn); },
    removeEventListener(name) { this.listeners.delete(name); } });
  const media = Object.assign(target(), { matches: false });
  const rootAttributes = new Map([["zen-should-be-dark-mode", "false"]]);
  const documentElement = {
    getAttribute: name => rootAttributes.get(name) ?? null,
    setAttribute: (name, value) => rootAttributes.set(name, String(value)),
    removeAttribute: name => rootAttributes.delete(name),
  };
  let appearanceChanged, disconnected = false;
  const api = shared?.api ?? {
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
    requestAnimationFrame(fn) { frames.set(++serial, fn); return serial; },
    cancelAnimationFrame: id => frames.delete(id),
    // Idle preparation of every Favorite (constructor); tests drive updates directly.
    requestIdleCallback(fn) { idles.set(++serial, fn); return serial; },
    cancelIdleCallback: id => idles.delete(id),
    getComputedStyle: icon => ({ content: "normal", width: "16px", filter: "none", ...icon }),
    Image: class {
      constructor() { this.naturalWidth = this.naturalHeight = 32; images.push(this); }
    },
    document: { documentElement, createElementNS: () => ({
      getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/png;base64,AQID",
    }) },
    gBrowser: { tabContainer: target(), selectedTab: null, tabs: [] },
  });
  const Outline = shared?.Outline ?? vm.runInContext(
    source + "\nbackend = api; ZenFavoriteOutline", vm.createContext({ api, window, console, btoa,
      ChromeUtils: { importESModule() { return { favoriteOutlineCacheSource(value) {
        identities.push(value); return favoriteOutlineCacheSource(value);
      } }; } },
    }));
  const outline = new Outline(window);
  function tab(image = "data:image/png;base64,AAAA", icon = {}) {
    const attrs = new Map([["zen-essential", "true"], ["image", image]]), properties = new Map();
    const item = { isConnected: true, icon, properties, getAttribute: n => attrs.get(n),
      setAttribute: (n, v) => attrs.set(n, v), removeAttribute: n => attrs.delete(n), hasAttribute: n => attrs.has(n),
      querySelector: () => icon, style: { setProperty: (n, v) => properties.set(n, v), removeProperty: n => properties.delete(n) } };
    window.gBrowser.tabs.push(item); return item;
  }
  const select = tab => { window.gBrowser.selectedTab = tab; outline.update(tab); };
  const selectEvent = tab => {
    window.gBrowser.selectedTab = tab;
    window.gBrowser.tabContainer.listeners.get("TabSelect")({ target: tab });
  };
  const flush = () => { const [id, fn] = timers.entries().next().value; timers.delete(id); fn(); };
  const frame = () => {
    const callbacks = [...frames.values()]; frames.clear();
    callbacks.forEach(fn => fn());
  };
  const complete = (image = images.at(-1)) => {
    image.onload?.();
    const id = starts.at(-1).id;
    results.set(id, "data:image/png;base64,T1VUTElORQ==");
    // The source's onload installs its poll last; other jobs may still have
    // independent image-load deadlines which must not fire in this step.
    const [timer, poll] = [...timers].at(-1);
    timers.delete(timer); poll();
    images.at(-1).onload();
  };
  return { api, Outline, outline, window, tab, select, selectEvent, images, identities, starts, results, released, timers, flush, complete,
    media, frames, frame, appearanceChanged, disconnected: () => disconnected };
}

const embeddedSVG = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg"/>');
const remoteSVG = (id, values = {}) => "moz-remote-image://?" + new URLSearchParams({
  url: embeddedSVG, colorScheme: "dark", contentParentId: String(id), width: "32", height: "32",
  stretch: "true", ...values,
});

test("embedded SVG borders reuse pixels across process IDs while loading the original URI", () => {
  const first = fixture(), original = remoteSVG(8), a = first.tab(original);
  first.select(a);
  assert.equal(first.images[0].src, original, "the decoding process routing is unchanged");
  first.complete();
  const sameWindow = first.tab(remoteSVG(9)); first.select(sameWindow);
  assert.equal(first.images.length, 2, "already decoded pixels apply immediately");
  assert(sameWindow.hasAttribute("zen-favorite-outline-ready"));
  first.outline.destroy();
  const second = fixture(first), b = second.tab(remoteSVG(10));
  second.select(b);
  assert.equal(second.images.length, 1);
  assert.equal(second.images[0].src, "data:image/png;base64,T1VUTElORQ==", "only decode the cached output in the new window");
  second.images[0].onload();
  assert(b.hasAttribute("zen-favorite-outline-ready"));
  assert.equal(first.starts.length, 1, "no repeated native rendering");
});

test("wrapper artwork, raster options, outer style and raw SVG remain separate", () => {
  const first = fixture(); first.select(first.tab(remoteSVG(8))); first.complete();
  const changes = [
    { source: embeddedSVG },
    { source: remoteSVG(9, { url: embeddedSVG.replace("PHN2", "QHN2") }) },
    { source: remoteSVG(9, { colorScheme: "light" }) },
    { source: remoteSVG(9, { width: "64" }) },
    { source: remoteSVG(9, { height: "64" }) },
    { source: remoteSVG(9, { stretch: "false" }) },
    { source: remoteSVG(9), icon: { width: "24px" } },
    { source: remoteSVG(9), icon: { filter: "invert(1)" } },
    { source: remoteSVG(9), scale: 1 },
  ];
  for (const change of changes) {
    const f = fixture(first), tab = f.tab(change.source, change.icon);
    if (change.scale) f.window.devicePixelRatio = change.scale;
    f.select(tab);
    assert.equal(f.images[0].src, change.source, "incompatible pixels must not be reused");
    f.complete(); f.outline.destroy();
  }
  assert.equal(first.starts.length, changes.length + 1);
});

test("source identity parsing is memoized across reconciliation and follows exact URI changes", () => {
  const largeSVG = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg"><!--' + "x".repeat(512 * 1024) + '--></svg>');
  for (const url of [embeddedSVG, largeSVG]) {
    const f = fixture(), first = remoteSVG(8, { url }), tab = f.tab(first); f.select(tab); f.complete();
    for (let i = 0; i < 12; i++) f.outline.update(tab);
    assert.equal(f.identities.length, 1);
    tab.icon.filter = "invert(1)"; f.outline.update(tab);
    assert.equal(f.identities.length, 1, "style changes do not reparse embedded bytes");
    tab.setAttribute("image", remoteSVG(9, { url })); f.outline.update(tab);
    assert.equal(f.identities.length, 2);
    assert.equal(f.images.at(-1).src, first, "equivalent pending work retains its original loading context");
    f.outline.destroy();
  }
});

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

test("another window decodes the cached border without loading or rendering its source again", () => {
  const first = fixture(), a = first.tab();
  first.select(a); first.complete(); first.outline.destroy();
  const second = fixture(first), b = second.tab(), c = second.tab();
  second.select(b); second.outline.invalidate(c);
  assert.equal(second.images.length, 1, "identical pending cache decodes share work");
  assert.equal(second.images[0].src, "data:image/png;base64,T1VUTElORQ==");
  assert.equal(b.hasAttribute("zen-favorite-outline-ready"), false);
  second.images[0].onload();
  assert.equal(b.hasAttribute("zen-favorite-outline-ready"), true);
  assert.equal(c.hasAttribute("zen-favorite-outline-ready"), true);
  assert.equal(first.starts.length, 1, "no second native render");
  assert.equal(second.timers.size, 0);
  second.select(c);
  assert.equal(second.images.length, 1, "retain the decoded cache image for subsequent selection");
});

test("a stale cached decode cannot overwrite a replacement, unpinned tab, or closed window", () => {
  for (const action of ["replace", "unpin", "close"]) {
    const first = fixture(); first.select(first.tab()); first.complete();
    const f = fixture(first), tab = f.tab(); f.select(tab);
    assert.equal(f.images[0].src, "data:image/png;base64,T1VUTElORQ==");
    const late = f.images[0].onload;
    if (action === "replace") f.outline.invalidate(tab, "data:image/png;base64,TkVX");
    if (action === "unpin") { tab.removeAttribute("zen-essential"); f.outline.invalidate(tab); }
    if (action === "close") f.outline.destroy();
    late();
    assert.equal(tab.hasAttribute("zen-favorite-outline-ready"), false);
    assert.equal(first.starts.length, 1);
    if (action === "replace") { f.complete(); assert.equal(tab.hasAttribute("zen-favorite-outline-ready"), true); }
    f.outline.destroy();
    assert.equal(f.timers.size, 0);
  }
});

test("failed and timed-out cached decodes release the queue for other artwork", () => {
  for (const fail of ["error", "timeout"]) {
    const first = fixture(); first.select(first.tab()); first.complete();
    const f = fixture(first), cached = f.tab(), next = f.tab("data:image/png;base64,TkVX");
    f.select(cached); f.outline.invalidate(next);
    assert.equal(f.images[0].src, "data:image/png;base64,T1VUTElORQ==");
    if (fail === "error") f.images[0].onerror();
    else f.flush();
    assert.equal(cached.hasAttribute("zen-favorite-outline-ready"), false);
    assert.equal(f.images.at(-1).src, next.getAttribute("image"));
    f.complete();
    assert.equal(next.hasAttribute("zen-favorite-outline-ready"), true);
    assert.equal(f.timers.size, 0);
    assert.equal(f.starts.length, 2);
  }
});

test("a cached border waits for decode() and ignores its completion after cancellation", async () => {
  for (const cancel of [false, true]) {
    const first = fixture(); first.select(first.tab()); first.complete();
    const f = fixture(first), tab = f.tab(); f.select(tab);
    let resolve;
    f.images[0].decode = () => new Promise(r => { resolve = r; });
    f.images[0].onload();
    assert.equal(tab.hasAttribute("zen-favorite-outline-ready"), false);
    if (cancel) f.outline.destroy();
    resolve(); await Promise.resolve();
    assert.equal(tab.hasAttribute("zen-favorite-outline-ready"), !cancel);
    assert.equal(f.starts.length, 1);
    assert.equal(f.timers.size, 0);
  }
});

test("different display scales and image filters do not reuse incompatible cached pixels", () => {
  const first = fixture(); first.select(first.tab()); first.complete();
  for (const mode of ["scale", "filter"]) {
    const f = fixture(first), tab = f.tab();
    if (mode === "scale") f.window.devicePixelRatio = 1;
    else tab.icon.filter = "invert(1)";
    f.select(tab);
    assert.equal(f.images[0].src, tab.getAttribute("image"));
    f.complete(); f.outline.destroy();
  }
  assert.equal(first.starts.length, 3);
});

test("replacement artwork keeps the painted border until its replacement is decoded", () => {
  const f = fixture(), tab = f.tab();
  f.select(tab); f.complete();
  f.outline.invalidate(tab, "data:image/png;base64,TkVX");
  assert.equal(f.images.at(-1).src, "data:image/png;base64,TkVX");
  assert.equal(tab.hasAttribute("zen-favorite-outline-ready"), true);
  assert.equal(tab.properties.has("--zen-favorite-outline-image"), true);
  f.complete();
  assert.equal(f.starts.length, 2);
  f.select(tab);
  assert.equal(f.starts.length, 2);
});

test("selection changes preserve in-flight preparation for both Favorites", () => {
  const f = fixture(), first = f.tab(), second = f.tab("data:image/png;base64,Qg==");
  f.select(first); f.select(second);
  assert.equal(f.images.length, 2, "one background load and one selected load");
  f.complete(f.images[0]);
  assert.equal(first.hasAttribute("zen-favorite-outline-ready"), true);
  assert.equal(second.hasAttribute("zen-favorite-outline-ready"), false);
  f.complete(f.images[1]);
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

test("a committed favicon replaces the temporary CSS fallback used by the pre-change hook", () => {
  const f = fixture(), tab = f.tab();
  f.select(tab); f.complete();
  const prepared = tab.properties.get("--zen-favorite-outline-image");
  // Tabbrowser calls the pin manager before setting image. At that point the
  // empty tab still displays Gecko's CSS fallback, despite the new source.
  tab.removeAttribute("image");
  tab.icon.content = 'url("chrome://global/skin/icons/defaultFavicon.svg")';
  f.outline.invalidate(tab, "data:image/svg+xml;base64,TkVX");
  const stale = f.images.at(-1), late = stale.onload;
  const committed = "moz-remote-image://?url=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CTkVX&colorScheme=dark";
  tab.setAttribute("image", committed);
  tab.icon.content = "normal";
  f.window.gBrowser.tabContainer.listeners.get("TabAttrModified")({
    target: tab, detail: { changed: ["image"] },
  });
  assert.equal(f.images.at(-1).src, committed, "observe the icon after Gecko commits it");
  assert.equal(stale.src, "", "cancel the superseded neutral fallback");
  late();
  assert.equal(tab.properties.get("--zen-favorite-outline-image"), prepared,
    "retain the previous colored border until the real replacement is ready");
  f.complete();
  assert.equal(f.starts.length, 2, "the canceled fallback never reaches native rendering");
  f.select(tab);
  assert.equal(f.starts.length, 2, "no extra click is required to correct the border");
});

test("favicon commits refresh unselected Favorites but ignore unrelated tab attributes", () => {
  const f = fixture(), tab = f.tab();
  f.outline.invalidate(tab, tab.getAttribute("image")); f.complete();
  const event = f.window.gBrowser.tabContainer.listeners.get("TabAttrModified");
  tab.setAttribute("image", "data:image/png;base64,TkVX");
  event({ target: tab, detail: { changed: ["label", "busy"] } });
  assert.equal(f.images.length, 2, "label and load-state events do no image work");
  event({ target: tab, detail: { changed: ["image"] } });
  assert.equal(f.images.at(-1).src, "data:image/png;base64,TkVX");
  f.complete();
  assert.equal(f.starts.length, 2);
  const ordinary = f.tab("data:image/png;base64,Qg==");
  ordinary.removeAttribute("zen-essential");
  event({ target: ordinary, detail: { changed: ["image"] } });
  assert.equal(f.starts.length, 2);
  assert.equal(f.timers.size, 0);
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
  f.window.document.documentElement.setAttribute("zen-should-be-dark-mode", "true");
  f.appearanceChanged();
  assert.equal(f.frames.size, 1, "appearance refresh waits for the next frame");
  f.frame();
  assert.equal(f.images.at(-1).src, "chrome://browser/dark.svg");
  assert.equal(tab.hasAttribute("zen-favorite-outline-ready"), true);
  f.complete();
  f.frame();
  assert.equal(f.frames.size, 0, "finish the preceding appearance's deferred selection work");
  icon.content = 'url("chrome://browser/light.svg")';
  f.media.matches = true;
  f.media.listeners.get("change")();
  assert.equal(f.frames.size, 1, "system appearance independently schedules a refresh");
  f.frame();
  assert.equal(tab.hasAttribute("zen-favorite-outline-ready"), true);
  assert.equal(f.starts.length, 2);
  f.outline.destroy();
  assert.equal(f.frames.size, 0);
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
  assert.equal(f.images.at(-1).src, "data:image/png;base64,T1VUTElORQ==",
    "the decoded pixels stay resident for the first selection paint");
});

test("failed artwork advances the queue and a pending selection gets priority", () => {
  const f = fixture(), tabs = ['A','B','C','D'].map(s => f.tab(`data:image/png;base64,${btoa(s)}`));
  for (const tab of tabs) f.outline.invalidate(tab);
  f.select(tabs[3]);
  const selectedImage = f.images[1];
  assert.equal(selectedImage.src, tabs[3].getAttribute('image'));
  f.images[0].onerror();
  const backgroundImage = f.images.at(-1);
  assert.equal(backgroundImage.src, tabs[1].getAttribute('image'));
  f.complete(selectedImage);
  assert.equal(tabs[3].hasAttribute('zen-favorite-outline-ready'), true);
  assert.equal(tabs[1].hasAttribute('zen-favorite-outline-ready'), false);
  f.complete(backgroundImage); f.complete();
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

test("Favorite selection changes immediately while page presentation still shows the previous tab", () => {
  const f = fixture(), first = f.tab(), second = f.tab("data:image/png;base64,Qg==");
  f.select(first); f.complete(); f.outline.invalidate(second); f.complete();
  first.setAttribute("visuallyselected", "true");
  f.select(second);
  assert.equal(second.hasAttribute("zen-favorite-selected"), true);
  assert.equal(first.hasAttribute("zen-favorite-selected"), false);
  assert.equal(second.hasAttribute("visuallyselected"), false, "do not change Gecko page presentation");
  assert.equal(first.hasAttribute("visuallyselected"), true);
  assert.equal(second.hasAttribute("zen-favorite-outline-ready"), true);
  assert.equal(f.starts.length, 2, "selection reveals the prepared image without new work");
});

test("Peek keeps its Favorite owner selected and promotion transfers selection away", () => {
  const f = fixture(), owner = f.tab(), peek = f.tab();
  peek.removeAttribute("zen-essential");
  let peeking = true;
  f.window.gZenGlanceManager = { getTabOrGlanceParent: tab => peeking && tab === peek ? owner : tab };
  f.select(owner); f.complete(); f.select(peek);
  assert.equal(owner.hasAttribute("zen-favorite-selected"), true);
  assert.equal(peek.hasAttribute("zen-favorite-selected"), false);
  peeking = false;
  // Promotion keeps the child selected: only the owner's visual state changes.
  f.window.gBrowser.tabContainer.listeners.get("TabAttrModified")({target: owner});
  assert.equal(owner.hasAttribute("zen-favorite-selected"), false);
});

test("selection is independent of decoding, and selecting an ordinary tab clears the Favorite", () => {
  const f = fixture(), favorite = f.tab(), ordinary = f.tab();
  ordinary.removeAttribute("zen-essential");
  f.select(favorite);
  assert.equal(favorite.hasAttribute("zen-favorite-selected"), true);
  assert.equal(favorite.hasAttribute("zen-favorite-outline-ready"), false);
  f.select(ordinary); f.complete();
  assert.equal(favorite.hasAttribute("zen-favorite-selected"), false);
  assert.equal(ordinary.hasAttribute("zen-favorite-selected"), false);
});

test("pinning a selected tab selects its tile; unpin, close and shutdown remove the marker", () => {
  for (const action of ["unpin", "close", "destroy"]) {
    const f = fixture(), tab = f.tab(); tab.removeAttribute("zen-essential"); f.select(tab);
    tab.setAttribute("zen-essential", "true"); f.outline.invalidate(tab);
    assert.equal(tab.hasAttribute("zen-favorite-selected"), true);
    if (action === "unpin") { tab.removeAttribute("zen-essential"); f.outline.invalidate(tab); }
    if (action === "close") { tab.closing = true; f.window.gBrowser.tabContainer.listeners.get("TabClose")({target: tab}); }
    if (action === "destroy") f.outline.destroy();
    assert.equal(tab.hasAttribute("zen-favorite-selected"), false);
  }
});

test("selecting a queued Favorite starts its artwork without waiting for a stalled background icon", () => {
  const f = fixture(), stalled = f.tab("https://example.invalid/slow-icon.png"), selected = f.tab();
  f.outline.invalidate(stalled);
  f.outline.invalidate(selected);
  assert.equal(f.images.length, 1, "background preparation stays bounded");
  f.select(selected);
  assert.equal(f.images.length, 2, "selection starts before the other icon loads or times out");
  assert.equal(f.images[1].src, selected.getAttribute("image"));
  assert.equal(f.images[0].src, stalled.getAttribute("image"), "preserve background loading");
  f.complete(f.images[1]);
  assert.equal(selected.hasAttribute("zen-favorite-outline-ready"), true);
  assert.equal(stalled.hasAttribute("zen-favorite-outline-ready"), false);
  f.outline.destroy();
  assert.equal(f.timers.size, 0);
});

test("TabSelect prioritizes known queued artwork before the frame without a style read", () => {
  const f = fixture(), stalled = f.tab("https://example.invalid/slow.png"), selected = f.tab();
  f.outline.invalidate(stalled); f.outline.invalidate(selected);
  let styleReads = 0;
  const getStyle = f.window.getComputedStyle;
  f.window.getComputedStyle = icon => { styleReads++; return getStyle(icon); };
  f.selectEvent(selected);
  assert.equal(selected.hasAttribute("zen-favorite-selected"), true);
  assert.equal(f.images.length, 2, "start the selected source before flushing rAF");
  assert.equal(f.images[1].src, selected.getAttribute("image"));
  assert.equal(styleReads, 0, "selection priority uses the already known artwork key");
  assert.equal(f.frames.size, 1, "keep deferred artwork reconciliation");
  f.frame();
  assert.equal(styleReads, 1);
  assert.equal(f.images.length, 2, "reconciliation does not restart the current load");
  f.complete(f.images[1]);
  assert.equal(selected.hasAttribute("zen-favorite-outline-ready"), true);
  f.outline.destroy();
  assert.equal(f.timers.size, 0);
});

test("TabSelect reveals prepared artwork immediately without additional preparation", () => {
  const f = fixture(), tab = f.tab();
  f.outline.invalidate(tab); f.complete();
  const pixels = tab.properties.get("--zen-favorite-outline-image");
  const images = f.images.length, requests = f.starts.length;
  f.selectEvent(tab);
  assert.equal(tab.hasAttribute("zen-favorite-selected"), true);
  assert.equal(tab.hasAttribute("zen-favorite-outline-ready"), true);
  assert.equal(tab.properties.get("--zen-favorite-outline-image"), pixels);
  f.frame();
  assert.equal(f.images.length, images);
  assert.equal(f.starts.length, requests);
  f.outline.destroy();
});

test("artwork committed before or after TabSelect cannot revive obsolete selection work", () => {
  for (const changeBeforeSelect of [true, false]) {
    const f = fixture(), stalled = f.tab("https://example.invalid/slow.png"), tab = f.tab();
    f.outline.invalidate(stalled); f.outline.invalidate(tab);
    let obsolete, late;
    if (!changeBeforeSelect) {
      f.selectEvent(tab);
      obsolete = f.images[1]; late = obsolete.onload;
    }
    const replacement = "data:image/png;base64,TkVX";
    tab.setAttribute("image", replacement);
    f.window.gBrowser.tabContainer.listeners.get("TabAttrModified")({
      target: tab, detail: { changed: ["image"] },
    });
    if (changeBeforeSelect) f.selectEvent(tab);
    assert.equal(f.images.at(-1).src, replacement);
    if (obsolete) {
      assert.equal(obsolete.src, "");
      late();
      assert.equal(f.starts.length, 0, "obsolete callbacks never submit native work");
    }
    const imageCount = f.images.length;
    f.frame();
    assert.equal(f.images.length, imageCount);
    f.complete();
    assert.equal(tab.hasAttribute("zen-favorite-outline-ready"), true);
    assert.equal(f.starts.length, 1, "only current artwork is rendered");
    f.outline.destroy();
    assert.equal(f.timers.size, 0);
  }
});

test("rapid pre-frame selection stays bounded with a full background queue", () => {
  const f = fixture();
  const tabs = Array.from({ length: 70 }, (_, i) => f.tab(`data:image/png;base64,${btoa(String(i))}`));
  tabs.forEach(tab => f.outline.invalidate(tab));
  assert.equal(f.images.length, 1);
  const late = [];
  for (const tab of tabs.slice(-3)) {
    f.selectEvent(tab);
    late.push(f.images.at(-1).onload);
    assert.equal(f.timers.size, 2, "one background and one selected load");
    assert.equal(f.frames.size, 1, "rapid selections share reconciliation");
    assert.equal(f.images.at(-1).src, tab.getAttribute("image"));
  }
  assert.equal(f.images[1].src, "");
  assert.equal(f.images[2].src, "");
  late[0](); late[1]();
  assert.equal(f.starts.length, 0);
  f.outline.destroy();
  late[2]();
  assert.equal(f.starts.length, 0);
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
});

test("selecting an ordinary tab before reconciliation preserves preparation without new work", () => {
  const f = fixture(), stalled = f.tab("https://example.invalid/slow.png"), favorite = f.tab(), ordinary = f.tab();
  ordinary.removeAttribute("zen-essential");
  f.outline.invalidate(stalled); f.outline.invalidate(favorite);
  f.selectEvent(favorite);
  const pending = f.images[1];
  f.selectEvent(ordinary);
  assert.equal(favorite.hasAttribute("zen-favorite-selected"), false);
  assert.equal(ordinary.hasAttribute("zen-favorite-selected"), false);
  assert.equal(f.images.length, 2);
  f.frame(); f.complete(pending);
  assert.equal(favorite.hasAttribute("zen-favorite-outline-ready"), true);
  assert.equal(favorite.hasAttribute("zen-favorite-selected"), false);
  f.outline.destroy();
  assert.equal(f.timers.size, 0);
});

test("rapid selection follows the newest Favorite and ignores the superseded load callback", () => {
  const f = fixture(), tabs = ["A", "B", "C"].map(s => f.tab(`data:image/png;base64,${btoa(s)}`));
  f.select(tabs[0]); f.select(tabs[1]);
  const superseded = f.images[1], late = superseded.onload;
  f.select(tabs[2]);
  assert.equal(superseded.src, "");
  assert.equal(f.images[2].src, tabs[2].getAttribute("image"));
  assert.equal(f.timers.size, 2, "only two outstanding loads");
  late();
  assert.equal(f.starts.length, 0, "superseded image does not create native work");
  f.complete(f.images[2]);
  assert.equal(tabs[2].hasAttribute("zen-favorite-outline-ready"), true);
  assert.equal(tabs[1].hasAttribute("zen-favorite-outline-ready"), false);
  f.complete(f.images[0]);
  assert.equal(f.images.at(-1).src, tabs[1].getAttribute("image"), "resume earlier preparation");
  const startsBeforeRetry = f.starts.length;
  late();
  assert.equal(f.starts.length, startsBeforeRetry, "old callback stays obsolete after the retry starts");
  f.complete();
  assert.equal(tabs[1].hasAttribute("zen-favorite-outline-ready"), true);
  f.outline.destroy();
  assert.equal(f.timers.size, 0);
});

test("identical selected artwork shares the priority job and close cancels only its last owner", () => {
  const f = fixture(), stalled = f.tab("https://example.invalid/slow.png"), a = f.tab(), b = f.tab();
  f.outline.invalidate(stalled); f.select(a); f.outline.invalidate(b); f.select(b);
  assert.equal(f.images.length, 2);
  a.removeAttribute("zen-essential"); f.outline.invalidate(a);
  assert.notEqual(f.images[1].src, "");
  b.closing = true; f.window.gBrowser.tabContainer.listeners.get("TabClose")({target:b});
  assert.equal(f.images[1].src, "");
  assert.equal(f.images[0].src, stalled.getAttribute("image"));
  f.outline.destroy();
  assert.equal(f.timers.size, 0);
});

test("shutdown cancels native handles in both preparation slots", () => {
  const f = fixture(), a = f.tab(), b = f.tab("data:image/png;base64,Qg==");
  f.select(a); f.select(b);
  f.images[0].onload(); f.images[1].onload();
  assert.equal(f.starts.length, 2);
  const late = [...f.timers.values()];
  f.outline.destroy();
  assert.equal(new Set(f.released).size, 2);
  assert.equal(f.timers.size, 0);
  late.forEach(fn => fn());
  assert.equal(f.timers.size, 0);
  assert.equal(a.hasAttribute("zen-favorite-outline-ready"), false);
  assert.equal(b.hasAttribute("zen-favorite-outline-ready"), false);
});
