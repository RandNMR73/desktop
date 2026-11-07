const done = arguments[arguments.length - 1];
(async () => {
  if (!Services.dirsvc.get('ProfD', Ci.nsIFile).path.includes('zen-search-typed-')) {
    throw Error('Disposable profile required');
  }
  const { PlacesUtils: P } = ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
  const { SearchService: S } = ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs');
  const { typedSiteSearches } = ChromeUtils.importESModule('resource:///modules/zen/urlbar/ZenSiteSearchHistory.sys.mjs');
  const { ZenUrlbarProviderSiteSearchHistory: Provider } = ChromeUtils.importESModule('resource:///modules/ZenUBSiteSearchHistoryProvider.sys.mjs');
  await S.init();
  const engine = S.getEngineByName('YouTube');
  const now = Date.now(), day = 86400000, checks = [];
  const check = (name, pass, detail) => {
    checks.push({ name, pass: !!pass });
    if (!pass) throw Error(name + ': ' + JSON.stringify(detail));
  };
  await P.history.clear();
  // Fifteen newer single-visit terms precede a twice-visited older term.
  // The latter would otherwise win aggressive relevance, so output proves
  // that candidate selection happens before scoring, not after display.
  for (let i = 0; i < 16; i++) {
    const query = `provider budget ${i}`;
    const visits = [{ date: new Date(now - (i + 1) * 60000), transition: P.history.TRANSITIONS.LINK }];
    if (i === 15) visits.unshift({ date: new Date(now - day), transition: P.history.TRANSITIONS.LINK });
    await P.history.insert({ url: engine.getSubmission(query, null, 'searchbar').uri.spec, title: query, visits });
  }
  const db = await P.promiseDBConnection();
  const uncapped = await typedSiteSearches(db, engine, u => S.parseSubmissionURL(u), 'provider', { now, limit: 50 });
  check('fixture exposes the excluded high-relevance term', uncapped[0].query === 'provider budget 15', uncapped);
  const w = Services.wm.getMostRecentWindow('navigator:browser'), bar = w.gURLBar;
  bar.searchMode = { engineName: engine.name, entry: 'shortcut', isPreview: false };
  const read = async (searchString, maxResults) => {
    const provider = new Provider(), rows = [];
    await provider.startQuery({ searchString, maxResults, isPrivate: false,
      searchMode: bar.searchMode, allowAutofill: true },
      (_, row) => rows.push(row.payload.suggestion), { browserWindow: w });
    return rows;
  };
  const rows = await read('provider', 10);
  check('three local suggestions plus the literal', rows.length === 4 && rows.includes('provider'), rows);
  check('only fifteen recent candidates are scored', !rows.includes('provider budget 15'), rows);
  check('popup limit does not expand the provider budget', JSON.stringify(await read('provider', 20)) === JSON.stringify(rows));
  const recents = await read('', 10);
  check('empty-scope recent history keeps its separate limit', recents.length === 10, recents);
  done({ pass: true, checks, rows, recentCount: recents.length });
})().catch(e => done({ pass: false, error: String(e), stack: e.stack }));
