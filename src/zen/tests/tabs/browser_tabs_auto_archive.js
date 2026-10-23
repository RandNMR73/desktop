/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const HOUR_MS = 60 * 60 * 1000;

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["zen.tabs.auto-archive.enabled", true],
      ["zen.tabs.auto-archive.minutes", 60],
    ],
  });
});

add_task(async function test_Archives_Only_Idle_Unpinned_Tabs() {
  const idle = BrowserTestUtils.addTab(gBrowser, "https://example.com/idle");
  const recent = BrowserTestUtils.addTab(gBrowser, "https://example.com/new");
  const pinned = BrowserTestUtils.addTab(gBrowser, "https://example.com/pin");
  gBrowser.pinTab(pinned);
  const twoHoursAgo = Date.now() - 2 * HOUR_MS;
  idle.updateLastAccessed(twoHoursAgo);
  pinned.updateLastAccessed(twoHoursAgo);

  const archived = gZenTabAutoArchive.archiveIdleTabs();

  Assert.equal(archived.length, 1, "Exactly one tab is archived");
  Assert.equal(archived[0], idle, "The idle unpinned tab is archived");
  ok(!gBrowser.tabs.includes(idle), "The idle tab is closed");
  ok(gBrowser.tabs.includes(recent), "A recently used tab stays");
  ok(gBrowser.tabs.includes(pinned), "An idle pinned tab stays");

  gBrowser.unpinTab(pinned);
  BrowserTestUtils.removeTab(recent);
  BrowserTestUtils.removeTab(pinned);
});

add_task(async function test_Selected_Tab_Is_Never_Archived() {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "https://example.com/selected"
  );
  tab.updateLastAccessed(Date.now() - 2 * HOUR_MS);

  const archived = gZenTabAutoArchive.archiveIdleTabs();

  ok(!archived.includes(tab), "The selected tab is not archived");
  ok(gBrowser.tabs.includes(tab), "The selected tab stays open");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_Disabled_Pref_Archives_Nothing() {
  await SpecialPowers.pushPrefEnv({
    set: [["zen.tabs.auto-archive.enabled", false]],
  });
  const idle = BrowserTestUtils.addTab(gBrowser, "https://example.com/idle");
  idle.updateLastAccessed(Date.now() - 2 * HOUR_MS);

  Assert.equal(
    gZenTabAutoArchive.archiveIdleTabs().length,
    0,
    "Nothing is archived while auto-archive is off"
  );
  ok(gBrowser.tabs.includes(idle), "The idle tab stays open");

  BrowserTestUtils.removeTab(idle);
  await SpecialPowers.popPrefEnv();
});
