/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { UrlbarProvider } from "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs";
import { UrlbarShared } from "chrome://browser/content/urlbar/UrlbarShared.mjs";
import { recentSiteSearches, typedSiteSearches } from "resource:///modules/zen/urlbar/ZenSiteSearchHistory.sys.mjs";
import { siteSearchTermKey } from "resource:///modules/zen/urlbar/ZenSiteSearchTerms.sys.mjs";

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
    // Typed integration remains opt-in while Arc's final re-ranking is checked.
    // The empty-scope recent list and its native flash remain enabled normally.
    const typed = context.searchString.trim();
    return !context.isPrivate && (!typed ||
      Services.prefs.getBoolPref("zen.urlbar.site-search.typed-history", false)) &&
      !!context.searchMode?.engineName && !context.searchMode.isPreview &&
      lazy.UrlbarPrefs.get("suggest.history");
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
    const rows = await typedSiteSearches(db, engine,
      url => lazy.SearchService.parseSubmissionURL(url), query,
      { limit: context.maxResults * 5, locale, current,
        preventInline: !context.allowAutofill });
    if (!current()) return;
    const key = siteSearchTermKey(query, locale);
    // This order is Chromium's input to Arc's re-ranker, not the final Arc
    // ordering. Keep it behind the typed integration preference until that
    // second stage is connected and compared against the reference UI.
    const candidates = rows.filter(row => row.relevance > 0);
    if (!candidates.some(row => row.key === key)) {
      candidates.push({ query, relevance: 1500, literal: true });
    }
    candidates.sort((a, b) => b.relevance - a.relevance);
    for (const [index, row] of candidates.slice(0, context.maxResults).entries()) {
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
