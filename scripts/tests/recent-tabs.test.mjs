/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../../src/zen/urlbar/ZenUBSidebarProvider.sys.mjs", import.meta.url),
  "utf8",
);
const recent = source
  .slice(source.indexOf("export class ZenUrlbarProviderRecentTabs"))
  .replace(
    "export class ZenUrlbarProviderRecentTabs",
    "globalThis.Provider = class ZenUrlbarProviderRecentTabs",
  );
function tab(id, time, attributes = {}) {
  const attrs = { "zen-workspace-id": "main", ...attributes };
  return {
    linkedPanel: `panel-${id}-${time}`,
    attrs,
    label: `Title ${id}`,
    image: `data:image/png;base64,${id}`,
    lastAccessed: time,
    linkedBrowser: { currentURI: { spec: `https://example.com/${id}` }, focus() {} },
    getAttribute: (k) => attrs[k] || "",
    hasAttribute: (k) => k in attrs,
  };
}
function fixture(tabs, options = {}) {
  let topSiteReads = 0;
  const prefs = new Map([
    ["browser.urlbar.suggest.topsites", true],
    ["browser.newtabpage.activity-stream.feeds.system.topsites", true],
    ...options.prefs || [],
  ]);
  const sandbox = vm.createContext({
    UrlbarProvider: class {},
    UrlbarShared: {
      PROVIDER_TYPE: { PROFILE: 1 },
      RESULT_SOURCE: { HISTORY: 1, TABS: 4, ACTIONS: 9 },
      RESULT_TYPE: { URL: 1, TAB_SWITCH: 3, DYNAMIC: 8 },
      getIconForUrl: (url) => url,
    },
    UrlbarUtils: { getUserContextData: (id) => ({ id }) },
    Services: { prefs: { getBoolPref: (name, fallback) => prefs.get(name) ?? fallback } },
    lazy: {
      UrlbarResult: class {
        constructor(value) {
          Object.assign(this, value);
        }
      },
      UrlbarPrefs: { get: () => options.openTabs !== false },
      TopSites: { async getSites() {
        topSiteReads++;
        return options.getSites ? options.getSites() : options.sites || [];
      } },
    },
  });
  vm.runInContext(recent, sandbox);
  const provider = new sandbox.Provider();
  const window = {
    _zenLittleWindow: !!options.little,
    gURLBar: { hasAttribute: (name) => name === "zen-arc-open-tabs" || (options.editing && name === "zen-little-url-editor") },
    gBrowser: { tabs, selectedTab: tabs[0] },
    gZenWorkspaces: {
      workspaceEnabled: true,
      activeWorkspace: "main",
      allStoredTabs: tabs,
      containerSpecificEssentials: true,
      getWorkspaces: () => [
        { uuid: "main", name: "Main Space", containerTabId: 0 },
        { uuid: "other", name: "Other Space", containerTabId: 0 },
        { uuid: "work", name: "Work", containerTabId: 2 },
      ],
      getWorkspaceDisplayName: (space) => space.name,
      async changeWorkspaceWithID(id) { this.activeWorkspace = id; },
    },
  };
  const controller = { browserWindow: window };
  const context = {
    searchString: "",
    searchMode: { source: 4 },
    maxResults: 10,
  };
  return {
    provider,
    window,
    controller,
    context,
    topSiteReads: () => topSiteReads,
    async results(includeSupport = false) {
      const result = [];
      await provider.startQuery(context, (_, r) => result.push(r), controller);
      return includeSupport ? result : result.filter((r) => r.type === 3);
    },
  };
}
test("empty preview uses four most recent tabs with live labels and icons", async () => {
  const tabs = [
    tab("selected", 100),
    ...Array.from({ length: 7 }, (_, i) => tab(String(i), i)),
  ];
  tabs[7].getAttribute = (k) =>
    k === "zen-static-label"
      ? "Renamed tab"
      : k === "zen-workspace-id"
        ? "main"
        : "";
  const f = fixture(tabs);
  assert.equal(await f.provider.isActive(f.context, f.controller), true);
  const r = await f.results();
  assert.equal(r.length, 4);
  assert.deepEqual(
    r.map((v) => v.payload.url),
    [6, 5, 4, 3].map((i) => `https://example.com/${i}`),
  );
  assert.equal(r[0].payload.title, "Renamed tab");
  assert.equal(r[0].payload.icon, tabs[7].image);
  assert.deepEqual(
    r.map((v) => v.suggestedIndex),
    [0, 1, 2, 3],
  );
});
test("same-profile Spaces share recency; closing, empty and Peek tabs are excluded", async () => {
  const closing = tab("closing", 100);
  closing.closing = true;
  const f = fixture([
    tab("selected", 999),
    tab("other", 90, { "zen-workspace-id": "other" }),
    closing,
    tab("empty", 80, { "zen-empty-tab": "true" }),
    tab("peek", 85, { "zen-glance-tab": "true" }),
    tab("favorite", 70, {
      "zen-essential": "true",
      "zen-workspace-id": "other",
    }),
    tab("local", 60),
  ]);
  assert.deepEqual(
    (await f.results()).map((r) => r.payload.title),
    ["Title other", "Title favorite", "Title local"],
  );
  assert.equal((await f.results())[0].payload.zenWorkspaceName, "Other Space");
  assert.equal((await f.results())[1].payload.zenWorkspaceName, undefined);
});
test("deduplicate identical targets while preserving separate containers and groups", async () => {
  const a = tab("same", 10),
    b = tab("same", 9),
    c = tab("same", 8, { usercontextid: "2" }),
    d = tab("same", 7);
  d.group = { id: "split" };
  const f = fixture([tab("selected", 100), a, b, c, d]);
  const r = await f.results();
  assert.equal(r.length, 3);
  assert.equal(r[1].payload.userContext.id, 2);
  assert.equal(r[2].payload.tabGroup, "split");
});
test("typed and explicit tabs searches retain native providers", async () => {
  const f = fixture([tab("selected", 100), tab("other", 50)]);
  f.context.searchString = "typed";
  assert.equal(await f.provider.isActive(f.context, f.controller), false);
  f.context.searchString = "";
  f.window.gURLBar.hasAttribute = () => false;
  assert.equal(await f.provider.isActive(f.context, f.controller), false);
});
test("window isolation also applies to private queries and respects result cap", async () => {
  const f = fixture([
    tab("selected", 100),
    tab("private1", 80),
    tab("private2", 70),
  ]);
  f.context.isPrivate = true;
  f.context.maxResults = 1;
  const r = await f.results();
  assert.equal(r.length, 1);
  assert.equal(r[0].payload.title, "Title private1");
  f.controller.browserWindow = null;
  assert.equal(await f.provider.isActive(f.context, f.controller), false);
});

test("support is a separate local action and only activates on selection", async () => {
  const f = fixture([tab("selected", 100), tab("other", 50)]);
  const opened = [];
  f.window.openTrustedLinkIn = (...args) => opened.push(args);
  const r = await f.results(true);
  assert.equal(opened.length, 0);
  assert.equal(r[1].payload.dynamicType, "zen-arc-support");
  assert.equal(r[1].source, 9);
  f.provider.onEngagement(f.context, f.controller, { result: r[0] });
  assert.equal(opened.length, 0);
  f.provider.onEngagement(f.context, f.controller, { result: r[1] });
  assert.deepEqual(opened, [
    ["https://github.com/RandNMR73/desktop/issues", "tab"],
  ]);
  f.context.maxResults = 0;
  assert.equal((await f.results(true)).length, 0);
});

test("inactive stored tabs participate without loading them or consulting another window", async () => {
  const selected = tab("selected", 100), local = tab("local", 2);
  const inactive = tab("inactive", 90, { "zen-workspace-id": "other", pending: "true" });
  const f = fixture([selected, local]);
  f.window.gZenWorkspaces.allStoredTabs = [selected, local, inactive];
  const r = await f.results();
  assert.equal(r[0].payload.title, "Title inactive");
  assert.equal(r[0].payload.zenTabId, `panel:${inactive.linkedPanel}`);
  assert.equal(f.window.gBrowser.selectedTab, selected);
  assert.equal(f.window.gZenWorkspaces.activeWorkspace, "main");
});

test("other profiles and their Favorites stay isolated", async () => {
  const f = fixture([
    tab("selected", 100),
    tab("work", 99, { "zen-workspace-id": "work", usercontextid: "2" }),
    tab("work-favorite", 98, { "zen-essential": "true", usercontextid: "2" }),
    tab("other", 90, { "zen-workspace-id": "other" }),
    tab("local", 80),
  ]);
  assert.deepEqual((await f.results()).map(r => r.payload.title), ["Title other", "Title local"]);
  f.window.gZenWorkspaces.activeWorkspace = "work";
  assert.deepEqual((await f.results()).map(r => r.payload.title), ["Title work", "Title work-favorite"]);
});

test("duplicate URLs in different Spaces retain separate exact targets", async () => {
  const local = tab("same", 5), other = tab("same", 6, { "zen-workspace-id": "other" });
  const f = fixture([tab("selected", 100), local, other]);
  const r = await f.results();
  assert.equal(r.length, 2);
  assert.deepEqual(r.map(r => r.payload.zenTabId), [`panel:${other.linkedPanel}`, `panel:${local.linkedPanel}`]);
  const target = JSON.parse(JSON.stringify(r[0].payload));
  assert.equal(await f.provider.constructor.switchToTab(f.window, target), true);
  assert.equal(f.window.gBrowser.selectedTab, other);
  assert.equal(f.window.gZenWorkspaces.activeWorkspace, "other");
});

test("a stale result never navigates to a replacement URL or changes profile", async () => {
  const target = tab("other", 5, { "zen-workspace-id": "other" });
  const f = fixture([tab("selected", 100), target]);
  const result = (await f.results())[0].payload;
  target.closing = true;
  assert.equal(await f.provider.constructor.switchToTab(f.window, result), false);
  target.closing = false;
  target.attrs['zen-workspace-id'] = "work";
  assert.equal(await f.provider.constructor.switchToTab(f.window, result), false);
  target.attrs['zen-workspace-id'] = "other";
  target.linkedBrowser.currentURI.spec = "https://example.com/changed";
  assert.equal(await f.provider.constructor.switchToTab(f.window, result), false);
  assert.equal(f.window.gZenWorkspaces.activeWorkspace, "main");
  assert.equal(f.window.gBrowser.selectedTab.label, "Title selected");
});

test("target is revalidated after an asynchronous Space switch", async () => {
  const target = tab("other", 5, { "zen-workspace-id": "other" });
  const f = fixture([tab("selected", 100), target]);
  const result = (await f.results())[0].payload;
  f.window.gZenWorkspaces.changeWorkspaceWithID = async () => { target.closing = true; };
  assert.equal(await f.provider.constructor.switchToTab(f.window, result), false);
  assert.equal(f.window.gBrowser.selectedTab.label, "Title selected");
});

test("private windows use only their own tab collection", async () => {
  const local = tab("private", 3), f = fixture([tab("selected", 100), local]);
  f.window.gZenWorkspaces.privateWindowOrDisabled = true;
  f.window.gZenWorkspaces.allStoredTabs = [tab("not-private", 99)];
  f.context.isPrivate = true;
  const r = await f.results();
  assert.deepEqual(r.map(r => r.payload.title), ["Title private"]);
  assert.equal(await f.provider.constructor.switchToTab(f.window, r[0].payload), true);
  assert.equal(f.window.gBrowser.selectedTab, local);
});

test("a query reads the Space model once and handles initialization without leaking tabs", async () => {
  const f = fixture([tab("selected", 10), tab("local", 5), tab("other", 4, { "zen-workspace-id": "other" })]);
  const get = f.window.gZenWorkspaces.getWorkspaces;
  let reads = 0;
  f.window.gZenWorkspaces.getWorkspaces = () => { reads++; return get(); };
  assert.equal((await f.results()).length, 2);
  assert.equal(reads, 1);
  f.window.gZenWorkspaces.getWorkspaces = () => { throw new Error("not initialized"); };
  assert.deepEqual(await f.results(), []);
  f.window.gZenWorkspaces.getWorkspaces = get;
  f.window.gZenWorkspaces.activeWorkspace = "missing";
  assert.deepEqual(await f.results(), []);
});

test("profile IDs normalize saved strings and hidden Favorite containers stay hidden", async () => {
  const f = fixture([
    tab("selected", 10),
    tab("favorite", 9, { "zen-essential": "true", usercontextid: "3" }),
    tab("work", 8, { "zen-workspace-id": "work", usercontextid: "2" }),
    tab("local", 7),
  ]);
  const get = f.window.gZenWorkspaces.getWorkspaces;
  f.window.gZenWorkspaces.getWorkspaces = () => get().map(s => ({ ...s, containerTabId: String(s.containerTabId) }));
  assert.deepEqual((await f.results()).map(r => r.payload.title), ["Title local"]);
  f.window.gZenWorkspaces.activeWorkspace = "work";
  const results = await f.results();
  assert.deepEqual(results.map(r => r.payload.title), ["Title work"]);
  assert.equal(results[0].payload.zenProfileId, 2);
  assert.equal(await f.provider.constructor.switchToTab(f.window, results[0].payload), true);
});

test("moving a result to another same-profile Space invalidates its old action", async () => {
  const target = tab("other", 5, { "zen-workspace-id": "other" });
  const f = fixture([tab("selected", 10), target]);
  const result = (await f.results())[0].payload;
  target.attrs["zen-workspace-id"] = "main";
  assert.equal(await f.provider.constructor.switchToTab(f.window, result), false);
  target.attrs["zen-workspace-id"] = "other";
  f.window.gZenWorkspaces.changeWorkspaceWithID = async id => {
    f.window.gZenWorkspaces.activeWorkspace = id;
    target.attrs["zen-workspace-id"] = "main";
  };
  assert.equal(await f.provider.constructor.switchToTab(f.window, result), false);
  assert.equal(f.window.gBrowser.selectedTab.label, "Title selected");
});

test("profile reassignment during a pending switch cannot make an old result eligible", async () => {
  const target = tab("other", 5, { "zen-workspace-id": "other" });
  const f = fixture([tab("selected", 10), target]);
  const result = (await f.results())[0].payload;
  const get = f.window.gZenWorkspaces.getWorkspaces;
  f.window.gZenWorkspaces.changeWorkspaceWithID = async id => {
    f.window.gZenWorkspaces.activeWorkspace = id;
    f.window.gZenWorkspaces.getWorkspaces = () => get().map(s => ({ ...s, containerTabId: 2 }));
  };
  assert.equal(await f.provider.constructor.switchToTab(f.window, result), false);
  assert.equal(f.window.gBrowser.selectedTab.label, "Title selected");
});

test("never-loaded restored tabs use their persistent identity without a linked panel", async () => {
  const target = tab("restored", 5, { "zen-workspace-id": "other", pending: "true" });
  delete target.linkedPanel;
  target.id = "restored-zen-id";
  const f = fixture([tab("selected", 10), target]);
  const result = (await f.results())[0];
  assert.equal(result.payload.zenTabId, "id:restored-zen-id");
  assert.equal(target.linkedPanel, undefined);
  assert.equal(await f.provider.constructor.switchToTab(f.window, result.payload), true);
  assert.equal(f.window.gBrowser.selectedTab, target);
});

test("sidebar address preview includes the current tab and outranks Top Sites", async () => {
  const tabs = [tab("selected", 1), tab("recent", 50), tab("older", 20)];
  const f = fixture(tabs);
  f.window.gURLBar.hasAttribute = (name) =>
    ["zen-arc-open-tabs", "zen-arc-url-editor"].includes(name);
  f.context.searchMode = null;
  assert.equal(await f.provider.isActive(f.context, f.controller), true);
  assert.equal(f.provider.getPriority(), 2);
  const results = await f.results();
  assert.deepEqual(
    results.map((r) => r.payload.url),
    tabs.map((t) => t.linkedBrowser.currentURI.spec),
  );
  f.context.searchString = "edited address";
  assert.equal(await f.provider.isActive(f.context, f.controller), false);
});


test("Little empty queries navigate to four real Top Sites instead of offering tab switches", async () => {
  const sites = [
    null,
    { url: "javascript:alert(1)", title: "invalid" },
    { url: "https://search.invalid/", searchTopSite: true },
    { url: "https://sponsored.invalid/", sponsored_position: 1 },
    { url: "https://pinned.invalid/", isPinned: true },
    ...Array.from({length: 6}, (_, i) => ({url: `https://site${i}.invalid/`, title: `Real site ${i}`})),
  ];
  sites.splice(7, 0, sites[5]);
  const f = fixture([tab("current", 1)], { little: true, sites, openTabs: false });
  f.context.searchMode = null;
  assert.equal(await f.provider.isActive(f.context, f.controller), true);
  const r = await f.results(true);
  assert.equal(f.topSiteReads(), 1);
  assert.deepEqual(r.map(x => x.type), [1, 1, 1, 1, 8]);
  assert.deepEqual(r.slice(0, 4).map(x => x.payload.url), sites.slice(5).filter((s,i,a) => a.findIndex(x => x.url === s.url) === i).slice(0,4).map(x => x.url));
  assert.equal(r[0].payload.title, "Real site 0");
  assert.equal(r[4].payload.dynamicType, "zen-arc-support");
});

test("Little Top Sites respect privacy, container boundaries and disabled suggestions", async () => {
  for (const settings of [{private:true}, {container:2}, {disabled:true}]) {
    const f = fixture([], {little:true, sites:[{url:"https://private.invalid/"}], prefs: settings.disabled ? [["browser.urlbar.suggest.topsites",false]] : []});
    f.context.isPrivate=!!settings.private;
    f.context.userContextId=settings.container || 0;
    const r=await f.results(true);
    assert.equal(f.topSiteReads(),0);
    assert.equal(r.length,1);
    assert.equal(r[0].payload.dynamicType,"zen-arc-support");
  }
});

test("cancelled Little Top Sites requests cannot append stale rows", async () => {
  let resolve;
  const sites=new Promise(r=>{resolve=r;});
  const f=fixture([],{little:true,getSites:()=>sites});
  f.provider.queryInstance=1;
  const result=f.results(true);
  f.provider.queryInstance=2;
  resolve([{url:"https://stale.invalid/"}]);
  assert.deepEqual(await result,[]);
});


test("Little address preview starts with its current page and removes a duplicate cached destination", async () => {
  for (const url of ["https://current.invalid/", "about:blank"]) {
    const current = tab("current", 1);
    current.linkedBrowser.currentURI.spec = url;
    current.label = "Current page";
    const f = fixture([current], {little: true, editing: true, sites: [
      {url, title: "Duplicate"},
      ...Array.from({length: 4}, (_, i) => ({url: `https://other${i}.invalid/`}))
    ]});
    const rows = await f.results(true);
    assert.equal(rows.length, 5);
    assert.equal(rows[0].payload.url, url);
    assert.equal(rows[0].payload.title, "Current page");
    assert.equal(rows.filter(r => r.payload.url === url).length, 1);
    assert.equal(rows[4].payload.dynamicType, "zen-arc-support");
  }
});
