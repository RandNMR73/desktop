import assert from "node:assert/strict";
import test from "node:test";
import {
  ZenWindowCapture,
  visibleCaptureRegion,
} from "../../src/zen/urlbar/ZenWindowCapture.sys.mjs";

const bounds = {
  left: 10,
  top: 500,
  right: 110,
  bottom: 550,
  devicePixelRatio: 2,
};
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const listeners = new Set(),
    progress = new Set(),
    canvases = [],
    snapshots = [];
  const counters = { captures: 0, closes: 0, encodes: 0, copies: 0 };
  const state = {
    bounds: async () => bounds,
    pixels: async () => ({
      width: 200,
      height: 100,
      close() {
        counters.closes++;
      },
    }),
    encode: async () => new Blob(["png"]),
  };
  const document = {
    getActor: () => ({ sendQuery: () => state.bounds() }),
    drawSnapshot: async (...args) => {
      counters.captures++;
      snapshots.push(args);
      return state.pixels();
    },
  };
  const browser = {
    currentURI: { spec: "http://localhost/test", scheme: "http" },
    lastLocationChange: 1,
    clientWidth: 100,
    clientHeight: 50,
    isConnected: true,
    browsingContext: { currentWindowGlobal: document },
  };
  const tab = { linkedBrowser: browser, isConnected: true, closing: false };
  const events = {
    addEventListener: (type, target) => listeners.add(type),
    removeEventListener: (type, target) => listeners.delete(type),
  };
  const window = {
    ...events,
    gBrowser: {
      selectedTab: tab,
      getTabForBrowser: (value) => (value === browser ? tab : null),
      tabContainer: events,
      addTabsProgressListener: (value) => progress.add(value),
      removeTabsProgressListener: (value) => progress.delete(value),
    },
    ScreenshotsUtils: {
      fetchVisibleBounds: (value) => {
        assert.equal(value, browser);
        return state.bounds();
      },
    },
    DOMRect: class {
      constructor(x, y, width, height) {
        Object.assign(this, { x, y, width, height });
      }
    },
    OffscreenCanvas: class {
      constructor(width, height) {
        Object.assign(this, { width, height });
        canvases.push(this);
      }
      getContext() {
        return { drawImage() {} };
      }
      convertToBlob() {
        counters.encodes++;
        return state.encode();
      }
    },
  };
  globalThis.ChromeUtils = {
    registerWindowActor() {},
    importESModule: () => ({
      BrowserUtils: { copyImageToClipboard: () => counters.copies++ },
    }),
  };
  return {
    window,
    browser,
    tab,
    state,
    counters,
    canvases,
    snapshots,
    listeners,
    progress,
    capture: new ZenWindowCapture(window),
  };
}

test("capture is lazy, page-only, honors scroll offset/DPR, and shares the PNG encoding", async () => {
  const f = fixture();
  assert.equal(f.counters.captures, 0);
  const shot = await f.capture.capture(f.browser);
  assert.deepEqual(
    { ...f.snapshots[0][0] },
    { x: 10, y: 500, width: 100, height: 50 },
  );
  assert.equal(f.snapshots[0][1], 2);
  assert.equal(f.counters.closes, 1);
  assert.equal(shot.width, 200);
  const [a, b, copied] = await Promise.all([
    shot.png(),
    shot.png(),
    shot.copy(),
  ]);
  assert.equal(a, b);
  assert.equal(copied, true);
  assert.equal(f.counters.encodes, 1);
  assert.equal(f.counters.copies, 1);
  shot.close();
  assert.equal(f.canvases[0].width, 0);
  assert.equal(shot.valid(), false);
  assert.equal(await shot.png(), null);
  assert.equal(await shot.copy(), false);
  f.capture.destroy();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.progress.size, 0);
});

const mutations = {
  select: (f) => {
    f.window.gBrowser.selectedTab = {};
  },
  close: (f) => {
    f.tab.closing = true;
  },
  disconnect: (f) => {
    f.browser.isConnected = false;
  },
  navigate: (f) => {
    f.browser.currentURI.spec = "http://localhost/new";
  },
  reload: (f) => {
    f.browser.lastLocationChange++;
  },
  document: (f) => {
    f.browser.browsingContext.currentWindowGlobal = {};
  },
  resize: (f) => {
    f.browser.clientWidth++;
  },
  destroy: (f) => f.capture.destroy(),
  space: (f) => f.capture.handleEvent({ type: "ZenWorkspacesUIUpdate" }),
};
for (const stage of ["bounds", "pixels", "encode", "buffer"]) {
  test(`stale ${stage} work never produces a current preview or clipboard write`, async () => {
    for (const [name, mutate] of Object.entries(mutations)) {
      const f = fixture(),
        gate = deferred();
      let pending, shot;
      if (stage === "bounds") f.state.bounds = () => gate.promise;
      if (stage === "pixels") f.state.pixels = () => gate.promise;
      if (stage === "encode") f.state.encode = () => gate.promise;
      if (stage === "buffer")
        f.state.encode = async () => ({ arrayBuffer: () => gate.promise });
      if (stage === "bounds" || stage === "pixels")
        pending = f.capture.capture(f.browser);
      else {
        shot = await f.capture.capture(f.browser);
        pending = shot.copy();
      }
      await Promise.resolve();
      await Promise.resolve();
      mutate(f);
      gate.resolve(
        stage === "bounds"
          ? bounds
          : stage === "pixels"
            ? {
                width: 200,
                height: 100,
                close() {
                  f.counters.closes++;
                },
              }
            : new Blob(["png"]),
      );
      assert.equal(await pending, shot ? false : null, `${stage}/${name}`);
      assert.equal(f.counters.copies, 0, `${stage}/${name}`);
      if (stage === "pixels") assert.equal(f.counters.closes, 1, name);
      f.capture.destroy();
    }
  });
}

test("an old preview cannot cancel a replacement, and navigation releases pixels", async () => {
  const f = fixture(),
    old = await f.capture.capture(f.browser);
  const replacement = await f.capture.capture(f.browser);
  old.close();
  assert.equal(replacement.valid(), true);
  f.capture.onLocationChange({}, { isTopLevel: true });
  f.capture.onLocationChange(f.browser, { isTopLevel: false });
  assert.equal(replacement.valid(), true);
  f.capture.onLocationChange(f.browser, { isTopLevel: true });
  assert.equal(await replacement.copy(), false);
  assert.ok(f.canvases.every((c) => c.width === 0));
  f.capture.destroy();
  f.capture.destroy();
  assert.equal(await f.capture.capture(f.browser), null);
});

test("capture/encoding failure releases resources and allows retry", async () => {
  const f = fixture();
  f.state.pixels = async () => {
    throw new Error("snapshot failed");
  };
  await assert.rejects(f.capture.capture(f.browser), /snapshot failed/);
  f.state.pixels = async () => ({
    width: 200,
    height: 100,
    close() {
      f.counters.closes++;
    },
  });
  const shot = await f.capture.capture(f.browser);
  f.state.encode = async () => {
    throw new Error("encoding failed");
  };
  await assert.rejects(shot.png(), /encoding failed/);
  f.state.encode = async () => new Blob(["png"]);
  assert.ok(await shot.png());
  f.capture.destroy();
});

test("invalid and excessive viewports fail before allocating a snapshot", async () => {
  for (const value of [NaN, Infinity, -1, 0])
    assert.throws(
      () => visibleCaptureRegion({ ...bounds, devicePixelRatio: value }),
      RangeError,
    );
  for (const value of [
    { right: 10 },
    { bottom: 500 },
    { right: 100000 },
    { right: 10000, bottom: 10000 },
  ])
    assert.throws(
      () => visibleCaptureRegion({ ...bounds, ...value }),
      RangeError,
    );
  const f = fixture();
  f.state.bounds = async () => ({ ...bounds, right: 100000 });
  await assert.rejects(f.capture.capture(f.browser), RangeError);
  assert.equal(f.counters.captures, 0);
  f.browser.currentURI.scheme = "about";
  assert.equal(await f.capture.capture(f.browser), null);
  f.capture.destroy();
});
