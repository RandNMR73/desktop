const done = arguments[arguments.length - 1];
(async () => {
  if (!Services.dirsvc.get("ProfD", Ci.nsIFile).path.includes("zen-search-typed-")) {
    throw Error("Disposable search profile required");
  }
  const [operation, engineName = "YouTube", query = "lattice"] = arguments;
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const b = w.gURLBar;
  if (operation === "seed") {
    const { PlacesUtils: P } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
    const { SearchService: S } = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs");
    await S.init();
    await P.history.clear();
    for (const name of ["YouTube", "Amazon", "Google"]) {
      const engine = S.getEngineByName(name);
      if (!engine) throw Error(`Missing engine: ${name}`);
      for (const [index, term] of ["lattice compiler", "lattice models"].entries()) {
        await P.history.insert({
          url: engine.getSubmission(term, null, "searchbar").uri.spec,
          title: term,
          visits: [1, 2].map(age => ({
            date: new Date(Date.now() - (age + index * 7) * 86400000),
            transition: P.history.TRANSITIONS.LINK,
          })),
        });
      }
    }
    w.__siteSearchDeletionInputs = [];
    b.inputField.addEventListener("input", event => {
      w.__siteSearchDeletionInputs.push({type: event.inputType, trusted: event.isTrusted});
    });
  } else if (operation === "query") {
    b.focus();
    b.searchMode = { engineName, entry: "shortcut", isPreview: false };
    b.setValue(query);
    b.setSelectionRange(query.length, query.length);
    b.startQuery({searchString: query, allowAutofill: true});
    await b.lastQueryContextPromise;
  } else if (operation === "select-all") {
    b.focus();
    b.setSelectionRange(0, b.value.length);
  } else if (operation !== "state") {
    throw Error(`Unknown operation: ${operation}`);
  }
  await b.lastQueryContextPromise;
  done({
    value: b.value,
    start: b.selectionStart,
    end: b.selectionEnd,
    query: b.view.queryContext?.searchString,
    inputType: b.view.queryContext?.zenSiteSearchInputType,
    dismissedCompletion: b.view.queryContext?.zenSiteSearchDismissedCompletion,
    results: b.view.visibleResults.map(result => result.payload.suggestion),
    inputs: w.__siteSearchDeletionInputs,
  });
})().catch(error => done({error: String(error), stack: error.stack}));
