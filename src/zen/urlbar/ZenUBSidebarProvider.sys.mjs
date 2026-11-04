/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  UrlbarProvider,
  UrlbarUtils,
} from "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs";
import { UrlbarShared } from "chrome://browser/content/urlbar/UrlbarShared.mjs";
import { formatValueSync } from "resource:///modules/ZenUBGlobalActions.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  UrlbarResult: "chrome://browser/content/urlbar/UrlbarResult.mjs",
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  UrlbarPrefs: "moz-src:///browser/components/urlbar/UrlbarPrefs.sys.mjs",
  TopSites: "resource:///modules/topsites/TopSites.sys.mjs",
  ZenSessionStore: "resource:///modules/zen/ZenSessionManager.sys.mjs",
});

const DYNAMIC_TYPE_NAME = "zen-folders";

export class ZenUrlbarProviderSidebar extends UrlbarProvider {
  get name() {
    return "ZenUrlbarProviderSidebar";
  }

  /**
   * @returns {Values<typeof UrlbarShared.PROVIDER_TYPE>}
   */
  get type() {
    return UrlbarShared.PROVIDER_TYPE.PROFILE;
  }

  async isActive(queryContext) {
    return (
      !!queryContext.tokens.length &&
      queryContext.sources.includes(UrlbarShared.RESULT_SOURCE.TABS) &&
      lazy.UrlbarPrefs.get("suggest.openpage")
    );
  }

  async startQuery(queryContext, addCallback, controller) {
    const sidebar = !queryContext.isPrivate && lazy.ZenSessionStore.getSidebarData();
    const tokens = queryContext.tokens.map((t) => t.lowerCaseValue);
    const score = (text) => {
      text = text.toLowerCase();
      if (!tokens.every((token) => text.includes(token))) {
        return 0;
      }
      return tokens.reduce((sum, token) => sum + token.length, 0) / text.length;
    };
    if (sidebar) {
      this.#addFolders(sidebar, score, queryContext, addCallback);
    }
    this.#addTabs(score, queryContext, addCallback, controller?.browserWindow);
  }

  #addTabs(score, queryContext, addCallback, window) {
    if (queryContext.maxResults <= 0) {
      return;
    }
    const scope = ZenUrlbarProviderRecentTabs.typedScope(window, queryContext.isPrivate);
    let resultsAdded = 0;
    for (const { payload, urls } of scope.results) {
      if (payload.url === queryContext.currentPage ||
          !score([payload.title, ...urls].join(" "))) {
        continue;
      }
      addCallback(
        this,
        new lazy.UrlbarResult({
          type: UrlbarShared.RESULT_TYPE.TAB_SWITCH,
          source: UrlbarShared.RESULT_SOURCE.TABS,
          payload,
          highlights: {
            url: UrlbarShared.HIGHLIGHT.TYPED,
            title: UrlbarShared.HIGHLIGHT.TYPED,
          },
        }),
      );
      if (++resultsAdded == queryContext.maxResults) {
        return;
      }
    }
  }

  #addFolders(sidebar, score, queryContext, addCallback) {
    const folders = new Map(
      (sidebar.folders || []).map((folder) => [folder.id, folder]),
    );
    const matched = [...folders.values()]
      .filter((folder) => !folder.splitViewGroup && folder.name)
      .map((folder) => ({ folder, score: score(folder.name) }))
      .filter((match) => match.score)
      .sort((a, b) => b.score - a.score);
    for (const match of matched) {
      const { folder } = match;
      const space = sidebar.spaces?.find((s) => s.uuid == folder.workspaceId);
      const path = [folder.name];
      for (
        let parent = folders.get(folder.parentId);
        parent;
        parent = folders.get(parent.parentId)
      ) {
        path.unshift(parent.name);
      }
      if (space) {
        path.unshift(lazy.BrowserWindowTracker.getTopWindow().gZenWorkspaces
          .getWorkspaceDisplayName(space));
      }
      addCallback(
        this,
        new lazy.UrlbarResult({
          type: UrlbarShared.RESULT_TYPE.DYNAMIC,
          source: UrlbarShared.RESULT_SOURCE.TABS,
          payload: {
            dynamicType: DYNAMIC_TYPE_NAME,
            zenFolderId: folder.id,
            titleL10n: "zen-action-open",
            userIcon: folder.userIcon,
            icon: "chrome://browser/skin/zen-icons/folder.svg",
            path: path.join(" / "),
          },
          suggestedIndex:
            1 +
            Math.round(
              (1 - Math.min(match.score, 1)) * (queryContext.maxResults - 2),
            ),
        }),
      );
    }
  }

  getViewUpdate(result) {
    return {
      icon: { attributes: { src: result.payload.icon } },
      titleStrong: {
        textContent: formatValueSync(result.payload.titleL10n),
        attributes: { dir: "ltr" },
      },
      path: {
        textContent: result.payload.path,
        attributes: { dir: "ltr", hidden: !result.payload.path },
      },
      userIcon: {
        attributes: {
          src: result.payload.userIcon,
          hidden: !result.payload.userIcon,
        },
      },
    };
  }

  getViewTemplate() {
    return {
      attributes: {
        selectable: true,
      },
      children: [
        {
          name: "icon",
          tag: "img",
          classList: ["urlbarView-favicon", "urlbarView-action-favicon"],
        },
        {
          name: "title",
          tag: "span",
          classList: ["urlbarView-title"],
          children: [
            {
              name: "titleStrong",
              tag: "strong",
            },
          ],
        },
        {
          tag: "span",
          classList: ["urlbarView-prettyName"],
          children: [
            {
              name: "userIcon",
              tag: "img",
              attributes: { hidden: true },
            },
            {
              name: "path",
              tag: "span",
            },
          ],
        },
      ],
    };
  }

  onEngagement(queryContext, controller, details) {
    const { zenFolderId } = details.result.payload;
    if (!zenFolderId) {
      return;
    }
    const ownerGlobal = details.element.documentGlobal;
    ownerGlobal.gBrowser.selectedBrowser.focus();
    const folder = ownerGlobal.document.getElementById(zenFolderId);
    if (folder?.isZenFolder) {
      ownerGlobal.gZenFolders.revealFolder(folder);
    }
  }
}

/** Arc's empty command bar uses live tab metadata, not history frecency.
 * A seeded/unloaded tab can have no Places row at all. Reading the existing
 * tab's label/icon/currentURI does not restore or navigate its browser. */
export class ZenUrlbarProviderRecentTabs extends UrlbarProvider {
  /** Read only this window's tabs, across Spaces belonging to its profile. */
  static #scope(window) {
    const browser = window?.gBrowser;
    const manager = window?.gZenWorkspaces;
    let spaces = [];
    const enabled = manager?.workspaceEnabled && !manager.privateWindowOrDisabled;
    if (enabled) {
      try {
        spaces = manager.getWorkspaces();
      } catch {
        // Before initialization there is no safe profile boundary to search.
      }
    }
    const byId = new Map(spaces.map((space) => [space.uuid, space]));
    const active = byId.get(manager?.activeWorkspace);
    const profileId = Number(active?.containerTabId) || 0;
    const tabs = !browser || (enabled && !active)
      ? []
      : Array.from(enabled ? manager.allStoredTabs : browser.tabs).filter((tab) => {
          if (
            tab.closing ||
            !this.#tabId(tab) ||
            tab.hasAttribute("zen-empty-tab") ||
            tab.hasAttribute("zen-glance-tab")
          ) {
            return false;
          }
          if (!enabled) {
            return true;
          }
          if (tab.hasAttribute("zen-essential")) {
            if (!manager.containerSpecificEssentials) {
              return true;
            }
            const context = Number(tab.getAttribute("usercontextid")) || 0;
            // The active essentials container follows the Space profile.
            return context === profileId;
          }
          const id = tab.getAttribute("zen-workspace-id");
          const space = byId.get(id);
          return !id || (!!space && (Number(space.containerTabId) || 0) === profileId);
        });
    return { tabs, byId, profileId };
  }

  static #tabId(tab) {
    // Restored, never-loaded tabs can have a Zen id but no linkedPanel yet.
    return tab.id ? `id:${tab.id}` : tab.linkedPanel ? `panel:${tab.linkedPanel}` : "";
  }

  static #spaceId(tab) {
    return tab.hasAttribute("zen-essential") ? "" : tab.getAttribute("zen-workspace-id");
  }

  static tabKey(url, userContextId, group) {
    return JSON.stringify([url, userContextId, group || ""]);
  }

  static #commandCandidate(target, members, payload, now) {
    const savedTitle = tab => tab.zenStaticLabel || tab.getAttribute("zen-static-label") ||
      tab._zenPinnedInitialState?.entry?.title || tab.label || undefined;
    const liveTitle = tab => tab.linkedBrowser?.contentTitle ||
      tab._zenPinnedInitialState?.entry?.title || tab.label || undefined;
    const join = values => values.some(Boolean) ? values.map(value => value || "").join(" | ") : undefined;
    const features = {};
    const activeTimes = members.map(tab => tab.lastSeenActive ?? tab.lastAccessed)
      .filter(time => Number.isFinite(time) && time > 0);
    if (activeTimes.length && Number.isFinite(now)) {
      features.lastNavigated = (now - Math.max(...activeTimes)) / 1000;
    }
    const global = target.hasAttribute("zen-essential");
    const saved = global || target.pinned || target.group?.pinned;
    if (saved) {
      // Arc counts the item and the Favorites/Space root, then each parent
      // folder. A combined split result is one item, not an extra pane level.
      let level = 2;
      const item = payload.zenSplitView ? target.group : target;
      const seen = new Set();
      for (let parent = item?.parentElement; parent && !seen.has(parent); parent = parent.parentElement) {
        seen.add(parent);
        if (parent.isZenFolder) level++;
      }
      features.saveLevel = level;
    }
    return {
      archetype: "tab",
      url: payload.url,
      title: join(members.map(liveTitle)),
      // Arc's customTitle field falls back to its stored tab title even when
      // the user has not explicitly renamed the tab.
      customTitle: join(members.map(savedTitle)),
      ...(saved && { savedContext: global ? "global" : "scoped" }),
      features,
      result: payload,
    };
  }

  /** Typed searches offer the current Space and its Favorites, including unloaded tabs. */
  static typedScope(window, isPrivate = false, { includeRanking = false, now = Date.now() } = {}) {
    const scope = this.#scope(window);
    const active = window?.gZenWorkspaces?.activeWorkspace;
    const enabled = window?.gZenWorkspaces?.workspaceEnabled && !window.gZenWorkspaces.privateWindowOrDisabled;
    const tabs = scope.tabs.filter(tab => !enabled || !this.#spaceId(tab) || this.#spaceId(tab) === active);
    const allowed = new Set(tabs);
    const byKey = new Map(), results = [], seen = new Set();
    const candidatesByKey = includeRanking ? new Map() : undefined;
    const title = tab => tab.zenStaticLabel || tab.getAttribute("zen-static-label") || tab.label || tab.linkedBrowser?.currentURI?.spec;
    const icon = tab => tab.image || UrlbarShared.getIconForUrl(tab.linkedBrowser.currentURI.spec);
    for (const tab of tabs.sort((a, b) => b.lastAccessed - a.lastAccessed)) {
      const split = tab.group?.hasAttribute?.("split-view-group");
      const members = split ? Array.from(tab.group.tabs).filter(t => allowed.has(t)) : [tab];
      const target = members[0];
      if (!target || seen.has(target)) {
        continue;
      }
      seen.add(target);
      const url = target.linkedBrowser?.currentURI?.spec;
      if (!url || url === "about:blank" || url === "about:newtab") {
        continue;
      }
      const userContextId = Number(target.getAttribute("usercontextid")) || 0;
      const payload = {
        url,
        title: members.map(title).join(" | "),
        icon: icon(target),
        userContext: UrlbarUtils.getUserContextData(userContextId),
        tabGroup: target.group?.id,
        zenTabId: this.#tabId(target),
        zenWorkspaceId: this.#spaceId(target),
        zenProfileId: scope.profileId,
        ...(split && { zenSplitView: true, zenSplitIcons: members.map(icon), zenSplitTitles: members.map(title) }),
      };
      const urls = [];
      const candidate = includeRanking ? this.#commandCandidate(target, members, payload, now) : undefined;
      for (const member of members) {
        const memberURL = member.linkedBrowser?.currentURI?.spec;
        if (!memberURL) {
          continue;
        }
        urls.push(memberURL);
        const context = Number(member.getAttribute("usercontextid")) || 0;
        const key = this.tabKey(memberURL, isPrivate ? UrlbarShared.PRIVATE_USER_CONTEXT_ID : context, member.group?.id);
        // Identical URLs can be open twice. Keep the most recently used target.
        if (!byKey.has(key)) {
          byKey.set(key, payload);
          candidatesByKey?.set(key, candidate);
        }
      }
      results.push({ payload, urls, ...(includeRanking && { candidate }) });
    }
    return { byKey, results, ...(includeRanking && { candidatesByKey }), sqlKeys: JSON.stringify(Object.fromEntries([...byKey.keys()].map(key => [key, 1]))) };
  }

  /** Switch by window-local identity; never substitute another tab's URL. */
  static async switchToTab(window, payload) {
    if (!payload?.zenTabId || window?.closed) {
      return false;
    }
    const findTarget = () => {
      const scope = this.#scope(window);
      if (scope.profileId !== payload.zenProfileId) {
        return undefined;
      }
      return scope.tabs.find((tab) =>
        this.#tabId(tab) === payload.zenTabId &&
        (!payload.zenSplitView || (tab.group?.id === payload.tabGroup &&
          tab.group.hasAttribute("split-view-group") && tab.group.tabs.length > 1)) &&
        tab.linkedBrowser?.currentURI?.spec === payload.url &&
        this.#spaceId(tab) === payload.zenWorkspaceId &&
        (Number(tab.getAttribute("usercontextid")) || 0) ===
          (payload.userContext?.id || 0),
      );
    };
    const target = findTarget();
    if (!target) {
      return false;
    }
    const manager = window.gZenWorkspaces;
    const space = payload.zenWorkspaceId;
    if (
      space &&
      manager?.workspaceEnabled &&
      !manager.privateWindowOrDisabled &&
      space !== manager.activeWorkspace
    ) {
      await manager.changeWorkspaceWithID(space);
      if (manager.activeWorkspace !== space) {
        return false;
      }
    }
    // Space switching can yield to a close, navigation, move or profile change.
    if (window.closed || findTarget() !== target) {
      return false;
    }
    window.gBrowser.selectedTab = target;
    if (window.gBrowser.selectedTab !== target) {
      return false;
    }
    target.linkedBrowser.focus();
    return true;
  }

  get type() {
    return UrlbarShared.PROVIDER_TYPE.PROFILE;
  }

  async isActive(context, controller) {
    if (controller.browserWindow?._zenLittleWindow ||
        controller.browserWindow?.gURLBar?.hasAttribute("zen-arc-address-preview")) {
      return !context.searchString.trim() && !context.searchMode;
    }
    return (
      !context.searchString.trim() &&
      (context.searchMode?.source === UrlbarShared.RESULT_SOURCE.TABS ||
        controller.browserWindow?.gURLBar?.hasAttribute("zen-arc-url-editor")) &&
      !!controller.browserWindow?.gURLBar?.hasAttribute("zen-arc-open-tabs") &&
      lazy.UrlbarPrefs.get("suggest.openpage")
    );
  }

  getPriority() {
    // Top Sites also has priority 1. The address editor leaves search mode
    // unset to preserve its selected URL, so outrank Top Sites as well.
    // Normal typed queries and explicit Tabs mode retain native providers.
    return 2;
  }

  async startQuery(context, addCallback, controller) {
    const window = controller.browserWindow;
    const browser = window?.gBrowser;
    if (!browser || context.maxResults <= 0) {
      return;
    }
    if (window._zenLittleWindow || window.gURLBar.hasAttribute("zen-arc-address-preview")) {
      await this.#queryNavigationSites(context, addCallback, window);
      return;
    }
    const activeSpace = window.gZenWorkspaces?.activeWorkspace;
    const scope = ZenUrlbarProviderRecentTabs.#scope(window);
    const editing = window.gURLBar.hasAttribute("zen-arc-url-editor");
    const tabs = scope.tabs
      .filter((tab) => editing || tab !== browser.selectedTab)
      .sort((a, b) => editing && a === browser.selectedTab ? -1 :
        editing && b === browser.selectedTab ? 1 : b.lastAccessed - a.lastAccessed);
    const seen = new Set();
    let index = 0;
    for (const tab of tabs) {
      const url = tab.linkedBrowser?.currentURI?.spec;
      if (!url || url === "about:blank" || url === "about:newtab") {
        continue;
      }
      const userContextId = Number(tab.getAttribute("usercontextid")) || 0;
      const group = tab.group?.id ?? null;
      const spaceId = ZenUrlbarProviderRecentTabs.#spaceId(tab);
      const key = JSON.stringify([url, userContextId, group, spaceId]);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const space = scope.byId.get(spaceId);
      addCallback(
        this,
        new lazy.UrlbarResult({
          type: UrlbarShared.RESULT_TYPE.TAB_SWITCH,
          source: UrlbarShared.RESULT_SOURCE.TABS,
          suggestedIndex: index,
          payload: {
            url,
            title: tab.getAttribute("zen-static-label") || tab.label || url,
            icon: tab.image || UrlbarShared.getIconForUrl(url),
            userContext: UrlbarUtils.getUserContextData(userContextId),
            tabGroup: group,
            zenTabId: ZenUrlbarProviderRecentTabs.#tabId(tab),
            zenWorkspaceId: spaceId,
            zenProfileId: scope.profileId,
            zenWorkspaceName:
              space && spaceId !== activeSpace
                ? window.gZenWorkspaces.getWorkspaceDisplayName(space)
                : undefined,
          },
        }),
      );
      if (++index === Math.min(4, context.maxResults)) {
        break;
      }
    }
    if (index < context.maxResults) {
      addCallback(
        this,
        new lazy.UrlbarResult({
          type: UrlbarShared.RESULT_TYPE.DYNAMIC,
          source: UrlbarShared.RESULT_SOURCE.ACTIONS,
          suggestedIndex: index,
          payload: { dynamicType: "zen-arc-support" },
        }),
      );
    }
  }

  async #queryNavigationSites(context, addCallback, window) {
    // Arc's address preview and Little command panel use cached Top Sites.
    // These destinations navigate the current tab rather than switching to
    // an open tab. Reuse Gecko's live cached model;
    // never fabricate visits or freeze a copied list of the user's sites.
    const instance = this.queryInstance;
    let sites = [];
    if (
      !context.isPrivate &&
      !context.userContextId &&
      Services.prefs.getBoolPref("browser.urlbar.suggest.topsites", false) &&
      Services.prefs.getBoolPref("browser.newtabpage.activity-stream.feeds.system.topsites", false)
    ) {
      try { sites = await lazy.TopSites.getSites(); } catch {}
    }
    if (this.queryInstance !== instance) return;
    // Editing an existing page starts with that page, followed by
    // three cached destinations. The search-only entry panel has four sites.
    if (window.gURLBar.hasAttribute("zen-little-url-editor") ||
        window.gURLBar.hasAttribute("zen-arc-address-preview")) {
      const tab = window.gBrowser.selectedTab;
      const url = tab?.linkedBrowser?.currentURI?.spec;
      if (url && /^(https?:|about:)/i.test(url)) {
        sites = [{ url, isCurrentPage: true, title: tab.label || url, favicon: window.gBrowser.getIcon?.(tab) }, ...sites];
      }
    }
    const seen = new Set();
    let index = 0;
    for (const site of sites) {
      const url = site?.url_urlbar || site?.url;
      if (
        !url || (!/^https?:\/\//i.test(url) && !(site.isCurrentPage && /^about:/i.test(url))) || site.searchTopSite ||
        site.sponsored_position || site.isSponsored || seen.has(url) ||
        (site.isPinned && !Services.prefs.getBoolPref("zen.urlbar.show-pinned", false))
      ) continue;
      seen.add(url);
      addCallback(this, new lazy.UrlbarResult({
        type: UrlbarShared.RESULT_TYPE.URL,
        source: UrlbarShared.RESULT_SOURCE.HISTORY,
        suggestedIndex: index,
        payload: {
          url,
          title: site.label || site.title || site.hostname || url,
          icon: site.smallFavicon || site.favicon || UrlbarShared.getIconForUrl(url),
        },
      }));
      if (++index === Math.min(4, context.maxResults)) break;
    }
    if (index < context.maxResults) {
      addCallback(this, new lazy.UrlbarResult({
        type: UrlbarShared.RESULT_TYPE.DYNAMIC,
        source: UrlbarShared.RESULT_SOURCE.ACTIONS,
        suggestedIndex: index,
        payload: { dynamicType: "zen-arc-support" },
      }));
    }
  }

  getViewTemplate() {
    return {
      attributes: { selectable: true },
      children: [
        { name: "icon", tag: "img", classList: ["urlbarView-favicon"] },
        { name: "title", tag: "span", classList: ["urlbarView-title"] },
      ],
    };
  }

  getViewUpdate() {
    return {
      icon: {
        attributes: {
          src: "chrome://browser/skin/zen-icons/selectable/chat.svg",
        },
      },
      title: { textContent: formatValueSync("zen-urlbar-contact-team") },
    };
  }

  onEngagement(_context, controller, details) {
    if (details.result?.payload.dynamicType === "zen-arc-support") {
      // Open the fork's actual support destination. No report is sent until
      // the user chooses to write and submit one there.
      controller.browserWindow.openTrustedLinkIn(
        "https://github.com/RandNMR73/desktop/issues",
        "tab",
      );
    }
  }
}
