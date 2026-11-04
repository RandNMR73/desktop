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
  const engine = S.getEngineByName(engineName), db = await P.promiseDBConnection();
  const now = Date.now(), checks = [];
  const check = (name, actual, expected) => {
    const passed = JSON.stringify(actual) === JSON.stringify(expected);
    checks.push({ name, passed, ...(!passed && { actual, expected }) });
    if (!passed) throw new Error(name + ": " + JSON.stringify({ actual, expected }));
  };
  const url = terms => engine.getSubmission(terms, null, "searchbar").uri.spec;
  await P.history.clear();
  for (const [index, [query, title]] of [
    ["Newest", "Newest"], ["Unfinished", ""], ["Middle", "Middle"],
    ["", "Empty search"], ["Fifth", "Fifth"], ["Older", "Older"],
  ].entries()) await P.history.insert({ url: url(query), title,
    visits: [{ date: new Date(now - (index + 1) * 60000), transition: P.history.TRANSITIONS.LINK }],
  });
  const unfinished = await P.history.fetch(url("Unfinished"));
  check("fixture contains a real visit without a page title", !unfinished.title, true);
  const recent = async options => (await recentSiteSearches(db, engine,
    value => S.parseSubmissionURL(value), { now, ...options })).map(row => row.query);
  check("untitled visit is omitted without refilling from older history", await recent(),
    ["Newest", "Middle", "Fifth"]);
  const win = Services.wm.getMostRecentWindow("navigator:browser"), bar = win.gURLBar;
  bar.focus(); bar.searchMode = { engineName, entry: "keywordoffer", isPreview: false };
  bar.setValue("");
  await new Promise((resolve, reject) => {
    const timer = win.setTimeout(() => {
      bar.controller.removeListener(listener); reject(new Error("Query timed out"));
    }, 5000);
    const listener = { onQueryFinished(context) {
      if (context.searchString || context.searchMode?.engineName !== engineName) return;
      win.clearTimeout(timer); bar.controller.removeListener(listener); resolve();
    } };
    bar.controller.addListener(listener);
    bar.startQuery({ searchString: "", allowAutofill: false });
  });
  check("visible command bar excludes the untitled visit", bar.view.visibleResults.map(r => r.payload.suggestion),
    ["Newest", "Middle", "Fifth"]);
  check("rows keep the requested engine", bar.view.visibleResults.every(r => r.payload.engine === engineName), true);
  await P.history.remove(url("Newest"));
  check("deletion advances the candidate window", await recent(), ["Middle", "Fifth", "Older"]);
  await P.history.insert({ url: url("Unfinished"), title: "Unfinished",
    visits: [{ date: new Date(now - 1000), transition: P.history.TRANSITIONS.LINK }],
  });
  check("a subsequently loaded title restores the recent search", await recent(),
    ["Unfinished", "Middle", "Fifth", "Older"]);
  await P.history.clear();
  check("history clearing leaves no retained recent searches", await recent(), []);
  bar.view.close(); bar.searchMode = null;
  done({ passed: true, engine: engineName, checks });
})().catch(error => done({ passed: false, engine: engineName, error: String(error), stack: error.stack }));
