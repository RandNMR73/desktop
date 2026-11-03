/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
const done = arguments[arguments.length - 1];
(async () => {
  if (!Services.dirsvc.get("ProfD", Ci.nsIFile).path.includes("zen-search-color-retention-")) {
    throw new Error("This fixture requires the disposable site-search profile.");
  }
  const { PlacesUtils: P } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const { siteSearchHistoryPage } = ChromeUtils.importESModule("resource:///modules/zen/urlbar/ZenUrlbarSiteSearch.mjs");
  const db = await P.promiseDBConnection();
  const idn = Cc["@mozilla.org/network/idn-service;1"].getService(Ci.nsIIDNService);
  await P.history.clear();
  const checks = [];
  const base = Date.now() - 100000;
  async function visit(url, step, transition = P.history.TRANSITIONS.LINK, title = "History fixture") {
    await P.history.insert({ url, title, visits: [{ date: new Date(base + step * 1000), transition }] });
  }
  async function check(name, host, expected) {
    const start = performance.now();
    const actual = await siteSearchHistoryPage(db, host, value => idn.domainToDisplay(value));
    checks.push({ name, expected, actual, passed: actual === expected, milliseconds: performance.now() - start });
  }
  const good = "https://scope.test/good";
  await visit(good, 1);
  await visit("https://notscope.test/newer", 2);
  await check("reject embedded host text", "scope.test", good);
  await visit("https://scope.test/frame", 3, P.history.TRANSITIONS.FRAMED_LINK);
  await check("hidden frame page", "scope.test", good);
  const later = "https://scope.test/later";
  await visit(later, 4);
  await visit(good, 5, P.history.TRANSITIONS.FRAMED_LINK);
  await check("old page's newer frame visit must not outrank visible visit", "scope.test", later);
  await visit("https://scope.test/download", 6, P.history.TRANSITIONS.DOWNLOAD);
  await check("download is not a visited document", "scope.test", later);
  await visit(good, 7);
  const destination = "https://destination.test/redirect-target";
  await visit(destination, 8, P.history.TRANSITIONS.REDIRECT_TEMPORARY);
  await P.withConnectionWrapper("Site-search test redirect", connection => connection.executeCached(`UPDATE moz_historyvisits SET from_visit = (
      SELECT v.id FROM moz_historyvisits v JOIN moz_places p ON p.id = v.place_id
      WHERE p.url = :source ORDER BY v.visit_date DESC LIMIT 1)
    WHERE place_id = (SELECT id FROM moz_places WHERE url = :destination)`, { source: good, destination }));
  await check("redirect source visit is excluded even after older direct visits", "scope.test", later);
  await check("redirect destination remains visible", "destination.test", destination);
  const titlePage = "https://unrelated.test/title-match";
  await visit(titlePage, 9, P.history.TRANSITIONS.LINK, "Documentation for SCOPE.TEST");
  await check("latest matching title", "scope.test", titlePage);
  await visit("https://unrelated.test/false-title", 10, P.history.TRANSITIONS.LINK, "Documentation for notscope.test");
  await check("title substring does not replace latest word match", "scope.test", titlePage);
  const unicodePage = "https://unrelated.test/unicode-title";
  await visit(unicodePage, 11, P.history.TRANSITIONS.LINK, "SCOPE.TEſT");
  await check("non-ASCII title is still filtered by word matching", "scope.test", titlePage);
  const splitPage = "https://example.test/split";
  await visit(splitPage, 12, P.history.TRANSITIONS.LINK, "Search help");
  await check("hyphenated host words may match URL and title", "search-example.test", splitPage);
  const idnPage = "https://xn--bcher-kva.test/visited";
  await visit(idnPage, 12.5);
  await check("displayed international domain contributes history words", "bücher.test", idnPage);
  await check("no matching history", "missing.test", null);
  const batchWinner = "https://batch.test/visible-winner";
  await visit(batchWinner, 20);
  for (let i = 0; i < 40; i++) {
    const url = `https://batch.test/old-page-${i}`;
    await visit(url, -200);
    await visit(url, 60, P.history.TRANSITIONS.FRAMED_LINK);
  }
  await check("continue across equal-date batches when newer activity is only in frames", "batch.test", batchWinner);
  const rootPage = "https://root-icon.test/visited";
  await visit(rootPage, 13);
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const canvas = w.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = canvas.height = 32;
  const context = canvas.getContext("2d");
  context.fillStyle = "#20a060";
  context.fillRect(0, 0, 32, 32);
  await P.favicons.setFaviconForPage(Services.io.newURI(rootPage),
    Services.io.newURI("https://root-icon.test/favicon.ico"), Services.io.newURI(canvas.toDataURL()));
  const stored = await db.executeCached(`SELECT COUNT(*) AS count FROM moz_pages_w_icons p
    JOIN moz_icons_to_pages ip ON ip.page_id = p.id WHERE p.page_url = :url`, { url: rootPage });
  const icon = await P.favicons.getFaviconForPage(Services.io.newURI(rootPage), 32);
  const { nativeSiteSearchColors } = ChromeUtils.importESModule("resource:///modules/zen/ZenNativeTheme.sys.mjs");
  const { SearchService } = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs");
  await SearchService.init();
  if (!SearchService.getEngineByName("Fixture History")) {
    await SearchService.addUserEngine({ name: "Fixture History", alias: "fixture-history",
      url: "https://scope.test/?q={searchTerms}" });
  }
  await w.gURLBar.controller.engineStore.init();
  const green = canvas.toDataURL();
  await P.favicons.setFaviconForPage(Services.io.newURI(titlePage),
    Services.io.newURI("https://unrelated.test/green.png"), Services.io.newURI(green));
  const expectedColor = (await nativeSiteSearchColors(green)).color;
  const bar = w.gURLBar;
  bar.searchMode = null;
  bar.searchMode = { engineName: "Fixture History", entry: "other" };
  bar.value = "history parity";
  bar.focus();
  await bar.startQuery({ searchString: "history parity" });
  for (let i = 0; i < 300 && bar.style.getPropertyValue("--zen-site-search-color") !== expectedColor; i++) {
    await new Promise(resolve => w.setTimeout(resolve, 20));
  }
  const actualColor = bar.style.getPropertyValue("--zen-site-search-color");
  checks.push({ name: "actual command bar uses latest matching visible history page's palette",
    expected: expectedColor, actual: actualColor, passed: actualColor === expectedColor });
  return { checks, passed: checks.every(check => check.passed),
    rootIconStorage: { directAssociations: stored[0].getResultByName("count"),
      iconAvailable: !!icon, note: "Direct association filtering alone would discard this genuinely visited page's icon." } };
})().then(done, error => done({ error: String(error), stack: error.stack }));
