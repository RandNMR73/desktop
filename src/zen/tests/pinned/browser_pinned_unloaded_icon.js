/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  PlacesTestUtils: "resource://testing-common/PlacesTestUtils.sys.mjs",
});

const PAGE_URL = "https://example.com/unloaded-icon";
const ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

add_task(async function test_Unloaded_Pin_Gets_Icon_From_Places() {
  await SpecialPowers.pushPrefEnv({
    set: [["zen.tabs.unloaded-icons-from-places", true]],
  });
  await PlacesTestUtils.addVisits(PAGE_URL);
  await PlacesTestUtils.setFaviconForPage(
    PAGE_URL,
    "https://example.com/favicon.png",
    ICON_DATA_URL
  );
  registerCleanupFunction(() => PlacesUtils.history.clear());

  const tab = BrowserTestUtils.addTab(gBrowser, PAGE_URL);
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser, false, PAGE_URL);
  gBrowser.pinTab(tab);
  await gBrowser.TabStateFlusher.flush(tab.linkedBrowser);
  gBrowser.discardBrowser(tab, true);
  gBrowser.setIcon(tab, "");
  ok(tab.hasAttribute("pending"), "The pinned tab is unloaded");
  ok(!tab.getAttribute("image"), "The unloaded pin has no icon");

  await gZenPinnedTabManager.fillUnloadedTabIcons([tab]);

  ok(
    tab.getAttribute("image")?.startsWith("data:image/png"),
    "The unloaded pin shows the favicon Places stores for its page"
  );

  gBrowser.unpinTab(tab);
  BrowserTestUtils.removeTab(tab);
  await SpecialPowers.popPrefEnv();
});
