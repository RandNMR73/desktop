const done = arguments[arguments.length - 1];
(async () => {
  if (!Services.dirsvc.get("ProfD", Ci.nsIFile).path.includes("zen-search-typed-"))
    throw Error("Disposable profile required");
  const { PlacesUtils: P } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const { SearchService: S } = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs");
  const { siteSearchCandidates } = ChromeUtils.importESModule("resource:///modules/zen/urlbar/ZenSiteSearchRanking.sys.mjs");
  await S.init();
  const engine = S.getEngineByName("YouTube"), checks = [];
  const check = (name, pass, detail) => {
    checks.push({ name, pass: !!pass, ...(pass ? {} : { detail }) });
    if (!pass) throw Error(name + ": " + JSON.stringify(detail));
  };
  const options = { locale: "en-US", submissionURL: q => engine.getSubmission(q, null, "searchbar").uri.spec };
  const exact = siteSearchCandidates("LATTICE", [
    { query: "lattice", relevance: 1599 },
    { query: "lattice models", relevance: 1598 },
  ], options);
  check("exact history is replaced after scope filtering", exact.length === 2 &&
    exact[0].title === "lattice models" && exact[1].title === "LATTICE", exact);
  check("remaining history ranks start at one", exact[0].features.chromiumRank === 1);
  check("fallback has no inherited Chromium signals", Object.keys(exact[1].features).length === 0);
  const crowded = siteSearchCandidates("LATTICE", [], { ...options,
    navigation: Array.from({ length: 8 }, (_, i) => ({ url: `https://fixture.test/${i}`, relevance: 1600 + i })) });
  check("shared budget cannot remove the typed search", crowded.length === 1 &&
    crowded[0].title === "LATTICE" && Object.keys(crowded[0].features).length === 0, crowded);
  await P.history.clear();
  const now = Date.now();
  for (const [i, query] of ["lattice", "lattice models", "lattice graphs"].entries()) {
    await P.history.insert({ url: options.submissionURL(query), title: query,
      visits: [1, 2].map(minutes => ({ date: new Date(now - (minutes + i) * 60000), transition: P.history.TRANSITIONS.LINK })) });
  }
  const w = Services.wm.getMostRecentWindow("navigator:browser"), bar = w.gURLBar;
  const query = async () => {
    bar.focus();
    bar.searchMode = { engineName: engine.name, entry: "shortcut", isPreview: false };
    bar.setValue("LATTICE");
    await new Promise((resolve, reject) => {
      const timer = w.setTimeout(() => { bar.controller.removeListener(listener); reject(Error("query timeout")); }, 5000);
      const listener = { onQueryFinished(context) {
        if (context.searchString !== "LATTICE" || context.searchMode?.engineName !== engine.name) return;
        w.clearTimeout(timer); bar.controller.removeListener(listener); resolve();
      } };
      bar.controller.addListener(listener);
      bar.startQuery({ searchString: "LATTICE", allowAutofill: true });
    });
    return bar.view.visibleResults.map(r => ({ title: r.payload.suggestion, provider: r.providerName }));
  };
  const results = await query();
  check("real command bar keeps two completions and the typed spelling", results.length === 3 &&
    ["lattice models", "lattice graphs", "LATTICE"].every(q => results.some(r => r.title === q)), results);
  check("all results use the scoped provider", results.every(r => r.provider === "ZenUrlbarProviderSiteSearchHistory"));
  await P.history.clear();
  const empty = await query();
  check("deleting history leaves only the literal search", empty.length === 1 && empty[0].title === "LATTICE", empty);
  bar.view.close(); bar.searchMode = null;
  done({ pass: true, checks, results, empty });
})().catch(error => done({ pass: false, error: String(error), stack: error.stack }));
