const done = arguments[arguments.length - 1];
(async () => {
  if (!Services.dirsvc.get("ProfD", Ci.nsIFile).path.includes("zen-search-typed-"))
    throw Error("Disposable profile required");
  const { PlacesUtils: P } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const { SearchService: S } = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs");
  const { siteSearchNavigationHistory: read } = ChromeUtils.importESModule("resource:///modules/zen/urlbar/ZenSiteSearchHistory.sys.mjs");
  await S.init();
  const engine = S.getEngineByName("YouTube"), db = await P.promiseDBConnection();
  const now = Date.now(), day = 86400000, checks = [];
  const check = (name, pass, detail) => {
    checks.push({ name, pass: !!pass, ...(pass ? {} : { detail }) });
    if (!pass) throw Error(name + ": " + JSON.stringify(detail));
  };
  const search = q => engine.getSubmission(q, null, "searchbar").uri.spec;
  const visit = (url, title, ages) => P.history.insert({ url, title,
    visits: ages.map(age => ({ date: new Date(now - age * day), transition: P.history.TRANSITIONS.LINK })) });
  await P.history.clear();
  await visit(search("lattice model"), "lattice model", [0.1, 0.2]);
  await visit(search("lattice graph"), "lattice graph", [10, 11]);
  await visit(search("lattice tools"), "lattice tools", [14, 15]);
  const pages = Array.from({ length: 6 }, (_, i) => `https://www.youtube.com/fixture/page/${i}`);
  for (const url of pages) await visit(url, "lattice", [.3, .4, .5, .6, .7]);
  const nav = await read(db, "youtube.com", "lattice", { now, locale: "en-US" });
  check("keyword navigation provider has seven slots", nav.length === 7, nav.length);
  check("all six matching pages compete with searches", pages.every(url => nav.some(r => r.url === url)), nav);
  check("navigation scores strictly descend", nav.every((r, i) => !i || nav[i - 1].relevance > r.relevance));
  const w = Services.wm.getMostRecentWindow("navigator:browser"), bar = w.gURLBar;
  const query = async () => {
    bar.focus();
    bar.searchMode = { engineName: engine.name, entry: "shortcut", isPreview: false };
    bar.setValue("lattice");
    await new Promise((resolve, reject) => {
      const timer = w.setTimeout(() => { bar.controller.removeListener(listener); reject(Error("query timeout")); }, 5000);
      const listener = { onQueryFinished(context) {
        if (context.searchString !== "lattice" || context.searchMode?.engineName !== engine.name) return;
        w.clearTimeout(timer); bar.controller.removeListener(listener); resolve();
      } };
      bar.controller.addListener(listener);
      bar.startQuery({ searchString: "lattice", allowAutofill: true });
    });
    return bar.view.visibleResults.map(r => ({ title: r.payload.suggestion, provider: r.providerName }));
  };
  const crowded = await query();
  check("combined navigation limit leaves only one recent search plus literal",
    crowded.length === 2 && crowded.some(r => r.title === "lattice model") && crowded.some(r => r.title === "lattice"), crowded);
  check("navigation rows never leak into the scoped search list",
    crowded.every(r => r.provider === "ZenUrlbarProviderSiteSearchHistory"), crowded);
  await P.history.remove(pages);
  const restored = await query();
  check("removing competing pages restores search candidates immediately", restored.length === 4, restored);
  await P.history.remove(search("lattice graph"));
  check("removing a search removes its completion immediately", !(await query()).some(r => r.title === "lattice graph"));
  check("cancelled navigation lookup is empty", !(await read(db, "youtube.com", "lattice", { current: () => false })).length);
  check("default-engine search URLs can be excluded", !(await read(db, "youtube.com", "lattice", {
    exclude: url => S.parseSubmissionURL(url)?.engine?.id === engine.id,
  })).length);
  const costs = [];
  for (let i = 0; i < 20; ++i) {
    const start = performance.now();
    await read(db, "youtube.com", "lattice", { now, locale: "en-US" });
    costs.push(performance.now() - start);
  }
  costs.sort((a, b) => a - b);
  done({ pass: true, checks, crowded, restored,
    cost: { rows: 2, queries: costs.length, medianMs: costs[10], p95Ms: costs[18] } });
})().catch(error => done({ pass: false, error: String(error), stack: error.stack }));
