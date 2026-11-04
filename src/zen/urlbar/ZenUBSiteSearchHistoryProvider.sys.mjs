/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { UrlbarProvider } from "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs";
import { UrlbarShared } from "chrome://browser/content/urlbar/UrlbarShared.mjs";
import { recentSiteSearches, typedSiteSearches, siteSearchNavigationHistory } from "resource:///modules/zen/urlbar/ZenSiteSearchHistory.sys.mjs";
import { commandMatchingAvailable, commandQueryRules, matchCommandCandidateSignals } from "resource:///modules/zen/urlbar/ZenCommandMatching.sys.mjs";
import { siteSearchCandidates, rankSiteSearchCandidates, SITE_SEARCH_HISTORY_CANDIDATES } from "resource:///modules/zen/urlbar/ZenSiteSearchRanking.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
  SearchService: "moz-src:///toolkit/components/search/SearchService.sys.mjs",
  UrlbarPrefs: "moz-src:///browser/components/urlbar/UrlbarPrefs.sys.mjs",
  UrlbarResult: "chrome://browser/content/urlbar/UrlbarResult.mjs",
});

export class ZenUrlbarProviderSiteSearchHistory extends UrlbarProvider {
  get name() { return "ZenUrlbarProviderSiteSearchHistory"; }
  get type() { return UrlbarShared.PROVIDER_TYPE.PROFILE; }
  getPriority() { return 3; }

  async isActive(context) {
    if (context.isPrivate || !context.searchMode?.engineName ||
        context.searchMode.isPreview || !lazy.UrlbarPrefs.get("suggest.history")) return false;
    if (!context.searchString.trim()) return true;
    if (!Services.prefs.getBoolPref("zen.urlbar.site-search.typed-history", true) ||
        !commandMatchingAvailable()) return false;
    await lazy.SearchService.init();
    const engine = lazy.SearchService.getEngineByName(context.searchMode.engineName);
    // Preserve the built-in provider's live suggestions. This adapter owns
    // local-only scopes until remote results can join the same ranking batch.
    return !!engine && !(engine.supportsResponseType("application/x-suggestions+json") &&
      Services.prefs.getBoolPref("browser.search.suggest.enabled", true) &&
      lazy.UrlbarPrefs.get("suggest.searches"));
  }

  async startQuery(context, addCallback, controller) {
    const instance = this.queryInstance;
    const bar = controller.browserWindow?.gURLBar;
    const current = () => this.queryInstance === instance &&
      bar?.searchMode?.engineName === context.searchMode.engineName;
    await lazy.SearchService.init();
    const engine = lazy.SearchService.getEngineByName(context.searchMode.engineName);
    if (!engine || !current()) return;
    const db = await lazy.PlacesUtils.promiseDBConnection();
    if (context.searchString.trim()) {
      await this.#startTypedQuery(context, addCallback, engine, db, current);
      return;
    }
    const rows = await recentSiteSearches(db, engine,
      url => lazy.SearchService.parseSubmissionURL(url),
      { limit: context.maxResults, current });
    if (!current()) return;
    for (const [index, row] of rows.entries()) {
      addCallback(this, new lazy.UrlbarResult({
        type: UrlbarShared.RESULT_TYPE.SEARCH,
        source: UrlbarShared.RESULT_SOURCE.SEARCH,
        suggestedIndex: index,
        payload: { engine: engine.name, suggestion: row.query, title: row.query,
          query: "", icon: UrlbarShared.ICON.SEARCH_GLASS },
      }));
    }
  }

  async #startTypedQuery(context, addCallback, engine, db, current) {
    const query = context.searchString;
    const locale = Services.locale.appLocaleAsBCP47;
    const rules = commandQueryRules(query);
    // Deleting the completion dismisses the history choices, leaving the
    // literal query. Typing again starts a fresh history query.
    const rows = context.zenSiteSearchInputType?.startsWith("delete") ? [] : await typedSiteSearches(db, engine,
      url => lazy.SearchService.parseSubmissionURL(url), query,
      { limit: SITE_SEARCH_HISTORY_CANDIDATES, locale, current,
        preventInline: !context.allowAutofill,
        inputIsURL: rules?.urlInterpretation === "url" });
    if (!current()) return;
    const submissionURL = terms => engine.getSubmission(terms, null, "searchbar").uri.spec;
    let entries = [];
    try { entries = JSON.parse(Services.prefs.getStringPref("zen.urlbar.site-search.menu", "[]")); }
    catch { /* Unimported engines use their own alias or submission host. */ }
    const entry = Array.isArray(entries) && entries.find(item => item?.key === engine.name ||
      engine.aliases?.includes(item?.key));
    const keyword = entry?.key || engine.aliases?.find(alias => alias.includes(".")) ||
      new URL(submissionURL("scope")).hostname.replace(/^www\./, "");
    const defaultEngine = await lazy.SearchService.getDefault();
    const parse = url => lazy.SearchService.parseSubmissionURL(url);
    const navigation = rows.length ? await siteSearchNavigationHistory(db, keyword, query, {
      locale, current,
      exclude: url => parse(url)?.engine?.id === defaultEngine?.id,
      displayHost: host => Services.io.newURI(`https://${host}`).displayHost,
    }) : [];
    if (!current()) return;
    const candidates = siteSearchCandidates(query, rows, { locale, limit: context.maxResults,
      submissionURL, navigation, navigationKey: url => {
        const parsed = parse(url);
        if (parsed?.engine?.id === engine.id && parsed.terms) return submissionURL(parsed.terms);
        // Chromium removes scheme/www/fragment differences before URL dedup.
        const uri = new URL(url);
        uri.protocol = "http:";
        uri.hostname = uri.hostname.replace(/^www\./, "");
        uri.hash = "";
        return uri.href;
      } });
    const ranked = rankSiteSearchCandidates(candidates,
      matchCommandCandidateSignals(query, candidates), rules);
    for (const [index, { row }] of ranked.entries()) {
      const complete = index === 0 && !row.literal && context.allowAutofill &&
        row.query.length > query.length && row.query.startsWith(query.toLowerCase());
      const result = new lazy.UrlbarResult({
        type: UrlbarShared.RESULT_TYPE.SEARCH,
        source: UrlbarShared.RESULT_SOURCE.SEARCH,
        heuristic: index === 0,
        suggestedIndex: index,
        autofill: complete ? { value: query + row.query.slice(query.length),
          selectionStart: query.length, selectionEnd: row.query.length } : undefined,
        payload: { engine: engine.name, suggestion: row.query, title: row.query,
          query, icon: UrlbarShared.ICON.SEARCH_GLASS },
      });
      addCallback(this, result);
    }
  }
}
