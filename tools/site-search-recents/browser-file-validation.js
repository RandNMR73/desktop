/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
const done = arguments[arguments.length - 1];
const engineName = typeof arguments[0] === 'string' ? arguments[0] : 'YouTube';
(async () => {
  const profile = Services.dirsvc.get('ProfD', Ci.nsIFile).path;
  if (!profile.includes('zen-search-recents-')) throw new Error('Disposable recent-search profile required');
  const { PlacesUtils: P } = ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
  const { SearchService: S } = ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs');
  const { UrlbarShared: U } = ChromeUtils.importESModule('chrome://browser/content/urlbar/UrlbarShared.mjs');
  const { UrlbarResult: R } = ChromeUtils.importESModule('chrome://browser/content/urlbar/UrlbarResult.mjs');
  const { siteSearchHistoryPrefix } = ChromeUtils.importESModule('resource:///modules/zen/urlbar/ZenSiteSearchHistory.sys.mjs');
  await S.init();
  const engine = S.getEngineByName(engineName), checks = [];
  const check = (name, actual, expected) => {
    const passed = JSON.stringify(actual) === JSON.stringify(expected);
    checks.push({ name, passed, ...(!passed && { actual, expected }) });
    if (!passed) throw new Error(name + ': ' + JSON.stringify({ actual, expected }));
  };
  const path = PathUtils.join(profile, 'Recent search ' + encodeURIComponent(engineName) + ' café.html');
  const title = siteSearchHistoryPrefix(engine) + ' Saved local page';
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  await IOUtils.writeUTF8(path, '<!doctype html><meta charset="utf-8"><title>' + escape(title) + '</title><h1>Saved local result</h1>');
  const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile); file.initWithPath(path);
  const url = Services.io.newFileURI(file).spec + '#saved-section';
  await P.history.clear();
  await P.history.insert({ url, title, visits: [{ date: new Date(Date.now() - 60000), transition: P.history.TRANSITIONS.LINK }] });
  const w = Services.wm.getMostRecentWindow('navigator:browser'), bar = w.gURLBar;
  bar.focus(); bar.searchMode = { engineName, entry: 'keywordoffer', isPreview: false }; bar.setValue('');
  await new Promise((resolve, reject) => {
    const timer = w.setTimeout(() => { bar.controller.removeListener(listener); reject(new Error('Query timed out')); }, 5000);
    const listener = { onQueryFinished(context) {
      if (context.searchString || context.searchMode?.engineName !== engineName) return;
      w.clearTimeout(timer); bar.controller.removeListener(listener); resolve();
    } };
    bar.controller.addListener(listener); bar.startQuery({ searchString: '', allowAutofill: false });
  });
  const results = bar.view.visibleResults, result = results[0];
  check('matching local-file title appears as a scoped recent', results.map(r => r.payload.title), [title]);
  check('file URL retains encoded spaces, Unicode and its fragment', result.payload.url, url);
  const expected = { urlLoad: { url, postData: null } };
  check('recent activation requests the local file instead of an engine search', U.getLoadRequestFromResult(result), expected);
  check('file destination survives serialization', U.getLoadRequestFromResult(R.fromWire(result.toWire())), expected);
  check('edited suggestion remains a fresh search', U.getLoadRequestFromResult(result, { element: { dataset: { query: 'edited query' } } }), { engineSearch: { query: 'edited query', engineName } });
  const plain = { type: U.RESULT_TYPE.SEARCH, providerName: result.providerName, payload: result.payload };
  check('other providers retain ordinary search activation', U.getLoadRequestFromResult({ ...plain, providerName: 'OtherProvider' }), { engineSearch: { query: title, engineName } });
  for (const blocked of ['javascript:alert(1)', 'data:text/html,example'])
    check('non-history scheme is not promoted to direct navigation: ' + blocked.split(':')[0],
      U.getLoadRequestFromResult({ ...plain, payload: { ...result.payload, url: blocked } }), { engineSearch: { query: title, engineName } });
  bar.pickResult({ result, event: new w.KeyboardEvent('keydown', { key: 'Enter' }) });
  for (let i = 0; i < 100 && (bar.searchMode || w.gBrowser.selectedBrowser.currentURI.spec !== url || w.gBrowser.selectedBrowser.contentTitle !== title); i++)
    await new Promise(resolve => w.setTimeout(resolve, 50));
  check('real activation opens the original file URL', w.gBrowser.selectedBrowser.currentURI.spec, url);
  check('the saved file loads successfully', w.gBrowser.selectedBrowser.contentTitle, title);
  check('activation closes the explicit engine scope', bar.searchMode, null);
  await P.history.clear();
  done({ passed: true, engine: engineName, checks });
})().catch(error => done({ passed: false, engine: engineName, error: String(error), stack: error.stack }));
