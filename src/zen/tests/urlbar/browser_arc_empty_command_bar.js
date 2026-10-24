/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */
"use strict";
ChromeUtils.defineESModuleGetters(this, {
  UrlbarTestUtils: "resource://testing-common/UrlbarTestUtils.sys.mjs",
});

add_task(async function empty_preview_does_not_capture_web_searches() {
  const otherTab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "https://example.org/",
  );
  registerCleanupFunction(() => {
    if (!otherTab.closing) BrowserTestUtils.removeTab(otherTab);
  });
  await BrowserTestUtils.withNewTab("https://example.com/", async () => {
    await SimpleTest.promiseFocus(window);
    await UrlbarTestUtils.promiseAutocompleteResultPopup({ window, value: "" });
    await TestUtils.waitForCondition(() =>
      gURLBar.hasAttribute("zen-arc-open-tabs"),
    );
    await TestUtils.waitForCondition(() => gURLBar.view.selectedRowIndex === 0);
    Assert.equal(
      gURLBar.value,
      "",
      "Default selection must not autofill a tab URL",
    );
    Assert.ok(
      gURLBar.inputField.hasAttribute("aria-activedescendant"),
      "Default is accessible",
    );
    EventUtils.sendString("a normal web search");
    await TestUtils.waitForCondition(() => !gURLBar.searchMode);
    Assert.ok(
      !gURLBar.hasAttribute("zen-arc-open-tabs"),
      "Typing leaves the temporary mode",
    );
    EventUtils.synthesizeKey("a", { accelKey: true });
    EventUtils.synthesizeKey("KEY_Backspace");
    await TestUtils.waitForCondition(() => gURLBar.view.selectedRowIndex === 0);
    Assert.equal(
      gURLBar.value,
      "",
      "Clearing restores tabs without filling the field",
    );
    await UrlbarTestUtils.promisePopupClose(window, () =>
      EventUtils.synthesizeKey("KEY_Escape"),
    );
    Assert.ok(!gURLBar.searchMode, "Escape removes the temporary restriction");
  });
});

add_task(async function default_enter_activates_the_selected_unloaded_tab() {
  const target = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "https://example.org/?arc-recent-target",
  );
  const current = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "https://example.com/?arc-recent-current",
  );
  try {
    target.setAttribute("zen-static-label", "Renamed recent tab");
    Assert.ok(gBrowser.discardBrowser(target, true), "Target can be unloaded");
    await SimpleTest.promiseFocus(window);
    await UrlbarTestUtils.promiseAutocompleteResultPopup({ window, value: "" });
    await TestUtils.waitForCondition(() => gURLBar.view.selectedRowIndex === 0);
    Assert.equal(
      gURLBar.view.selectedResult.payload.title,
      "Renamed recent tab",
    );
    Assert.ok(target.hasAttribute("pending"), "Preview does not wake the tab");
    Assert.equal(gURLBar.value, "", "Default selection leaves the input empty");
    await BrowserTestUtils.switchTab(gBrowser, () =>
      EventUtils.synthesizeKey("KEY_Enter"),
    );
    Assert.equal(
      gBrowser.selectedTab,
      target,
      "Enter switches to that exact tab",
    );
  } finally {
    BrowserTestUtils.removeTab(current);
    BrowserTestUtils.removeTab(target);
  }
});
