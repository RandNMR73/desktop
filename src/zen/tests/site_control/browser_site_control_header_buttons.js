/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

function shareButton() {
  return document.getElementById("zen-site-data-header-share");
}

add_task(async function test_share_button_reflects_scheme() {
  const tab = BrowserTestUtils.addTab(gBrowser, HTTPS_PAGE, {
    skipAnimation: true,
  });
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  await BrowserTestUtils.switchTab(gBrowser, tab);

  try {
    await openSiteDataPanel();
    ok(
      !shareButton().hasAttribute("disabled"),
      "share button is enabled on https pages",
    );
    await closeSiteDataPanel();

    await loadUrl("about:blank");

    await openSiteDataPanel();
    ok(
      shareButton().hasAttribute("disabled"),
      "share button is disabled on about:blank",
    );
    await closeSiteDataPanel();
  } finally {
    await closeSiteDataPanel();
    BrowserTestUtils.removeTab(tab);
  }
});

add_task(async function test_header_action_order_matches_arc() {
  await BrowserTestUtils.withNewTab(HTTPS_PAGE, async () => {
    try {
      await openSiteDataPanel();
      const buttons = Array.from(
        document.getElementById("zen-site-data-header").children,
      );
      Assert.deepEqual(
        buttons.map((button) => button.id),
        [
          "zen-site-data-header-share",
          "zen-site-data-header-boost",
          "zen-site-data-header-capture-portion",
          "zen-site-data-header-capture-full-page",
        ],
        "site controls expose Share, Boost, portion capture, and full-page capture",
      );
      const bounds = buttons.map((button) => button.getBoundingClientRect());
      Assert.ok(
        bounds.every((rect) => rect.width > 0 && rect.height > 0),
        "all four actions are visible",
      );
      for (let i = 1; i < bounds.length; i++) {
        Assert.ok(
          bounds[i].left >= bounds[i - 1].right,
          "visual order is not reversed by the left-sidebar layout",
        );
      }
    } finally {
      await closeSiteDataPanel();
    }
  });
});

add_task(async function test_capture_buttons_reflect_scheme() {
  await BrowserTestUtils.withNewTab(HTTPS_PAGE, async () => {
    const captureButtons = [
      "zen-site-data-header-capture-portion",
      "zen-site-data-header-capture-full-page",
    ].map((id) => document.getElementById(id));
    try {
      await openSiteDataPanel();
      for (const button of captureButtons) {
        Assert.ok(
          !button.disabled,
          button.id + " is available on an HTTPS page",
        );
      }
      await closeSiteDataPanel();
      await loadUrl("about:blank");
      await openSiteDataPanel();
      for (const button of captureButtons) {
        Assert.ok(
          button.disabled,
          button.id + " is unavailable on an internal page",
        );
      }
    } finally {
      await closeSiteDataPanel();
    }
  });
});
