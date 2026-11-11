/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const CUSTOMIZE_PAGE = getRootDirectory(gTestPath).replace(
  "chrome://mochitests/content",
  "https://example.com"
) + "file_customize_url_label.html?toolbar=return-to-sidebar";

async function customizeAndReturn() {
  const ready = BrowserTestUtils.waitForEvent(gNavToolbox, "customizationready");
  gCustomizeMode.enter();
  await ready;
  const done = BrowserTestUtils.waitForEvent(gNavToolbox, "aftercustomization");
  gCustomizeMode.exit();
  await done;
}

add_task(async function test_customization_restores_address_presentation() {
  for (const mode of [
    { name: "sidebar", single: true, compact: false, domain: true },
    { name: "floating sidebar", single: true, compact: true, domain: true },
    { name: "full address preference", single: true, compact: false, domain: false },
    { name: "double toolbar", single: false, compact: false, domain: true },
  ]) {
    const previousCompact = gZenCompactModeManager.preference;
    await SpecialPowers.pushPrefEnv({ set: [
      ["zen.view.use-single-toolbar", mode.single],
      ["zen.urlbar.show-domain-only-in-sidebar", mode.domain],
    ] });
    try {
      gZenCompactModeManager.preference = mode.compact;
      await TestUtils.waitForCondition(
        () => gZenVerticalTabsManager._hasSetSingleToolbar === mode.single &&
          gZenCompactModeManager.preference === mode.compact &&
          !document.documentElement.hasAttribute("zen-compact-animating"),
        `${mode.name}: toolbar layout is ready`
      );
      await BrowserTestUtils.withNewTab(CUSTOMIZE_PAGE, async browser => {
        browser.focus();
        gURLBar.handleRevert();
        const before = gURLBar.value;
        Assert.ok(before.includes("example.com"), "Initial address contains its host");
        if (mode.single && mode.domain) {
          Assert.equal(before, "example.com", "The sidebar initially shows only the host");
        } else {
          Assert.ok(before.includes("?toolbar="), "The full address remains available by preference");
        }
        await customizeAndReturn();
        Assert.equal(gBrowser.selectedBrowser, browser, `${mode.name}: original tab restored`);
        Assert.equal(gURLBar.value, before, `${mode.name}: address restored without reopening the editor`);
        Assert.equal(gURLBar.untrimmedValue, CUSTOMIZE_PAGE, `${mode.name}: full destination retained`);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        Assert.equal(gURLBar.value, before, `${mode.name}: later layout does not replace the address`);
        if (mode.single && mode.domain) {
          Assert.equal(gURLBar.inputField.scrollLeft, 0, `${mode.name}: compact address is not scrolled`);
        }
      });
    } finally {
      gZenCompactModeManager.preference = previousCompact;
      await TestUtils.waitForCondition(
        () => gZenCompactModeManager.preference === previousCompact &&
          !document.documentElement.hasAttribute("zen-compact-animating"),
        "Compact mode restoration finished"
      );
      await SpecialPowers.popPrefEnv();
    }
  }
});
