import assert from "node:assert/strict";
import test from "node:test";
import { refreshedPinnedArtwork } from "../../src/zen/tabs/ZenFavoriteArtwork.sys.mjs";

const base = { pinnedURL: "https://example.test/calendar", pageURL: "https://example.test/calendar",
  savedImage: "data:image/png;base64,old", image: "data:image/png;base64,fresh" };

test("the pinned page can refresh its stored favicon without changing its address", () => {
  assert.equal(refreshedPinnedArtwork(base), base.image);
  assert.equal(refreshedPinnedArtwork({ ...base, pageURL: base.pageURL + "#today" }), base.image);
  assert.equal(refreshedPinnedArtwork({ ...base, pinnedURL: "https://EXAMPLE.test:443/calendar" }), base.image);
});

test("different destinations cannot replace the pinned page artwork", () => {
  for (const pageURL of ["https://other.test/calendar", "https://example.test/other",
    "https://example.test/calendar?account=other", "http://example.test/calendar",
    "https://user@example.test/calendar", "about:blank", "bad URI"]) {
    assert.equal(refreshedPinnedArtwork({ ...base, pageURL }), null, pageURL);
  }
});

test("missing, error and unchanged icons never replace a saved favicon", () => {
  for (const image of [undefined, null, "", base.savedImage,
    "chrome://global/skin/icons/defaultFavicon.svg", "chrome://global/skin/icons/info.svg"]) {
    assert.equal(refreshedPinnedArtwork({ ...base, image }), null);
  }
});

test("missing pinned addresses and internal pages are not website artwork sources", () => {
  for (const pinnedURL of [undefined, "", "bad URI", "about:blank", "file:///tmp/page.html"]) {
    assert.equal(refreshedPinnedArtwork({ ...base, pinnedURL, pageURL: pinnedURL }), null);
  }
});
