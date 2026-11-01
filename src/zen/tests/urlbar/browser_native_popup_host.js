/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  UrlbarTestUtils: "resource://testing-common/UrlbarTestUtils.sys.mjs",
  ZenUrlbarNativeHost: "resource:///modules/ZenUrlbarNativeHost.sys.mjs",
});

add_task(async function test_native_host_preserves_editor_lifecycle_and_undo() {
  await SpecialPowers.pushPrefEnv({
    set: [["zen.view.use-single-toolbar", true]],
  });
  await TestUtils.waitForCondition(
    () => gZenVerticalTabsManager._hasSetSingleToolbar
  );
  await BrowserTestUtils.withNewTab("https://example.com/", async () => {
    const layoutSheet = "data:text/css;charset=utf-8," + encodeURIComponent(`
      #main-window :is(#urlbar, #zen-native-urlbar-layout)[open] {
        --arc-command-bar-width: 600px;
        width: min(600px, calc(100vw - 32px)) !important;
        left: 50vw !important;
        top: var(--native-host-test-top, 120px) !important;
        translate: -50% 0 !important;
      }
    `);
    window.windowUtils.loadSheetUsingURIString(
      layoutSheet,
      window.windowUtils.USER_SHEET
    );
    const originalSidebar = window.gZenNativeSidebar;
    const navbar = document.getElementById("nav-bar");
    const originalParent = navbar.parentNode;
    const originalController = gURLBar.controller;
    const originalInput = gURLBar.inputField;
    const connected = gURLBar.sapConnectedCallback;
    const disconnected = gURLBar.sapDisconnectedCallback;
    let connects = 0;
    let disconnects = 0;
    gURLBar.sapConnectedCallback = function (...args) {
      connects++;
      return connected.apply(this, args);
    };
    gURLBar.sapDisconnectedCallback = function (...args) {
      disconnects++;
      return disconnected.apply(this, args);
    };
    const host = new ZenUrlbarNativeHost(window);
    window.gZenNativeSidebar = { urlbarHost: host };
    try {
      await SimpleTest.promiseFocus(window);
      await UrlbarTestUtils.promisePopupOpen(window, () => {
        EventUtils.synthesizeKey("l", { accelKey: true }, window);
      });
      await TestUtils.waitForCondition(() => host.panel.state === "open");
      ok(host.isOpen, "The native popup owns the open editor");
      Assert.equal(gURLBar.controller, originalController);
      Assert.equal(gURLBar.inputField, originalInput);
      Assert.equal(connects, 0, "Hosting does not reconnect the address bar");
      Assert.equal(disconnects, 0, "Hosting does not disconnect the address bar");
      for (const name of ["matches", "showPopover", "hidePopover"]) {
        ok(!Object.hasOwn(gURLBar, name), `${name} remains the native DOM API`);
      }

      const originalValue = gURLBar.value;
      EventUtils.synthesizeKey("a", { accelKey: true }, window);
      EventUtils.sendString("x", window);
      await TestUtils.waitForCondition(() => gURLBar.value === "x");
      document.documentElement.style.setProperty("--native-host-test-top", "140px");
      window.dispatchEvent(new Event("resize"));
      await TestUtils.waitForCondition(
        () => Math.abs(gURLBar.getBoundingClientRect().top - 140) < 1,
        "The native popup follows the shared layout without moving the input"
      );
      EventUtils.synthesizeKey("z", { accelKey: true }, window);
      await TestUtils.waitForCondition(() => gURLBar.value === originalValue);
      Assert.equal(gURLBar.inputField.selectionStart, 0);
      Assert.equal(gURLBar.inputField.selectionEnd, originalValue.length);

      await UrlbarTestUtils.promisePopupClose(window, () => {
        gBrowser.selectedBrowser.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, button: 0 })
        );
      });
      await TestUtils.waitForCondition(() => !gURLBar.focused);
      Assert.equal(host.panel.state, "closed");
      Assert.equal(navbar.parentNode, originalParent);
      Assert.equal(connects, 0, "Restoring the toolbar preserves its connection");
      Assert.equal(disconnects, 0);
      Assert.equal(gBrowser.currentURI.spec, "https://example.com/");

      // Native dismissal can occur without the usual URL bar close command.
      await UrlbarTestUtils.promisePopupOpen(window, () => {
        EventUtils.synthesizeKey("l", { accelKey: true }, window);
      });
      await TestUtils.waitForCondition(() => host.panel.state === "open");
      await UrlbarTestUtils.promisePopupClose(window, () => host.panel.hidePopup());
      await TestUtils.waitForCondition(() => !gURLBar.focused);
      Assert.equal(navbar.parentNode, originalParent);
      ok(!host.isOpen, "Unexpected native dismissal restores the toolbar");

      // Failure to create a native window must retain the working DOM editor.
      host.panel.openPopupAtScreen = function () {
        delete this.openPopupAtScreen;
        throw new Error("Native popup unavailable in recovery test");
      };
      await UrlbarTestUtils.promisePopupOpen(window, () => {
        EventUtils.synthesizeKey("l", { accelKey: true }, window);
      });
      ok(!host.isOpen, "A failed native open releases ownership");
      ok(gURLBar.matches(":popover-open"), "The DOM popup remains available");
      Assert.equal(navbar.parentNode, originalParent);
      await UrlbarTestUtils.promisePopupClose(window, () => {
        EventUtils.synthesizeKey("KEY_Escape", {}, window);
      });

      await UrlbarTestUtils.promisePopupOpen(window, () => {
        EventUtils.synthesizeKey("l", { accelKey: true }, window);
      });
      await TestUtils.waitForCondition(() => host.panel.state === "open");
      host.destroy();
      host.destroy();
      Assert.equal(navbar.parentNode, originalParent);
      ok(!document.getElementById("zen-native-urlbar-panel"));
      ok(!document.getElementById("zen-native-urlbar-layout"));
      Assert.equal(connects, 0, "Recovery does not reconnect the editor");
      Assert.equal(disconnects, 0);
    } finally {
      host.destroy();
      window.gZenNativeSidebar = originalSidebar;
      delete gURLBar.sapConnectedCallback;
      delete gURLBar.sapDisconnectedCallback;
      document.documentElement.style.removeProperty("--native-host-test-top");
      window.windowUtils.removeSheetUsingURIString(
        layoutSheet,
        window.windowUtils.USER_SHEET
      );
    }
  });
  await SpecialPowers.popPrefEnv();
});
