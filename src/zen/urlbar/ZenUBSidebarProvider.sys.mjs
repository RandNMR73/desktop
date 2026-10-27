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
  UrlbarProviderOpenTabs:
    "moz-src:///browser/components/urlbar/UrlbarProviderOpenTabs.sys.mjs",
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
      !queryContext.isPrivate &&
      !!queryContext.tokens.length &&
      queryContext.sources.includes(UrlbarShared.RESULT_SOURCE.TABS) &&
      lazy.UrlbarPrefs.get("suggest.openpage")
    );
  }

  async startQuery(queryContext, addCallback) {
    const sidebar = lazy.ZenSessionStore.getSidebarData();
    if (!sidebar) {
      return;
    }
    const tokens = queryContext.tokens.map((t) => t.lowerCaseValue);
    const score = (text) => {
      text = text.toLowerCase();
      if (!tokens.every((token) => text.includes(token))) {
        return 0;
      }
      return tokens.reduce((sum, token) => sum + token.length, 0) / text.length;
    };
    this.#addFolders(sidebar, score, queryContext, addCallback);
    this.#addTabs(sidebar, score, queryContext, addCallback);
  }

  #addTabs(sidebar, score, queryContext, addCallback) {
    const openTabUrls = lazy.UrlbarProviderOpenTabs.getOpenTabUrls();
    const activeSpace =
      lazy.BrowserWindowTracker.getTopWindow().gZenWorkspaces.activeWorkspace;
    let resultsAdded = 0;
    for (const tabData of sidebar.tabs || []) {
      // Essentials have no space, they are part of every one of them.
      if (!tabData.zenEssential && tabData.zenWorkspace != activeSpace) {
        continue;
      }
      const entries = tabData.entries || [];
      const entry = entries[(tabData.index || entries.length) - 1];
      const label = tabData.zenStaticLabel || entry?.title;
      if (typeof label !== "string" || !label || !score(label)) {
        continue;
      }
      const url = entry?.url;
      if (!url || url == queryContext.currentPage) {
        // Don't suggest switching to the current tab.
        continue;
      }
      const userContextId = tabData.userContextId || 0;
      // The sidebar data can lag behind a navigation, only offer tabs that
      // are still registered as open with this url.
      const openTab = [...(openTabUrls.get(url) || [])].find(
        ([contextId]) => contextId == userContextId,
      );
      if (!openTab) {
        continue;
      }
      addCallback(
        this,
        new lazy.UrlbarResult({
          type: UrlbarShared.RESULT_TYPE.TAB_SWITCH,
          source: UrlbarShared.RESULT_SOURCE.TABS,
          payload: {
            url,
            title: label,
            icon: UrlbarShared.getIconForUrl(url),
            userContext: UrlbarUtils.getUserContextData(userContextId),
            tabGroup: openTab[1],
            action: lazy.UrlbarPrefs.get("secondaryActions.switchToTab")
              ? UrlbarUtils.createTabSwitchSecondaryAction(userContextId)
              : undefined,
          },
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
