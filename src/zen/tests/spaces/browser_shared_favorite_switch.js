/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function shared_favorite_and_explicit_tab_selection() {
  const originalSpace = gZenWorkspaces.activeWorkspace;
  const originalTab = gBrowser.selectedTab;
  const remembered = { ...gZenWorkspaces.lastSelectedWorkspaceTabs };
  let destination, favorite, ordinary;
  try {
    await gZenWorkspaces.createAndSaveWorkspace("Favorite continuity fixture");
    destination = gZenWorkspaces.activeWorkspace;
    ordinary = await BrowserTestUtils.openNewForegroundTab(gBrowser, "https://example.com/");
    await gZenWorkspaces.changeWorkspaceWithID(originalSpace);
    favorite = await BrowserTestUtils.openNewForegroundTab(gBrowser, "https://example.org/");
    await gZenPinnedTabManager.addToEssentials(favorite);
    const documentId = favorite.linkedBrowser.browsingContext.currentWindowGlobal.innerWindowId;
    let selections = 0;
    const onSelect = () => selections++;
    gBrowser.tabContainer.addEventListener("TabSelect", onSelect);
    try {
      await gZenWorkspaces.changeWorkspaceWithID(destination);
      await gZenWorkspaces.changeWorkspaceWithID(originalSpace);
    } finally {
      gBrowser.tabContainer.removeEventListener("TabSelect", onSelect);
    }
    is(gBrowser.selectedTab, favorite, "The shared favorite remains selected");
    is(selections, 0, "Space changes do not select an intermediate empty page");
    is(favorite.linkedBrowser.browsingContext.currentWindowGlobal.innerWindowId,
      documentId, "The favorite keeps its document");

    await gZenWorkspaces.switchTabIfNeeded(ordinary);
    await TestUtils.waitForCondition(() =>
      gZenWorkspaces.activeWorkspace === destination && gBrowser.selectedTab === ordinary,
      "An explicit tab request switches Space and selects that tab");
  } finally {
    if (favorite?.isConnected) BrowserTestUtils.removeTab(favorite);
    if (ordinary?.isConnected) BrowserTestUtils.removeTab(ordinary);
    if (destination) await gZenWorkspaces.removeWorkspace(destination);
    await gZenWorkspaces.changeWorkspaceWithID(originalSpace);
    if (originalTab.isConnected) gBrowser.selectedTab = originalTab;
    gZenWorkspaces.lastSelectedWorkspaceTabs = remembered;
  }
});
