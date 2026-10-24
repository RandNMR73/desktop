/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../../src/zen/common/modules/ZenUIManager.mjs", import.meta.url),
  "utf8",
).replace(/^import .*;$/gm, "");

function fixture(value, decode = () => Promise.resolve()) {
  const images = [];
  const window = {
    getComputedStyle: () => ({ getPropertyValue: () => value }),
    Image: class {
      constructor() {
        images.push(this);
      }
      decode() {
        return decode(this);
      }
    },
  };
  vm.runInNewContext(source, {
    window,
    document: { documentElement: {} },
    Services: { prefs: { getBoolPref: () => false } },
    ChromeUtils: { defineLazyGetter() {} },
    nsZenToastManager: class {},
    nsZenUrlbarController: class {},
  });
  return { manager: window.gZenUIManager, images };
}

test("themes without preload metadata create no images", async () => {
  const f = fixture("");
  assert.equal((await f.manager._preloadThemeImages()).length, 0);
  assert.equal(f.images.length, 0);
});

test("only embedded PNGs are loaded, once, with asynchronous decoding", async () => {
  const f = fixture(`url("https://example.com/theme.png"),
    url("data:image/svg+xml;base64,AAAA"), url("data:image/png;base64,AQID"),
    url('data:image/png;base64,AQID'), url(data:image/png;base64,BAUG)`);
  const first = f.manager._preloadThemeImages();
  assert.equal(f.manager._preloadThemeImages(), first);
  await first;
  assert.deepEqual(
    f.images.map((image) => image.src),
    ["data:image/png;base64,AQID", "data:image/png;base64,BAUG"],
  );
  assert.ok(f.images.every((image) => image.decoding === "async"));
  assert.equal(f.manager._themeImages[0], f.images[0]);
});

test("a broken PNG cannot reject initialization or stop other decodes", async () => {
  let finish;
  const f = fixture(
    'url("data:image/png;base64,AQID"), url("data:image/png;base64,BAUG")',
    (image) =>
      image.src.endsWith("AQID")
        ? Promise.reject(new Error("Invalid PNG"))
        : new Promise((resolve) => {
            finish = resolve;
          }),
  );
  let settled = false;
  const pending = f.manager._preloadThemeImages().then((results) => {
    settled = true;
    return results;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(f.images.length, 2);
  finish();
  assert.deepEqual(
    Array.from(await pending, (r) => r.status),
    ["rejected", "fulfilled"],
  );
});

test("retained image count and individual data URL length are bounded", async () => {
  const urls = Array.from(
    { length: 40 },
    (_, i) => `url("data:image/png;base64,${"A".repeat(i + 1)}")`,
  );
  urls.unshift(`url("data:image/png;base64,${"B".repeat(1024 * 1024)}")`);
  const f = fixture(urls.join(", "));
  await f.manager._preloadThemeImages();
  assert.equal(f.images.length, 32);
  assert.ok(f.images.every((image) => image.src.length < 1024 * 1024));
});
