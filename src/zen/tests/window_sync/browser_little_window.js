/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { ZenLittleWindow } = ChromeUtils.importESModule(
  "resource:///modules/zen/ZenLittleWindow.sys.mjs"
);

const PAGE = "https://example.com/";

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({
    set: [["zen.little-window.enabled", true]],
  });
});

add_task(async function test_little_window_opens_compact_and_unsynced() {
  const startupCompact = Services.prefs.getBoolPref(
    "zen.view.compact.enable-at-startup",
    false
  );
  const newWindow = BrowserTestUtils.waitForNewWindow({ url: PAGE });
  const win = ZenLittleWindow.open(window, PAGE);
  await newWindow;

  ok(ZenLittleWindow.isLittleWindow(win), "The window is a little window");
  ok(
    win.document.documentElement.hasAttribute("zen-unsynced-window"),
    "Little windows don't sync the sidebar"
  );
  await TestUtils.waitForCondition(
    () => win.gZenCompactModeManager.preference,
    "Little windows start without the sidebar"
  );
  is(
    Services.prefs.getBoolPref("zen.view.compact.enable-at-startup", false),
    startupCompact,
    "The main windows' compact mode setting is untouched"
  );
  await BrowserTestUtils.closeWindow(win);
});

add_task(async function test_move_to_main_window() {
  const newWindow = BrowserTestUtils.waitForNewWindow({ url: PAGE });
  const win = ZenLittleWindow.open(window, PAGE);
  await newWindow;

  const tabCount = gBrowser.tabs.length;
  const closed = BrowserTestUtils.domWindowClosed(win);
  ZenLittleWindow.moveToMainWindow(win);
  await closed;

  is(gBrowser.tabs.length, tabCount + 1, "The page moved into this window");
  is(
    gBrowser.selectedBrowser.currentURI.spec,
    PAGE,
    "The moved page is selected"
  );
  BrowserTestUtils.removeTab(gBrowser.selectedTab);
});

add_task(async function test_external_links_respect_prefs_and_routes() {
  const uri = Services.io.newURI(PAGE);
  const where = Ci.nsIBrowserDOMWindow.OPEN_DEFAULTWINDOW;
  await SpecialPowers.pushPrefEnv({
    set: [["zen.little-window.external-links", false]],
  });
  ok(
    !ZenLittleWindow.openExternalURI(uri, where, window, "most-recent-space"),
    "With the pref off, links from other apps open as usual"
  );
  await SpecialPowers.popPrefEnv();

  await SpecialPowers.pushPrefEnv({
    set: [["zen.little-window.external-links", true]],
  });
  ok(
    !ZenLittleWindow.openExternalURI(uri, where, window, "some-space-uuid"),
    "A space route wins over the little window"
  );
  ok(
    !ZenLittleWindow.openExternalURI(
      uri,
      Ci.nsIBrowserDOMWindow.OPEN_NEWTAB,
      window,
      "most-recent-space"
    ),
    "An explicit --new-tab keeps opening a tab"
  );
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_disabled_opens_nothing() {
  await SpecialPowers.pushPrefEnv({
    set: [["zen.little-window.enabled", false]],
  });
  is(ZenLittleWindow.open(window, PAGE), null, "Disabled: no window opens");
  await SpecialPowers.popPrefEnv();
});
