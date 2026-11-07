/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
const done = arguments[arguments.length - 1];
const engineName = typeof arguments[0] === "string" ? arguments[0] : "YouTube";
(async () => {
  if (!Services.dirsvc.get("ProfD", Ci.nsIFile).path.includes("zen-search-recents-"))
    throw new Error("Requires the disposable recent-search profile");
  const { PlacesUtils: P } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const { SearchService: S } = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs");
  const { UrlbarShared: U } = ChromeUtils.importESModule("chrome://browser/content/urlbar/UrlbarShared.mjs");
  const { UrlbarResult: R } = ChromeUtils.importESModule("chrome://browser/content/urlbar/UrlbarResult.mjs");
  await S.init();
  const engine = S.getEngineByName(engineName), checks = [];
  const check = (name, actual, expected) => {
    const passed = JSON.stringify(actual) === JSON.stringify(expected);
    checks.push({ name, passed, ...(!passed && { actual, expected }) });
    if (!passed) throw new Error(name + ": " + JSON.stringify({ actual, expected }));
  };
  const cases = {
    YouTube: ["(2) Displayed title - YouTube", "(2) Displayed title"],
    Google: ["Corrected spelling - Google Search", "Corrected spelling"],
    Amazon: ["Amazon.com: Product results", "Product results"],
    Reddit: ["(42) Search results", "Search results"],
  };
  const [title, label] = cases[engineName];
  const url = engine.getSubmission("original terms", null, "searchbar").uri.spec + "&fixture=filter#section";
  await P.history.clear();
  await P.history.insert({ url, title,
    visits: [{ date: new Date(Date.now() - 1000), transition: P.history.TRANSITIONS.LINK }],
  });
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
  const results = bar.view.visibleResults;
  check("recent label uses the cleaned page title", results.map(r => r.payload.suggestion), [label]);
  const result = results[0];
  check("saved URL retains its query, extra parameters and fragment", result.payload.url, url);
  check("selection reopens the saved destination", U.getLoadRequestFromResult(result),
    { urlLoad: { url, postData: null } });
  const clone = R.fromWire(result.toWire());
  check("destination survives serialization", U.getLoadRequestFromResult(clone),
    { urlLoad: { url, postData: null } });
  check("editing starts a fresh engine search", U.getLoadRequestFromResult({
    type: U.RESULT_TYPE.SEARCH, providerName: result.providerName,
    payload: { engine: engineName, suggestion: "edited query", query: "edited" },
  }), { engineSearch: { query: "edited query", engineName } });
  check("another provider retains its ordinary engine-search behavior", U.getLoadRequestFromResult({
    type: U.RESULT_TYPE.SEARCH, providerName: "OtherProvider", payload: result.payload,
  }), { engineSearch: { query: label, engineName } });
  // The fixture blocks external networking. Exercise the real activation path
  // without submitting a search to an account or relying on remote page loads.
  bar.pickResult({ result, event: new win.KeyboardEvent("keydown", { key: "Enter" }) });
  for (let i = 0; i < 100 && (bar.searchMode || win.gBrowser.selectedBrowser.currentURI.spec !== url); i++)
    await new Promise(resolve => win.setTimeout(resolve, 50));
  check("activation opens the original URL rather than searching the display label", win.gBrowser.selectedBrowser.currentURI.spec, url);
  check("activation exits the explicit scope", bar.searchMode, null);
  await P.history.clear();
  done({ passed: true, engine: engineName, checks });
})().catch(error => done({ passed: false, engine: engineName, error: String(error), stack: error.stack }));
