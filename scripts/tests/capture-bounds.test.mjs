import assert from "node:assert/strict";
import test from "node:test";

globalThis.JSWindowActorChild = class {};
const { ZenWindowCaptureChild } = await import("../../src/zen/urlbar/actors/ZenWindowCaptureChild.sys.mjs");

function bounds(overrides, fullPage = true) {
  const actor = new ZenWindowCaptureChild();
  actor.contentWindow = {
    scrollX: 0, scrollY: 600, scrollMinX: 0, scrollMinY: 0,
    innerWidth: 1200, innerHeight: 800, devicePixelRatio: 2,
    document: { documentElement: { scrollWidth: 1200, scrollHeight: 2454 } },
    windowUtils: { getScrollbarSize(flush, width, height) { width.value = height.value = 0; } },
    ...overrides,
  };
  return actor.receiveMessage({ name: fullPage ? "ZenWindowCapture:FullPageBounds" : "ZenWindowCapture:VisibleBounds" });
}

test("full document geometry is independent of current scroll position", () => {
  assert.deepEqual(bounds(), { left: 0, top: 0, right: 1200, bottom: 2454, devicePixelRatio: 2 });
  assert.deepEqual(bounds({}, false), { left: 0, top: 600, right: 1200, bottom: 1400, devicePixelRatio: 2 });
});

test("negative RTL overflow and fractional DPR retain the whole page", () => {
  assert.deepEqual(bounds({ scrollMinX: -300, scrollX: -150, devicePixelRatio: 1.25,
    document: { documentElement: { scrollWidth: 1500, scrollHeight: 2454 } } }),
  { left: -300, top: 0, right: 1200, bottom: 2454, devicePixelRatio: 1.25 });
});

test("short pages exclude non-overlay scrollbars and quirks-mode scrolling body is retained", () => {
  const value = { document: { documentElement: { scrollWidth: 100, scrollHeight: 100 } },
    windowUtils: { getScrollbarSize(flush, width, height) { width.value = height.value = 15; } } };
  assert.deepEqual(bounds(value), { left: 0, top: 0, right: 1185, bottom: 785, devicePixelRatio: 2 });
  value.document.scrollingElement = { scrollWidth: 2400, scrollHeight: 4000 };
  assert.equal(bounds(value).right, 2400);
  assert.equal(bounds(value).bottom, 4000);
});
