/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
const done = arguments[arguments.length - 1];
const engineName = typeof arguments[0] === "string" ? arguments[0] : "YouTube";
(async () => {
  if (!Services.dirsvc.get("ProfD", Ci.nsIFile).path.includes("zen-search-recents-"))
    throw new Error("Requires the disposable recent-search profile");
  const { PlacesUtils: P } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const { SearchService: S } = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs");
  const { recentSiteSearches } = ChromeUtils.importESModule("resource:///modules/zen/urlbar/ZenSiteSearchHistory.sys.mjs");
  await S.init();
  const engine = S.getEngineByName(engineName), other = S.getEngineByName("Amazon");
  const db = await P.promiseDBConnection(), now = Date.now(), checks = [];
  const check = (name, actual, expected) => {
    const passed = JSON.stringify(actual) === JSON.stringify(expected);
    checks.push({ name, passed, ...(!passed && { actual, expected }) });
    if (!passed) throw new Error(name + ": " + JSON.stringify({ actual, expected }));
  };
  const url = (terms, e = engine) => e.getSubmission(terms, null, "searchbar").uri.spec;
  const visit = (terms, age, suffix = "", e = engine) => P.history.insert({
    url: url(terms, e) + suffix, title: terms || "Empty search",
    visits: [{ date: new Date(now - age * 60000), transition: P.history.TRANSITIONS.LINK }],
  });
  const recent = async options => (await recentSiteSearches(db, engine,
    value => S.parseSubmissionURL(value), { now, ...options })).map(row => row.query);
  await P.history.clear();
  for (let i = 1; i <= 6; i++) await visit(`Recent ${i}`, i);
  check("six distinct searches display only the newest five", await recent(),
    ["Recent 1", "Recent 2", "Recent 3", "Recent 4", "Recent 5"]);
  await P.history.clear();
  await visit("Newest", 1);
  await visit("newest", 2, "&fixture=variant");
  await visit("", 3);
  await visit("Middle", 4);
  await visit("Fifth page", 5);
  await visit("Outside candidate budget", 6);
  await visit("Other engine", 0.5, "", other);
  check("duplicate and empty pages consume the candidate budget", await recent(),
    ["Newest", "Middle", "Fifth page"]);
  check("the display limit does not shrink the candidate budget", await recent({ limit: 2 }),
    ["Newest", "Middle"]);
  check("cancelled reads cannot return previous scope rows", await recent({ current: () => false }), []);
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  const bar = win.gURLBar;
  bar.focus();
  bar.searchMode = { engineName: engine.name, entry: "keywordoffer", isPreview: false };
  bar.setValue("");
  await new Promise((resolve, reject) => {
    const timer = win.setTimeout(() => {
      bar.controller.removeListener(listener); reject(new Error("Query timed out"));
    }, 5000);
    const listener = { onQueryFinished(context) {
      if (context.searchString || context.searchMode?.engineName !== engine.name) return;
      win.clearTimeout(timer); bar.controller.removeListener(listener); resolve();
    } };
    bar.controller.addListener(listener);
    bar.startQuery({ searchString: "", allowAutofill: false });
  });
  const results = bar.view.visibleResults;
  check("real command bar presents exactly the bounded recent list", results.map(r => r.payload.suggestion),
    ["Newest", "Middle", "Fifth page"]);
  check("recent rows use the selected engine", results.every(r => r.payload.engine === engine.name), true);
  check("recent rows use search icons", results.every(r => r.payload.icon?.includes("search")), true);
  await P.history.remove(url("Newest"));
  check("history deletion refreshes the five-page window immediately", await recent(),
    ["newest", "Middle", "Fifth page", "Outside candidate budget"]);
  await P.history.clear();
  check("clearing history clears the scope", await recent(), []);
  bar.view.close();
  bar.searchMode = null;
  done({ passed: true, engine: engineName, checks });
})().catch(error => done({ passed: false, error: String(error), stack: error.stack }));
