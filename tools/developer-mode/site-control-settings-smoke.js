// Async chrome-context body; w is an isolated candidate with ten temporary
// extension actions (three grid rows including Add Extensions).
if (!Services.prefs.getBoolPref("zen.auto-pip.fixture-tests", false))
  throw new Error("Use the disposable loopback fixture profile");
const fixture = new URL(w.pipFixtureURL);
if (fixture.protocol !== "http:" || fixture.hostname !== "127.0.0.1")
  throw new Error("Use the local synthetic fixture");
const oldSpace = w.gZenWorkspaces.activeWorkspace;
const oldTab = w.gBrowser.selectedTab;
const panel = w.gZenSiteDataPanel.unifiedPanel;
const doc = w.document;
const check = (value, message) => { if (!value) throw new Error(message); };
const wait = async (test, message) => {
  const end = Date.now() + 10000;
  while (!test()) {
    check(Date.now() < end, message);
    await new Promise(resolve => w.setTimeout(resolve, 25));
  }
};
const open = async () => {
  if (panel.state !== "closed") {
    panel.hidePopup();
    await wait(() => panel.state === "closed", "panel close");
  }
  w.gZenSiteDataPanel.anchor.click();
  await wait(() => panel.state === "open", "panel open");
  await doc.l10n.translateFragment(panel);
  await new Promise(resolve => w.requestAnimationFrame(resolve));
};
const rows = [];
let tab;
try {
  for (const [index, space] of w.gZenWorkspaces.getWorkspaces().entries()) {
    panel.hidePopup();
    await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid);
    tab = w.gBrowser.addTrustedTab(fixture.href);
    w.gBrowser.selectedTab = tab;
    const browser = tab.linkedBrowser;
    await wait(() => !browser.webProgress.isLoadingDocument && browser.currentURI.spec === fixture.href, "fixture load");
    await open();
    const bounds = panel.getBoundingClientRect();
    const rect = selector => {
      const el = doc.querySelector(selector), box = el.getBoundingClientRect();
      return [box.x - bounds.x, box.y - bounds.y, box.width, box.height];
    };
    const header = [...doc.querySelectorAll("#zen-site-data-header > toolbarbutton")].map(el => rect("#" + el.id));
    const developer = doc.querySelector(".zen-site-developer-mode");
    const pip = doc.querySelector(".zen-site-auto-pip");
    const geometry = {
      panel: [bounds.width, bounds.height], header,
      extensions: rect("#zen-site-data-addons"),
      developer: rect(".zen-site-developer-mode"),
      automaticPiP: rect(".zen-site-auto-pip"),
      footer: rect("#zen-site-data-footer"),
      more: rect("#zen-site-data-actions"),
    };
    check(bounds.width === 236 && bounds.height === 377, "panel dimensions " + JSON.stringify(geometry));
    check(JSON.stringify(header) === JSON.stringify([[10,10,48,32],[66,10,48,32],[122,10,48,32],[178,10,48,32]]), "header geometry");
    check(JSON.stringify(geometry.extensions) === "[10,79,216,112]", "extension grid");
    check(JSON.stringify(geometry.developer) === "[10,233,216,32]", "developer row");
    check(JSON.stringify(geometry.automaticPiP) === "[10,276,216,32]", "PiP row");
    check(JSON.stringify(geometry.more) === "[194,335,32,32]", "more circle");
    const style = w.getComputedStyle(developer);
    check(style.fontSize === "14px" && style.color === "rgb(214, 229, 231)", "text tokens");
    const fontSize = style.fontSize, textColor = style.color;
    const wasEnabled = w.gZenDeveloperMode.enabled(browser);
    developer.click(); check(w.gZenDeveloperMode.enabled(browser) === !wasEnabled, "developer toggle");
    developer.click(); check(w.gZenDeveloperMode.enabled(browser) === wasEnabled, "developer restore");
    const policy = ChromeUtils.importESModule("resource:///modules/ZenAutoPictureInPicture.sys.mjs").ZenAutoPictureInPicture;
    const wasAllowed = policy.allowed(browser);
    pip.click(); check(policy.allowed(browser) === !wasAllowed, "PiP toggle");
    pip.click(); check(policy.allowed(browser) === wasAllowed, "PiP restore");
    doc.getElementById("zen-site-data-actions").doCommand();
    const menu = doc.getElementById("zenSiteDataActions");
    await wait(() => menu.state === "open", "actions menu");
    const protections = doc.getElementById("context_zenTrackingProtection");
    check(!protections.disabled && protections.getAttribute("checked") === String(!w.gProtectionsHandler.hasException), "protection state");
    menu.hidePopup(); panel.hidePopup();
    const previousDocument = browser.browsingContext.currentWindowGlobal.innerWindowId;
    browser.reloadWithFlags(Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE);
    await wait(() => browser.browsingContext.currentWindowGlobal?.innerWindowId !== previousDocument && !browser.webProgress.isLoadingDocument, "reload");
    developer.click(); pip.click();
    check(w.gZenDeveloperMode.enabled(browser) === wasEnabled && policy.allowed(browser) === wasAllowed, "stale settings buttons");
    const handler = w.gProtectionsHandler;
    const originalEnable = handler.enableForCurrentPage, originalDisable = handler.disableForCurrentPage;
    let changes = 0;
    try {
      handler.enableForCurrentPage = handler.disableForCurrentPage = () => changes++;
      protections.doCommand(); check(changes === 0, "stale protection menu");
      await open(); doc.getElementById("zen-site-data-actions").doCommand();
      await wait(() => menu.state === "open", "fresh actions menu");
      protections.doCommand(); check(changes === 1, "fresh protection command dispatch");
    } finally {
      handler.enableForCurrentPage = originalEnable; handler.disableForCurrentPage = originalDisable;
      menu.hidePopup(); panel.hidePopup();
    }
    rows.push({space:index + 1, geometry, fontSize, textColor,
      toggles:true, staleNavigationRejected:true, protectionsAvailable:true, protectionCommandsStubbed:true});
    w.gBrowser.removeTab(tab, {animate:false}); tab = null;
  }
  w.siteControlSettingsResults = rows;
  if (w.siteControlEvidenceDir)
    await IOUtils.writeJSON(w.siteControlEvidenceDir + "/settings-spaces.json", rows);
  return rows;
} finally {
  doc.getElementById("zenSiteDataActions").hidePopup(); panel.hidePopup();
  if (tab?.isConnected) w.gBrowser.removeTab(tab, {animate:false});
  await w.gZenWorkspaces.changeWorkspaceWithID(oldSpace);
  if (oldTab.isConnected) w.gBrowser.selectedTab = oldTab;
}
