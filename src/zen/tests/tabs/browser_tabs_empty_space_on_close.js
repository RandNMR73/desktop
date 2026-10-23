/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// The tab Zen moves to when `tab` closes, with every other unpinned tab
// already gone.
function nextTabWithOnlyPinsLeft(tab) {
  const otherUnpinned = gBrowser.visibleTabs.filter(
    other => !other.pinned && other !== tab
  );
  return gBrowser._findTabToBlurTo(tab, otherUnpinned);
}

add_task(async function test_Closing_Last_Unpinned_Tab_Shows_Empty_Space() {
  if (!gZenWorkspaces.workspaceEnabled) {
    ok(true, "Workspaces disabled; there is no empty space. Skipping.");
    return;
  }
  const originalTestingEnabled = gZenUIManager.testingEnabled;
  registerCleanupFunction(() => {
    gZenUIManager.testingEnabled = originalTestingEnabled;
  });

  const pinned = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "https://example.com/pinned"
  );
  gBrowser.pinTab(pinned);
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "https://example.com/unpinned"
  );
  gZenUIManager.testingEnabled = false;

  await SpecialPowers.pushPrefEnv({
    set: [["zen.workspaces.show-empty-space-on-close", false]],
  });
  ok(
    nextTabWithOnlyPinsLeft(tab)?.pinned,
    "Without the pref, the loaded pinned tab is selected next"
  );

  await SpecialPowers.pushPrefEnv({
    set: [["zen.workspaces.show-empty-space-on-close", true]],
  });
  Assert.equal(
    nextTabWithOnlyPinsLeft(tab),
    gZenWorkspaces._emptyTab,
    "With the pref, the space's empty tab is selected instead of the pin"
  );

  gZenUIManager.testingEnabled = originalTestingEnabled;
  await SpecialPowers.popPrefEnv();
  await SpecialPowers.popPrefEnv();
  BrowserTestUtils.removeTab(tab);
  gBrowser.unpinTab(pinned);
  BrowserTestUtils.removeTab(pinned);
});
