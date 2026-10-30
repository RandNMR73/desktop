import test from "node:test";
import assert from "node:assert/strict";
import { SavedSitePresentation } from "../../src/zen/urlbar/ZenUrlbarSavedSite.mjs";

const image = "data:image/png;base64,aGVsbG8=";

test("concurrent queries share cached icon reads and request titles only when needed", async () => {
  let icons = 0, titles = 0;
  const cache = new SavedSitePresentation({
    icon: async () => { icons++; return image; },
    title: async () => { titles++; return "Saved site"; },
  });
  const values = await Promise.all([
    cache.get("https://example.com/"),
    cache.get("https://example.com/", true),
    cache.get("https://example.com/", true),
  ]);
  assert.equal(icons, 1);
  assert.equal(titles, 1);
  assert.deepEqual(values[0], { icon: image, title: null });
  assert.deepEqual(values[1], { icon: image, title: "Saved site" });
  assert.deepEqual(values[2], values[1]);
});

test("closing a command session releases cached misses and titles", async () => {
  let icon = null, title = "Old title";
  const cache = new SavedSitePresentation({ icon: async () => icon, title: async () => title });
  assert.deepEqual(await cache.get("https://example.com/", true), { icon: null, title });
  icon = image; title = "New title"; cache.clear();
  assert.deepEqual(await cache.get("https://example.com/", true), { icon, title });
});

test("entry limits bound memory while recently used result reads remain deduplicated", async () => {
  const requests = [];
  const cache = new SavedSitePresentation({ limit: 2, icon: async url => { requests.push(url); return image; }, title: async () => null });
  for (const host of ["one", "two", "three", "three", "one"]) await cache.get(`https://${host}.example/`);
  assert.deepEqual(requests, ["https://one.example/", "https://two.example/", "https://three.example/", "https://one.example/"]);
});

test("invalid, credential-bearing and non-web destinations never reach Places", async () => {
  const cache = new SavedSitePresentation({ icon: () => { throw Error("Must not run"); }, title: () => { throw Error("Must not run"); } });
  for (const url of ["not a URL", "file:///tmp/file", "about:config", "https://user:secret@example.com/"]) {
    assert.equal(await cache.get(url, true), null);
  }
});

test("missing or failed data keeps a safe fallback without failing the query", async () => {
  const cache = new SavedSitePresentation({ icon: async () => { throw Error("Unavailable"); }, title: async () => { throw Error("Unavailable"); } });
  assert.deepEqual(await cache.get("https://example.com/", true), { icon: null, title: null });
});

test("only cached image data can become a favicon; titles remain plain text", async () => {
  for (const icon of ["https://remote.example/icon.png", "javascript:alert(1)", "data:text/html,hello", null]) {
    const cache = new SavedSitePresentation({ icon: async () => icon, title: async () => "<script>literal title</script>" });
    assert.deepEqual(await cache.get("https://example.com/", true), { icon: null, title: "<script>literal title</script>" });
  }
});
