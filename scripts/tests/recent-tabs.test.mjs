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
    label: `Title ${id}`,
    image: `data:image/png;base64,${id}`,
    lastAccessed: time,
    linkedBrowser: { currentURI: { spec: `https://example.com/${id}` } },
    getAttribute: (k) => attrs[k] || "",
    hasAttribute: (k) => k in attrs,
  };
}
function fixture(tabs) {
  const sandbox = vm.createContext({
    UrlbarProvider: class {},
    UrlbarShared: {
      PROVIDER_TYPE: { PROFILE: 1 },
      RESULT_SOURCE: { TABS: 4, ACTIONS: 9 },
      RESULT_TYPE: { TAB_SWITCH: 3, DYNAMIC: 8 },
      getIconForUrl: (url) => url,
    },
    UrlbarUtils: { getUserContextData: (id) => ({ id }) },
    lazy: {
      UrlbarResult: class {
        constructor(value) {
          Object.assign(this, value);
        }
      },
      UrlbarPrefs: { get: () => true },
    },
  });
  vm.runInContext(recent, sandbox);
  const provider = new sandbox.Provider();
  const window = {
    gURLBar: { hasAttribute: () => true },
    gBrowser: { tabs, selectedTab: tabs[0] },
    gZenWorkspaces: { activeWorkspace: "main" },
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
test("other spaces, closing and empty tabs are excluded; essentials remain", async () => {
  const closing = tab("closing", 100);
  closing.closing = true;
  const f = fixture([
    tab("selected", 999),
    tab("other", 90, { "zen-workspace-id": "other" }),
    closing,
    tab("empty", 80, { "zen-empty-tab": "true" }),
    tab("favorite", 70, {
      "zen-essential": "true",
      "zen-workspace-id": "other",
    }),
    tab("local", 60),
  ]);
  assert.deepEqual(
    (await f.results()).map((r) => r.payload.title),
    ["Title favorite", "Title local"],
  );
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
