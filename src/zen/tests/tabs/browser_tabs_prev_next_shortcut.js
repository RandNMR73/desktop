/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_accel_alt_up_down_walks_the_sidebar() {
  const tabs = [];
  for (let i = 0; i < 3; i++) {
    tabs.push(
      await BrowserTestUtils.openNewForegroundTab(gBrowser, `data:text/html,${i}`)
    );
  }
  gBrowser.selectedTab = tabs[0];

  EventUtils.synthesizeKey("KEY_ArrowDown", { accelKey: true, altKey: true });
  Assert.equal(gBrowser.selectedTab, tabs[1], "Accel+Alt+Down selects the next tab");
  EventUtils.synthesizeKey("KEY_ArrowDown", { accelKey: true, altKey: true });
  Assert.equal(gBrowser.selectedTab, tabs[2], "and the one after it");
  EventUtils.synthesizeKey("KEY_ArrowUp", { accelKey: true, altKey: true });
  Assert.equal(gBrowser.selectedTab, tabs[1], "Accel+Alt+Up selects the previous tab");

  for (const tab of tabs) {
    BrowserTestUtils.removeTab(tab);
  }
});
