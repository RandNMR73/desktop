/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  UrlbarTestUtils: "resource://testing-common/UrlbarTestUtils.sys.mjs",
});

add_task(async function test_first_outside_press_dismisses_pointer_editor() {
  await SpecialPowers.pushPrefEnv({
    set: [["zen.view.use-single-toolbar", true]],
  });
  await TestUtils.waitForCondition(
    () => gZenVerticalTabsManager._hasSetSingleToolbar,
    "The sidebar address editor is available"
  );
  await BrowserTestUtils.withNewTab("https://example.com/", async () => {
    await SimpleTest.promiseFocus(window);
    for (let cycle = 0; cycle < 3; cycle++) {
      gURLBar.blur();
      await UrlbarTestUtils.promisePopupOpen(window, () => {
        EventUtils.synthesizeMouseAtCenter(gURLBar.inputField, {}, window);
      });

      EventUtils.synthesizeMouseAtCenter(gURLBar.inputField, {}, window);
      ok(gURLBar.view.isOpen, "An inside click keeps the editor open");
      ok(
        !gURLBar._mousedownOnUrlbarDescendant,
        "The completed click did not leave a pending press"
      );

      await UrlbarTestUtils.promisePopupClose(window, () => {
        // Dispatch an outside chrome press through the real bubbling handler.
        // Using the browser element avoids a remote content-process handoff.
        gBrowser.selectedBrowser.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, button: 0 })
        );
      });
      await TestUtils.waitForCondition(
        () => !gURLBar.focused,
        "The first outside press returns focus to the page"
      );
      Assert.equal(
        gBrowser.currentURI.spec,
        "https://example.com/",
        "Dismissing the editor does not navigate"
      );
    }
  });
  await SpecialPowers.popPrefEnv();
});
