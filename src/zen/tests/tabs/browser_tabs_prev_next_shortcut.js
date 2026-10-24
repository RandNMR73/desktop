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

add_task(async function test_ctrl_shift_number_focuses_split_panes() {
  const tabs = [];
  for (let i = 0; i < 2; i++) {
    tabs.push(
      await BrowserTestUtils.openNewForegroundTab(gBrowser, `data:text/html,${i}`)
    );
  }
  gZenViewSplitter.splitTabs(tabs);
  await TestUtils.waitForCondition(() => gZenViewSplitter.splitViewActive);

  EventUtils.synthesizeKey("1", { ctrlKey: true, shiftKey: true });
  Assert.equal(gBrowser.selectedTab, tabs[0], "Ctrl+Shift+1 focuses the first pane");
  EventUtils.synthesizeKey("2", { ctrlKey: true, shiftKey: true });
  Assert.equal(gBrowser.selectedTab, tabs[1], "Ctrl+Shift+2 focuses the second pane");

  gZenViewSplitter.unsplitCurrentView();
  for (const tab of tabs) {
    BrowserTestUtils.removeTab(tab);
  }
});
