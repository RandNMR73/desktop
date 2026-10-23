/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { SearchTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/SearchTestUtils.sys.mjs"
);
const { UrlbarTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/UrlbarTestUtils.sys.mjs"
);
SearchTestUtils.init(this);
UrlbarTestUtils.init(this);

const ENGINE = "Chip Example";

add_setup(async function () {
  await SearchTestUtils.installSearchExtension({
    name: ENGINE,
    keyword: "chip.example",
    search_url: "https://chip.example/",
  });
  await SpecialPowers.pushPrefEnv({
    set: [
      [
        "zen.urlbar.site-search.colors",
        JSON.stringify({ [ENGINE]: "rgb(255, 0, 0)" }),
      ],
    ],
  });
});

add_task(async function test_tab_on_alias_enters_site_search() {
  for (const value of ["chip.example", "https://www.Chip.Example/"]) {
    await UrlbarTestUtils.promiseAutocompleteResultPopup({ window, value });
    EventUtils.synthesizeKey("KEY_Tab");
    await UrlbarTestUtils.assertSearchMode(window, {
      engineName: ENGINE,
      entry: "tabtosearch",
    });
    Assert.equal(gURLBar.value, "", `Tab on "${value}" clears the input`);
    await TestUtils.waitForCondition(
      () => gURLBar.hasAttribute("zen-site-search"),
      "The chip is painted for the engine"
    );
    Assert.equal(
      gURLBar.style.getPropertyValue("--zen-site-search-color"),
      "rgb(255, 0, 0)",
      "The chip uses the colour from zen.urlbar.site-search.colors"
    );
    await UrlbarTestUtils.exitSearchMode(window, { backspace: true });
    Assert.ok(
      !gURLBar.hasAttribute("zen-site-search"),
      "Leaving search mode removes the chip styling"
    );
    await UrlbarTestUtils.promisePopupClose(window);
  }
});

add_task(async function test_tab_elsewhere_keeps_default_behaviour() {
  for (const [value, modifiers] of [
    ["chip.examples", {}],
    ["chip.example", { shiftKey: true }],
  ]) {
    await UrlbarTestUtils.promiseAutocompleteResultPopup({ window, value });
    EventUtils.synthesizeKey("KEY_Tab", modifiers);
    Assert.ok(
      !gURLBar.searchMode || gURLBar.searchMode.isPreview,
      `Tab on "${value}" doesn't confirm a site search`
    );
    gURLBar.searchMode = null;
    await UrlbarTestUtils.promisePopupClose(window);
  }

  await SpecialPowers.pushPrefEnv({ set: [["zen.urlbar.tab-to-search", false]] });
  await UrlbarTestUtils.promiseAutocompleteResultPopup({
    window,
    value: "chip.example",
  });
  EventUtils.synthesizeKey("KEY_Tab");
  Assert.ok(
    !gURLBar.searchMode || gURLBar.searchMode.isPreview,
    "zen.urlbar.tab-to-search=false turns the shortcut off"
  );
  gURLBar.searchMode = null;
  await UrlbarTestUtils.promisePopupClose(window);
  await SpecialPowers.popPrefEnv();
});
