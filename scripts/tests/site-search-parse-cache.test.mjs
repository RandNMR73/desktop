import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SiteSearchParseCache } from "../../src/zen/urlbar/ZenSiteSearchParseCache.sys.mjs";
import { typedSiteSearches } from "../../src/zen/urlbar/ZenSiteSearchHistory.sys.mjs";
import { SITE_SEARCH_HISTORY_CANDIDATES } from "../../src/zen/urlbar/ZenSiteSearchRanking.sys.mjs";
import { CommandPrefixSessions } from "../../src/zen/urlbar/ZenCommandPrefixSessions.sys.mjs";
import { CommandSelectionCapture, commandSelectionContext } from "../../src/zen/urlbar/ZenCommandSelectionCapture.sys.mjs";

const owner = () => ({ closed: false });
const engine = () => ({ id: "fixture", name: "Fixture", queryCharset: "UTF-8",
  aliases: ["example.test"], getSubmission: terms => ({ uri: {
    spec: "https://example.test/search?q=" + encodeURIComponent(terms),
  } }) });
const positive = (selected, terms = "Raw Terms", termsParameterName = "q") =>
  ({ engine: selected, terms, termsParameterName });
const begin = (cache, window, options = {}) =>
  cache.begin(window, { scope: "Fixture", container: 7, ...options });

test("only exact raw URLs reuse immutable successful selected-engine parses", () => {
  const cache = new SiteSearchParseCache(), window = owner(), selected = engine();
  let calls = 0, first;
  const parse = url => { calls++; return first = positive(selected, " Cafe\u0301 + " + url); };
  const reader = begin(cache, window).parser(selected, parse, () => true);
  const url = "https://example.test/search?q=a%2fb";
  assert.strictEqual(reader(url), first);
  const expected = { ...first };
  first.terms = "mutated caller result";
  const hit = begin(cache, window).parser(selected, parse, () => true)(url);
  assert.deepEqual(hit, expected);
  assert.ok(Object.isFrozen(hit));
  assert.equal(calls, 1);
  for (const different of [url.replace("%2f", "%2F"), url + "#fragment", url.replace("https:", "http:")])
    reader(different);
  assert.equal(calls, 4, "no case, escape, scheme or fragment normalization");
});

test("negative, whitespace, malformed, other-object and throwing parses stay uncached", () => {
  const cache = new SiteSearchParseCache(), window = owner(), selected = engine();
  const other = { ...selected };
  const results = [null, positive(null), positive(other), positive(selected, " \t"),
    positive(selected, 9), positive(selected, "ok", null)];
  let calls = 0;
  for (const result of results) {
    const reader = begin(cache, window).parser(selected, () => { calls++; return result; }, () => true);
    assert.strictEqual(reader("same"), result);
    assert.strictEqual(reader("same"), result);
  }
  assert.equal(calls, results.length * 2);
  const failure = Error("decode failure");
  const reader = begin(cache, window).parser(selected, () => { calls++; throw failure; }, () => true);
  assert.throws(() => reader("same"), error => error === failure);
  assert.throws(() => reader("same"), error => error === failure);
  assert.equal(cache.retained.entries, 0);
});

test("engine replacement and silent charset change cannot reuse the preceding parse", () => {
  const cache = new SiteSearchParseCache(), window = owner(), selected = engine();
  let calls = 0;
  const parse = () => { calls++; return positive(selected, selected.queryCharset); };
  const old = begin(cache, window).parser(selected, parse, () => true);
  old("url"); old("url"); assert.equal(calls, 1);
  selected.queryCharset = "windows-1252";
  assert.equal(old("url").terms, "windows-1252");
  assert.equal(calls, 2);
  const current = begin(cache, window).parser(selected, parse, () => true);
  current("url"); current("url"); assert.equal(calls, 3);
  old("url"); assert.equal(calls, 4, "old version cannot use newly bound entries");
  const replacement = { ...selected };
  const replaced = begin(cache, window).parser(replacement,
    () => { calls++; return positive(replacement, "replacement"); }, () => true);
  assert.equal(replaced("url").terms, "replacement");
  assert.equal(calls, 5, "same engine id is not object identity");
});

test("window, scope and container boundaries clear payload and keep stale readers out", () => {
  for (const changed of ["window", "scope", "container"]) {
    const cache = new SiteSearchParseCache(), window = owner(), selected = engine();
    let calls = 0;
    const parse = () => { calls++; return positive(selected); };
    const old = begin(cache, window).parser(selected, parse, () => true);
    old("a");
    const next = begin(cache, changed === "window" ? owner() : window,
      changed === "scope" ? { scope: "Other" } : changed === "container" ? { container: 8 } : {});
    assert.equal(cache.retained.entries, 0, changed);
    next.parser(selected, parse, () => true)("b");
    old("a"); old("c");
    assert.equal(cache.retained.entries, 1, "stale closure cannot refill another owner");
    assert.equal(calls, 4);
  }
});

test("reset affects only its owner and clearing invalidates retained tickets", () => {
  const cache = new SiteSearchParseCache(), window = owner(), selected = engine();
  let calls = 0;
  const parse = () => { calls++; return positive(selected); };
  const ticket = begin(cache, window), reader = ticket.parser(selected, parse, () => true);
  reader("url"); cache.reset(owner()); reader("url"); assert.equal(calls, 1);
  cache.reset(window);
  assert.deepEqual(cache.retained, { entries: 0, codeUnits: 0 });
  assert.strictEqual(ticket.parser(selected, parse, () => true), parse);
  reader("url"); reader("url");
  assert.equal(calls, 3);
  assert.deepEqual(cache.retained, { entries: 0, codeUnits: 0 });
});

test("disabled, unresolved or closed owners clear state instead of defaulting profiles", () => {
  for (const options of [{ enabled: false }, { scope: undefined }, { scope: "" },
    { container: undefined }, { container: -1 }, { container: 0.5 }]) {
    const cache = new SiteSearchParseCache(), window = owner(), selected = engine();
    begin(cache, window).parser(selected, () => positive(selected), () => true)("url");
    assert.equal(begin(cache, window, options), null);
    assert.deepEqual(cache.retained, { entries: 0, codeUnits: 0 });
  }
  const cache = new SiteSearchParseCache(), window = owner(), selected = engine();
  let calls = 0;
  const parse = () => { calls++; return positive(selected); };
  const reader = begin(cache, window).parser(selected, parse, () => true);
  reader("url"); window.closed = true; reader("url");
  assert.equal(calls, 2);
  assert.equal(cache.retained.entries, 0);
  assert.equal(begin(cache, window), null);
});

test("current and live owner checks prevent hits and admission after asynchronous changes", () => {
  const cache = new SiteSearchParseCache(), window = owner(), selected = engine();
  let current = true, ownerCurrent = true, calls = 0;
  const parse = () => { calls++; return positive(selected); };
  const ticket = begin(cache, window, { ownerCurrent: () => ownerCurrent });
  const reader = ticket.parser(selected, parse, () => current);
  reader("old"); current = false; reader("old"); reader("new");
  assert.equal(calls, 3);
  assert.equal(cache.retained.entries, 1, "cancelled query cannot add entries");
  current = true; ownerCurrent = false;
  assert.strictEqual(ticket.parser(selected, parse, () => current), parse);
  reader("old");
  assert.equal(calls, 4);
  assert.deepEqual(cache.retained, { entries: 0, codeUnits: 0 });
});

test("synchronous invalidation inside the real parser cannot refill or clear a newer owner", () => {
  const cache = new SiteSearchParseCache(), a = owner(), b = owner(), selected = engine();
  const first = begin(cache, a).parser(selected, () => {
    cache.clear();
    begin(cache, b).parser(selected, () => positive(selected, "new owner"), () => true)("new");
    return positive(selected, "old owner");
  }, () => true);
  assert.equal(first("old").terms, "old owner");
  assert.equal(cache.retained.entries, 1);
  const newer = begin(cache, b).parser(selected, () => assert.fail("new owner cache was lost"), () => true);
  assert.equal(newer("new").terms, "new owner");
  let valid = true;
  const next = begin(cache, b, { ownerCurrent: () => valid }).parser(selected,
    () => { valid = false; return positive(selected); }, () => true);
  next("not admitted");
  assert.deepEqual(cache.retained, { entries: 0, codeUnits: 0 });
});

test("entry admission stops at the cap without streaming eviction", () => {
  const cache = new SiteSearchParseCache({ maxEntries: 2 }), window = owner(), selected = engine();
  const calls = [];
  const reader = begin(cache, window).parser(selected, url => { calls.push(url); return positive(selected, url); }, () => true);
  reader("first"); reader("second");
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < 100; i++) reader("overflow" + i);
  reader("first"); reader("second");
  assert.equal(calls.length, 202);
  assert.equal(cache.retained.entries, 2);
});

test("UTF-16 budget charges scope, charset, raw URL, terms and parameter name exactly", () => {
  const selected = engine(), window = owner(), scope = "F", url = "u\u{1F680}", terms = "t\u{1F680}", parameter = "qq";
  const budget = scope.length + selected.queryCharset.length + url.length + terms.length + parameter.length;
  const cache = new SiteSearchParseCache({ maxCodeUnits: budget });
  let calls = 0;
  const parse = () => { calls++; return positive(selected, terms, parameter); };
  const reader = begin(cache, window, { scope }).parser(selected, parse, () => true);
  reader(url); reader(url);
  assert.equal(calls, 1);
  assert.deepEqual(cache.retained, { entries: 1, codeUnits: budget });
  reader(url + "x"); reader(url + "x");
  assert.equal(calls, 3);
  assert.deepEqual(cache.retained, { entries: 1, codeUnits: budget });
  cache.clear();
  const next = begin(cache, window, { scope }).parser(selected, parse, () => true);
  next(url + "x"); next(url);
  assert.equal(cache.retained.entries, 1, "oversized entry does not block later admissible entry");
});

test("real typed history keeps fresh SQL, dates, visit counts and deletion with cached parses", async () => {
  const cache = new SiteSearchParseCache(), window = owner(), selected = engine(), now = Date.UTC(2026, 10, 18);
  let rows = [{ url: selected.getSubmission("gpu model").uri.spec, date: now - 86400000, count: 2 },
    { url: selected.getSubmission("gpu guide").uri.spec, date: now - 172800000, count: 1 }];
  let queries = 0, parses = 0;
  const db = { async executeCached(sql, params, callback) {
    queries++; assert.match(sql, /p\.last_visit_date AS date, p\.visit_count AS visitCount/);
    assert.equal(params.revHost, "tset.elpmaxe.");
    for (const row of rows) callback({ getResultByIndex: i => [row.url, row.date * 1000, row.count][i] }, () => assert.fail("unexpected cancellation"));
  } };
  const original = url => positive(selected, new URL(url).searchParams.get("q"));
  const run = async () => {
    const parse = begin(cache, window).parser(selected, url => { parses++; return original(url); }, () => true);
    const cached = await typedSiteSearches(db, selected, parse, "gpu", { now });
    const baseline = await typedSiteSearches(db, selected, original, "gpu", { now });
    assert.deepEqual(cached, baseline);
    return cached;
  };
  await run(); assert.equal(parses, 2);
  rows[0].date = now - 1000; rows[0].count = 90;
  const updated = await run();
  assert.equal(updated.find(row => row.url === rows[0].url).visitCount, 90);
  assert.equal(updated.find(row => row.url === rows[0].url).date, now - 1000);
  assert.equal(parses, 2);
  const removed = rows.shift().url;
  assert.ok((await run()).every(row => row.url !== removed));
  assert.equal(queries, 6, "both versions execute every history query");
  assert.equal(parses, 2, "only parsing was reused");
});

// Evaluate the exact provider source with imported services replaced by explicit
// test bindings. No provider methods or cache decisions are transcribed.
function providerFixture() {
  const selected = engine(), window = owner();
  const spaces = [{ uuid: "one", containerTabId: 7 }, { uuid: "two", containerTabId: 7 }];
  window.gZenWorkspaces = { workspaceEnabled: true, activeWorkspace: "one", getWorkspaces: () => spaces };
  window.gURLBar = { searchMode: { engineName: selected.name } };
  window.gBrowser = { selectedTab: { userContextId: 99 } };
  const observers = new Map(), preferences = new Map(), places = new Map();
  const prefs = { "zen.urlbar.site-search.typed-history": true, "browser.urlbar.suggest.history": true };
  const f = { selected, window, spaces, parses: 0, privateWindow: false, matching: true, nextDB: null, onDB: null,
    typed: async parse => { parse("https://example.test/search?q=value"); return []; } };
  const SearchService = { init: async () => {}, getEngineByName: () => selected,
    getDefault: async () => ({ id: "different" }), parseSubmissionURL: () => { f.parses++; return positive(selected); } };
  const Services = { locale: { appLocaleAsBCP47: "en-US" },
    obs: { addObserver: (callback, topic) => observers.set(topic, callback) },
    prefs: { getBoolPref: (name, fallback) => prefs[name] ?? fallback, getStringPref: () => "[]",
      addObserver: (name, callback) => preferences.set(name, callback) } };
  const bindings = { SiteSearchParseCache, CommandPrefixSessions, CommandSelectionCapture, commandSelectionContext, SITE_SEARCH_HISTORY_CANDIDATES,
    PrivateBrowsingUtils: { isWindowPrivate: () => f.privateWindow },
    PlacesObservers: { addListener: (topics, callback) => topics.forEach(topic => places.set(topic, callback)) },
    Services, ChromeUtils: { defineESModuleGetters: lazy => Object.assign(lazy, { SearchService,
      PlacesUtils: { promiseDBConnection: () => { f.onDB?.(); return f.nextDB ?? Promise.resolve({}); } },
      UrlbarPrefs: { get: () => prefs["browser.urlbar.suggest.history"] } }) },
    UrlbarProvider: class {}, UrlbarShared: { RESULT_TYPE: { SEARCH: 1 }, RESULT_SOURCE: { SEARCH: 1 }, PROVIDER_TYPE: { PROFILE: 1 } },
    ZenCommandSelectionHistory: { selectedResult: async () => null }, commandMatchingAvailable: () => f.matching,
    commandQueryRules: () => ({}), typedSiteSearches: (_db, _engine, parse) => f.typed(parse),
    siteSearchCandidates: () => [], rankSiteSearchCandidates: () => [], matchCommandCandidateSignals: () => [],
    commandPrefixInput: () => ({}), readCommandPrefixHistory: async () => ({ final: [] }),
    CommandResultAccumulator: class { append() { return []; } },
  };
  const source = readFileSync(new URL("../../src/zen/urlbar/ZenUBSiteSearchHistoryProvider.sys.mjs", import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
  const module = new Function(...Object.keys(bindings), source +
    "\nreturn { Provider: ZenUrlbarProviderSiteSearchHistory, clearCommandPrefixSession, retained: () => parseCache.retained };")(...Object.values(bindings));
  f.provider = new module.Provider(); f.retained = module.retained;
  f.reset = module.clearCommandPrefixSession;
  f.closeWindow = window => observers.get("domwindowclosed")(window, "domwindowclosed", null);
  f.notify = (topic, data = "engine-changed") => observers.get(topic)(null, topic, data);
  f.removePage = () => places.get("page-removed")([{ type: "page-removed" }]);
  f.setPref = (name, value) => { prefs[name] = value; preferences.get(name)(null, "nsPref:changed", name); };
  f.context = (overrides = {}) => ({ searchString: "value", isPrivate: false,
    searchMode: { engineName: selected.name }, maxResults: 5, allowAutofill: true, ...overrides });
  f.begin = context => f.provider.beginQuery(context, { browserWindow: window });
  f.run = async (context = f.context()) => {
    f.begin(context); f.provider.queryInstance = {};
    await f.provider.startQuery(context, () => assert.fail("fixture has no candidate rows"), { browserWindow: window });
  };
  return f;
}

test("actual provider clears on service, locale, history and preference events", async () => {
  for (const invalidate of [f => f.notify("browser-search-engine-modified"),
    f => f.notify("browser-search-service", "init-complete"), f => f.notify("browser-search-service", "engines-reloaded"),
    f => f.notify("intl:app-locales-changed"), f => f.notify("profile-before-change"),
    f => f.removePage(), f => f.setPref("browser.urlbar.suggest.history", true),
    f => f.setPref("zen.urlbar.site-search.typed-history", true)]) {
    const f = providerFixture(); await f.run(); await f.run(); assert.equal(f.parses, 1);
    invalidate(f); assert.equal(f.retained().entries, 0);
    await f.run(); assert.equal(f.parses, 2);
  }
});

test("search settings write completion does not discard unchanged parse results", async () => {
  const f = providerFixture(); await f.run();
  f.notify("browser-search-service", "write-settings-to-disk-complete");
  await f.run(); assert.equal(f.parses, 1);
});

test("actual provider preserves ongoing sessions and resets explicit close and completed sessions", async () => {
  const f = providerFixture(); await f.run(); await f.run(); assert.equal(f.parses, 1);
  f.provider.onSearchSessionEnd(f.context(), { browserWindow: f.window }, { isSessionOngoing: true });
  await f.run(); assert.equal(f.parses, 1);
  f.provider.onSearchSessionEnd(f.context(), { browserWindow: f.window }, { isSessionOngoing: false });
  await f.run(); assert.equal(f.parses, 2);
  f.reset(owner()); await f.run(); assert.equal(f.parses, 2);
  f.reset(f.window); await f.run(); assert.equal(f.parses, 3);
});

test("actual window disposal resets only the active cache owner", async () => {
  const f = providerFixture(); await f.run();
  f.closeWindow(owner()); await f.run(); assert.equal(f.parses, 1);
  f.closeWindow(f.window); assert.equal(f.retained().entries, 0);
  await f.run(); assert.equal(f.parses, 2);
});

test("actual provider does not retain a cache through private, preview, disabled or unresolved entry", async () => {
  for (const disable of [f => f.begin(f.context({ isPrivate: true })),
    f => f.begin(f.context({ searchMode: { engineName: f.selected.name, isPreview: true } })),
    f => { f.privateWindow = true; f.begin(f.context()); f.privateWindow = false; },
    f => { f.matching = false; f.begin(f.context()); f.matching = true; },
    f => { f.window.gZenWorkspaces.activeWorkspace = "missing"; f.begin(f.context()); f.window.gZenWorkspaces.activeWorkspace = "one"; }]) {
    const f = providerFixture(); await f.run(); disable(f);
    assert.equal(f.retained().entries, 0);
    await f.run(); assert.equal(f.parses, 2);
  }
});

test("actual provider rechecks Space container after awaiting the Places connection", async () => {
  const f = providerFixture(); await f.run(); assert.equal(f.parses, 1);
  let release;
  const reached = new Promise(resolve => { f.onDB = resolve; });
  f.nextDB = new Promise(resolve => { release = resolve; });
  const original = f.provider.startQuery;
  const pending = f.run();
  await reached;
  f.spaces[0].containerTabId = 0; // Same mutation as contextual-identity-deleted.
  release({}); await pending;
  assert.strictEqual(f.provider.startQuery, original);
  assert.equal(f.parses, 2, "old profile must miss while existing query remains current");
  assert.equal(f.retained().entries, 0, "invalid owner's old and new parses are not retained");
  f.nextDB = null; f.onDB = null; await f.run(); await f.run(); assert.equal(f.parses, 3);
});

test("actual provider checks mid-read ownership without confusing tabs or same-profile Spaces", async () => {
  const f = providerFixture(); await f.run();
  f.window.gZenWorkspaces.activeWorkspace = "two";
  f.window.gBrowser.selectedTab.userContextId = 55;
  await f.run(); assert.equal(f.parses, 1, "same Space profile keeps valid parses");
  f.typed = async parse => {
    parse("https://example.test/search?q=value");
    f.spaces[1].containerTabId = 9;
    parse("https://example.test/search?q=value");
    return [];
  };
  await f.run();
  assert.equal(f.parses, 2, "container changed after parser binding bypasses cached value");
  assert.equal(f.retained().entries, 0);
});
