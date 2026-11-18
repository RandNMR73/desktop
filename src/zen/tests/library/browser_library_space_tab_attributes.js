/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

function notifyLibraryTabAttributes(tab, changed) {
  tab.dispatchEvent(new CustomEvent("TabAttrModified", {
    bubbles: true,
    detail: { changed },
  }));
}

add_task(async function test_space_tab_attributes_preserve_copies() {
  const Library = customElements.get("zen-library");
  const tabs = Array.from({ length: 4 }, () =>
    BrowserTestUtils.addTab(gBrowser, "about:blank")
  );
  registerCleanupFunction(async () => {
    if (Library.isLibraryOpen) {
      Library.toggle("spaces");
      await TestUtils.waitForCondition(() => Library.libraryProgress === 0);
    }
    for (const tab of tabs) {
      if (tab.isConnected) {
        BrowserTestUtils.removeTab(tab);
      }
    }
  });
  const [changed, untouched] = tabs;
  changed.setAttribute("pending", "true");
  changed.setAttribute("data-library-source", "old");

  Library.toggle("spaces");
  let section;
  await TestUtils.waitForCondition(() => {
    section = document.querySelector("zen-library-spaces-section");
    return Library.libraryProgress === 1 && section?.copyForTab(changed);
  }, "the Library shows the copied tabs");
  const originalCopies = tabs.map(tab => section.copyForTab(tab));
  const copy = originalCopies[0];
  copy.setAttribute("data-library-generated", "keep");

  Library.toggle("spaces");
  await TestUtils.waitForCondition(() => Library.libraryProgress === 0,
    "the Library is closed with its columns retained");
  changed.setAttribute("label", "Changed while closed");
  changed.setAttribute("labeldirection", "rtl");
  changed.setAttribute("image", "chrome://global/skin/icons/info.svg");
  changed.setAttribute("requestcontextid", "0");
  changed.setAttribute("muted", "true");
  changed.setAttribute("soundplaying", "true");
  changed.removeAttribute("pending");
  changed.removeAttribute("data-library-source");
  notifyLibraryTabAttributes(changed, ["label", "image", "pending", "muted", "soundplaying"]);
  await TestUtils.waitForCondition(() =>
    section.copyForTab(changed).getAttribute("label") === "Changed while closed",
    "the retained copy catches up during idle time"
  );
  for (let i = 0; i < tabs.length; i++) {
    is(section.copyForTab(tabs[i]), originalCopies[i], "an attribute change keeps every copied row");
  }
  for (const name of ["label", "labeldirection", "image", "requestcontextid", "muted", "soundplaying"]) {
    is(copy.getAttribute(name), changed.getAttribute(name), `${name} follows the source tab`);
  }
  is(copy.querySelector(".tab-label").textContent, changed.getAttribute("label"),
    "the existing custom tab inherits its updated title");
  is(copy.querySelector(".tab-icon-image").getAttribute("src"), changed.getAttribute("image"),
    "the existing custom tab inherits its updated favicon");
  ok(!copy.hasAttribute("pending"), "a removed displayed attribute is removed");
  ok(!copy.hasAttribute("data-library-source"), "a removed source attribute is removed");
  is(copy.getAttribute("data-library-generated"), "keep", "copy-generated attributes survive");
  is(copy.id, `${changed.id}-copy`, "the copy keeps its separate id");
  for (const name of ["selected", "visuallyselected", "multiselected"]) {
    ok(!copy.hasAttribute(name), `the copy remains free of ${name}`);
  }

  changed.setAttribute("label", "Newest before opening");
  notifyLibraryTabAttributes(changed, ["label"]);
  Library.toggle("spaces");
  await TestUtils.waitForCondition(() => Library.libraryProgress === 1,
    "the Library reopens");
  is(section.copyForTab(changed), copy, "opening with pending attributes keeps the copy");
  is(copy.getAttribute("label"), "Newest before opening", "opening flushes pending attributes");

  changed.removeAttribute("muted");
  changed.removeAttribute("soundplaying");
  notifyLibraryTabAttributes(changed, ["muted", "soundplaying"]);
  await TestUtils.waitForCondition(() => !copy.hasAttribute("muted"),
    "visible copies also update without rebuilding");
  ok(!copy.hasAttribute("soundplaying"), "sound state removal reaches the visible copy");
  is(section.copyForTab(untouched), originalCopies[1], "visible updates leave unrelated rows alone");

  changed.setAttribute("label", "Alongside a structural change");
  notifyLibraryTabAttributes(changed, ["label"]);
  const extra = BrowserTestUtils.addTab(gBrowser, "about:blank");
  tabs.push(extra);
  await TestUtils.waitForCondition(() => section.copyForTab(extra),
    "a structural event still rebuilds the column");
  isnot(section.copyForTab(changed), copy, "structural changes use the existing rebuild path");
  is(section.copyForTab(changed).getAttribute("label"), "Alongside a structural change",
    "the structural rebuild includes queued attribute changes");
});
