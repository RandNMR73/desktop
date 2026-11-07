/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
const done = arguments[arguments.length - 1];
const engineName = typeof arguments[0] === 'string' ? arguments[0] : 'YouTube';
(async () => {
  if (!Services.dirsvc.get('ProfD', Ci.nsIFile).path.includes('zen-search-recents-'))
    throw new Error('Requires the disposable recent-search profile');
  const { PlacesUtils: P } = ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
  const { SearchService: S } = ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs');
  const { recentSiteSearches, siteSearchHistoryPrefix } = ChromeUtils.importESModule('resource:///modules/zen/urlbar/ZenSiteSearchHistory.sys.mjs');
  const { UrlbarShared } = ChromeUtils.importESModule('chrome://browser/content/urlbar/UrlbarShared.mjs');
  await S.init();
  const engine = S.getEngineByName(engineName), db = await P.promiseDBConnection(), now = Date.now(), checks = [];
  const check = (name, actual, expected) => {
    const passed = JSON.stringify(actual) === JSON.stringify(expected);
    checks.push({ name, passed, ...(!passed && { actual, expected }) });
    if (!passed) throw new Error(name + ': ' + JSON.stringify({ actual, expected }));
  };
  const url = terms => engine.getSubmission(terms, null, 'searchbar').uri.spec;
  const titleMatch = siteSearchHistoryPrefix(engine) + ' Saved page';
  const entries = [
    { url: 'https://scope-admission.invalid/newest#kept', title: titleMatch },
    { url: 'https://scope-admission.invalid/older', title: titleMatch.toUpperCase() },
    { url: url('same query') + '&filter=one', title: 'First filtered result' },
    { url: url('same query') + '&filter=two', title: 'Second filtered result' },
    { url: url(''), title: 'Search home' },
    { url: url('older query'), title: 'Outside candidate budget' },
  ];
  await P.history.clear();
  for (const [i, entry] of entries.entries()) await P.history.insert({ ...entry,
    visits: [{ date: new Date(now - (i + 1) * 60000), transition: P.history.TRANSITIONS.LINK }] });
  const recent = options => recentSiteSearches(db, engine, { now, ...options });
  const expected = [entries[0], entries[2], entries[3], entries[4]];
  check('fixture is not recognized as an engine submission', !!S.parseSubmissionURL(entries[0].url)?.engine, false);
  check('title-only matches appear and duplicate labels collapse', (await recent()).map(r => r.title), expected.map(r => r.title));
  check('equal query terms with different labels keep separate destinations', (await recent()).map(r => r.url), expected.map(r => r.url));
  check('display limit applies after label deduplication', (await recent({ limit: 2 })).map(r => r.title), expected.slice(0, 2).map(r => r.title));
  check('cancelled reads publish no rows', await recent({ current: () => false }), []);
  const win = Services.wm.getMostRecentWindow('navigator:browser'), bar = win.gURLBar;
  bar.focus(); bar.searchMode = { engineName, entry: 'keywordoffer', isPreview: false }; bar.setValue('');
  await new Promise((resolve, reject) => {
    const timer = win.setTimeout(() => { bar.controller.removeListener(listener); reject(new Error('Query timed out')); }, 5000);
    const listener = { onQueryFinished(context) {
      if (context.searchString || context.searchMode?.engineName !== engineName) return;
      win.clearTimeout(timer); bar.controller.removeListener(listener); resolve();
    } };
    bar.controller.addListener(listener); bar.startQuery({ searchString: '', allowAutofill: false });
  });
  const results = bar.view.visibleResults;
  check('real command bar shows the matched titles in recent order', results.map(r => r.payload.suggestion), expected.map(r => r.title));
  check('provider retains each original URL', results.map(r => r.payload.url), expected.map(r => r.url));
  check('title-only result navigates to its saved page', UrlbarShared.getLoadRequestFromResult(results[0]), { urlLoad: { url: entries[0].url, postData: null } });
  check('all rows retain the active scope and search icon', results.every(r => r.payload.engine === engineName && r.payload.icon?.includes('search')), true);
  bar.pickResult({ result: results[0], event: new win.KeyboardEvent('keydown', { key: 'Enter' }) });
  for (let i = 0; i < 100 && (bar.searchMode || win.gBrowser.selectedBrowser.currentURI.spec !== entries[0].url); i++)
    await new Promise(resolve => win.setTimeout(resolve, 50));
  check('activation opens the title-only match instead of submitting its label', win.gBrowser.selectedBrowser.currentURI.spec, entries[0].url);
  check('activation exits the explicit engine scope', bar.searchMode, null);
  await P.history.remove(entries[0].url);
  check('deleting the newest duplicate reveals the older visit', (await recent()).map(r => r.url), entries.slice(1).map(r => r.url));
  await P.history.clear(); check('clearing history removes recents', await recent(), []);
  bar.view.close(); bar.searchMode = null;
  done({ passed: true, engine: engineName, checks });
})().catch(error => done({ passed: false, error: String(error), stack: error.stack }));
