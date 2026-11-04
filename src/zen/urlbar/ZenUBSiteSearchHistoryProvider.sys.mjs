/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { UrlbarProvider } from "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs";
import { UrlbarShared } from "chrome://browser/content/urlbar/UrlbarShared.mjs";
import { recentSiteSearches } from "resource:///modules/zen/urlbar/ZenSiteSearchHistory.sys.mjs";

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
    return !context.isPrivate && !context.searchString.trim() &&
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
}
