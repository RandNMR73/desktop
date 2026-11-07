const done = arguments[arguments.length - 1];
(async () => {
  if (!Services.dirsvc.get("ProfD", Ci.nsIFile).path.includes("zen-search-typed-")) {
    throw Error("Disposable profile only");
  }
  const { SearchService: S } = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs");
  const { PlacesUtils: P } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const { ZenUrlbarProviderSiteSearchHistory: Provider } = ChromeUtils.importESModule("resource:///modules/ZenUBSiteSearchHistoryProvider.sys.mjs");
  const { commandMatchingAvailable, matchCommandCandidateSignals } = ChromeUtils.importESModule("resource:///modules/zen/urlbar/ZenCommandMatching.sys.mjs");
  await S.init();
  const remote = (await S.getEngines()).find(e => e.supportsResponseType("application/x-suggestions+json"));
  if (!remote) throw Error("Remote engine fixture missing");
  const checks = [], check = (name, pass, detail) => {
    checks.push({ name, pass: !!pass, ...(pass ? {} : { detail }) });
    if (!pass) throw Error(name + ": " + JSON.stringify(detail));
  };
  const context = { searchString: "lattice", isPrivate: false, searchMode: { engineName: remote.name } };
  const p = new Provider();
  const keys = ["browser.search.suggest.enabled", "browser.urlbar.suggest.searches",
    "browser.urlbar.suggest.history", "zen.urlbar.site-search.typed-history"];
  const old = keys.map(key => ({ key, user: Services.prefs.prefHasUserValue(key),
    value: Services.prefs.getBoolPref(key, true) }));
  const w = Services.wm.getMostRecentWindow("navigator:browser"), b = w.gURLBar;
  const query = async text => {
    b.focus(); b.searchMode = { engineName: remote.name, entry: "shortcut", isPreview: false };
    b.setValue(text);
    await new Promise((resolve, reject) => {
      const timer = w.setTimeout(() => { b.controller.removeListener(listener); reject(Error("Query timed out")); }, 5000);
      const listener = { onQueryFinished(c) {
        if (c.searchString !== text || c.searchMode?.engineName !== remote.name) return;
        w.clearTimeout(timer); b.controller.removeListener(listener); resolve();
      } };
      b.controller.addListener(listener); b.startQuery({ searchString: text, allowAutofill: true });
    });
    return b.view.visibleResults.map(r => ({ title: r.payload.suggestion, provider: r.providerName }));
  };
  try {
    keys.forEach(key => Services.prefs.setBoolPref(key, true));
    check("remote-capable explicit scope uses Arc history ranking", await p.isActive(context));
    check("ordinary search retains its native provider", !(await p.isActive({ ...context, searchMode: null })));
    check("preview retains its native provider", !(await p.isActive({ ...context, searchMode: { ...context.searchMode, isPreview: true } })));
    check("private search never reads profile history", !(await p.isActive({ ...context, isPrivate: true })));
    check("missing engines do not claim typed queries", !(await p.isActive({ ...context, searchMode: { engineName: "missing-fixture-engine" } })));
    Services.prefs.setBoolPref(keys[0], false);
    check("disabled remote suggestions do not change scope routing", await p.isActive(context));
    Services.prefs.setBoolPref(keys[0], true);
    Services.prefs.setBoolPref(keys[2], false);
    check("history privacy preference is respected", !(await p.isActive(context)));
    Services.prefs.setBoolPref(keys[2], true);
    Services.prefs.setBoolPref(keys[3], false);
    check("typed adapter preference is respected", !(await p.isActive(context)));
    check("empty recent list is independent of typed adapter", await p.isActive({ ...context, searchString: "" }));
    Services.prefs.setBoolPref(keys[3], true);
    check("native matching ABI is available", commandMatchingAvailable());
    const signals = matchCommandCandidateSignals("lattice", [{ archetype: "chromiumSearchHistory", title: "lattice compiler", completionText: "lattice compiler" }]);
    check("native search completion uses the term", signals?.[0]?.completion === "lattice compiler");
    check("native matching returns title measurements", signals[0].features.titleMatchScore > 0);
    await P.history.clear();
    const url = q => remote.getSubmission(q, null, "searchbar").uri.spec;
    const now = Date.now(), day = 86400000;
    for (const [term, days] of [["lattice compiler", 1], ["lattice compiler", .5], ["lattice models", 2]]) {
      await P.history.insert({ url: url(term), title: term,
        visits: [{ date: new Date(now - days * day), transition: P.history.TRANSITIONS.LINK }] });
    }
    const typed = await query("lattice");
    check("real remote-capable scope uses only scoped results", typed.length === 3 && typed.every(r => r.provider === p.name), typed);
    check("typed scope contains history and literal", ["lattice compiler", "lattice models", "lattice"].every(t => typed.some(r => r.title === t)), typed);
    check("history completion selects only the suffix", b.value === "lattice compiler" && b.selectionStart === 7 && b.selectionEnd === 16,
      { value: b.value, start: b.selectionStart, end: b.selectionEnd });
    const recents = await query("");
    check("empty remote-capable scope displays newest searches first", JSON.stringify(recents.map(r => r.title)) === JSON.stringify(["lattice compiler", "lattice models"]), recents);
    const noHistory = await query("unseen fixture phrase");
    check("unseen scoped query keeps only the literal", noHistory.length === 1 && noHistory[0].title === "unseen fixture phrase" && noHistory[0].provider === p.name, noHistory);
    await P.history.remove(url("lattice compiler"));
    const afterDelete = await query("lattice");
    check("deleted scoped history disappears immediately", !afterDelete.some(r => r.title === "lattice compiler") && afterDelete.some(r => r.title === "lattice models"), afterDelete);
    b.view.close(); b.searchMode = null;
    done({ pass: true, engine: remote.name, checks, typed, recents, noHistory, afterDelete });
  } finally {
    for (const o of old) o.user ? Services.prefs.setBoolPref(o.key, o.value) : Services.prefs.clearUserPref(o.key);
  }
})().catch(e => done({ pass: false, error: String(e), stack: e.stack }));
