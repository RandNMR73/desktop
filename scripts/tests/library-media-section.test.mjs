import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import vm from "node:vm";
import { capturePreviewItem } from "../../src/zen/library/ZenLibraryCaptures.sys.mjs";

const source = readFileSync(new URL("../../src/zen/library/sections/ZenLibraryMediaSection.mjs", import.meta.url), "utf8")
  .replace(/^import .*;$/gm, "").replaceAll("export ", "");
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ privateWindow = false, enabled = true, delayedCaptures = false,
  nativeMedia = false } = {}) {
  const observers = new Map(), prefs = new Map(), scans = [], nativeScans = [], idle = new Map();
  let serial = 0, storeReads = 0, ready;
  const hidden = new Set();
  const captures = { items: [], ready: delayedCaptures ? new Promise(resolve => ready = resolve) : Promise.resolve(),
    imagePath: item => "/owned/captures/" + item.image };
  const state = { enabled };
  class SearchSection {
    isConnected = true;
    searchQuery = "";
    get filterGroups() { return []; }
    connectedCallback() {}
    disconnectedCallback() { this.isConnected = false; }
    requestUpdate() {}
  }
  const context = vm.createContext({ console,
    html: () => null, ZenLibrarySearchSection: SearchSection,
    ChromeUtils: { defineESModuleGetters(target) { Object.assign(target, {
      capturePreviewItem, CAPTURES_CHANGED: "captures-changed", HIDDEN_FILES_CHANGED: "hidden-changed",
      libraryCaptures: () => { storeReads++; return captures; },
      libraryHiddenFiles: () => ({ ready: Promise.resolve(), path: "/owned/hidden.json", has: path => hidden.has(path) }),
      ZenLibraryFileMenu: class { destroy() {} },
      ZenDownloadPreview: class {
        mediaFiles(folders, excludedPathsFile) {
          if (!nativeMedia) return Promise.resolve(null);
          return new Promise(resolve => nativeScans.push({ folders, excludedPathsFile, resolve }));
        }
        destroy() {}
      },
      nativeMediaPreview: () => ({ close() {} }),
      PrivateBrowsingUtils: { isWindowPrivate: () => privateWindow },
      extensionOf: path => path.split(".").at(-1), canDrawThumbnail: () => true,
      mediaKindOf: path => path.endsWith(".png") ? "image" : null, MEDIA_EXTENSIONS: ["png"],
    }); } },
    XPCOMUtils: { defineLazyServiceGetter(target, name) { target[name] = {
      scanMedia: (...args) => scans.push(args.at(-1)),
    }; } },
    Services: {
      prefs: { getBoolPref: () => state.enabled, getStringPref: () => "/owned/media",
        addObserver: (key, observer) => prefs.set(key, observer), removeObserver: key => prefs.delete(key) },
      obs: { addObserver: (observer, key) => observers.set(key, observer), removeObserver: (_observer, key) => observers.delete(key) },
      dirsvc: { get: () => ({ path: "/owned" }) },
    },
    PathUtils: { filename: basename, isAbsolute, join, toFileURI: path => "file://" + path },
    Ci: {}, AppConstants: { platform: "macosx" }, customElements: { define() {} },
    window: { requestIdleCallback: callback => { idle.set(++serial, callback); return serial; },
      cancelIdleCallback: id => idle.delete(id) },
  });
  const Section = vm.runInContext(source + "\nZenLibraryMediaSection", context);
  const section = new Section();
  const notice = () => observers.get("captures-changed")?.observe();
  return { section, captures, state, observers, prefs, scans, nativeScans, hidden, notice, ready,
    get storeReads() { return storeReads; },
    async start() { section.connectedCallback(); await tick(); for (const callback of idle.values()) callback(); idle.clear(); await tick(); },
    file: (name, date) => ({ path: "/owned/media/" + name, root: "/owned/media", lastModified: date, size: 10 }),
  };
}
const capture = (id, date, text = null) => ({ id, url: "https://example.invalid/" + id,
  image: id + ".png", bytes: 100, createdDate: date, text });

test("Media combines captured images with files by date and retains capture source identity", async () => {
  const f = fixture(); f.captures.items = [capture("caption", 300, "Saved words"), capture("url", 100)];
  await f.start(); f.scans[0]([f.file("ordinary.png", 200)]); await tick();
  assert.deepEqual(Array.from(f.section.items, item => item.name), ["Saved words", "ordinary.png", "https://example.invalid/url"]);
  const first = f.section.items[0];
  assert.equal(first.url, "file:///owned/captures/caption.png");
  assert.equal(first.source.url, "https://example.invalid/caption");
  assert.equal(first._zenLibraryCapture, f.captures.items[0]);
  assert.equal(f.section.loading, false);
  assert.deepEqual(f.section.filterGroups, []);
});

test("a slow folder scan merges current captures instead of overwriting intervening saves and deletions", async () => {
  const f = fixture(); await f.start();
  f.captures.items = [capture("old", 100)]; f.notice();
  f.captures.items = [capture("new", 300, "Replacement")]; f.notice();
  f.scans[0]([f.file("ordinary.png", 200)]); await tick();
  assert.deepEqual(Array.from(f.section.items, item => item.name), ["Replacement", "ordinary.png"]);
  f.captures.items = []; f.notice();
  assert.deepEqual(Array.from(f.section.items, item => item.name), ["ordinary.png"]);
});

test("hiding a folder file keeps saved captures and a disabled Media scan never starts", async () => {
  const f = fixture(); f.captures.items = [capture("kept", 300, "")];
  await f.start(); f.scans[0]([f.file("ordinary.png", 200)]); await tick();
  f.hidden.add("/owned/media/ordinary.png"); f.observers.get("hidden-changed").observe();
  assert.equal(f.section.items.length, 1); assert.equal(f.section.items[0].name, "");
  const disabled = fixture({ enabled: false }); await disabled.start();
  assert.equal(disabled.scans.length, 0);
});

test("private Media does not read the public capture store", async () => {
  const f = fixture({ privateWindow: true }); f.captures.items = [capture("public", 300)];
  await f.start(); f.scans[0]([]); await tick();
  assert.equal(f.storeReads, 0);
  assert.equal(f.observers.has("captures-changed"), false);
  assert.equal(f.section.items.length, 0);
});

test("disconnect removes subscriptions and rejects pending capture/scan completions", async () => {
  const f = fixture({ delayedCaptures: true }); await f.start();
  f.captures.items = [capture("late", 300)];
  f.section.disconnectedCallback(); f.ready(); f.scans[0]([f.file("late.png", 200)]); await tick();
  assert.equal(f.section.items.length, 0);
  assert.equal(f.observers.size, 0); assert.equal(f.prefs.size, 0);
});

test("Media bounds the combined capture and file chronology to fifty items", async () => {
  const f = fixture();
  f.captures.items = Array.from({ length: 30 }, (_, i) => capture("capture-" + i, 100 + i * 2));
  await f.start();
  f.scans[0](Array.from({ length: 60 }, (_, i) => f.file("file-" + i + ".png", 101 + i * 2)));
  await tick();
  assert.equal(f.section.items.length, 50);
  assert.equal(f.section.items[0].name, "file-59.png");
  assert.equal(f.section.items.at(-1).modified, 140);
  assert.equal(f.section.items.filter(item => item._zenLibraryCapture).length, 10);
});

test("native Media keeps UTType-eligible files and refreshes the bound after a hide", async () => {
  const f = fixture({ nativeMedia: true });
  await f.start();
  assert.equal(f.scans.length, 0);
  assert.equal(f.nativeScans[0].excludedPathsFile, "/owned/hidden.json");
  f.nativeScans[0].resolve([{ path: "/owned/media/camera.raw", kind: "image", modified: 300,
    size: 120, cloud: true }, { path: "/owned/media/clip.mov", kind: "video", modified: 200 }]);
  await tick();
  assert.equal(f.section.items[0].name, "camera.raw");
  assert.equal(f.section.items[0].cloudPlaceholder, true);
  assert.equal(f.section.items[1].kind, "video");
  f.hidden.add("/owned/media/camera.raw");
  f.observers.get("hidden-changed").observe();
  assert.deepEqual(Array.from(f.section.items, item => item.name), ["clip.mov"]);
  await tick();
  assert.equal(f.nativeScans.length, 2);
  f.nativeScans[1].resolve([{ path: "/owned/media/replacement.png", kind: "image", modified: 100 }]);
  await tick();
  assert.deepEqual(Array.from(f.section.items, item => item.name), ["replacement.png"]);
});

test("folder preference changes discard stale native Media results", async () => {
  const f = fixture({ nativeMedia: true }); await f.start();
  f.prefs.get("zen.library.media.folders").observe(); await tick();
  f.nativeScans[1].resolve([{ path: "/owned/media/current.png", kind: "image", modified: 100 }]);
  await tick();
  f.nativeScans[0].resolve([{ path: "/owned/media/stale.png", kind: "image", modified: 200 }]);
  await tick();
  assert.equal(f.section.items[0].name, "current.png");
  f.section.disconnectedCallback();
  assert.equal(f.prefs.size, 0);
});
