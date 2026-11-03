const done = arguments[arguments.length - 1];
(async () => {
  const w = Services.wm.getMostRecentWindow("navigator:browser"), b = w.gURLBar, f = w.__typedTabs;
  if (!f || !Services.dirsvc.get("ProfD", Ci.nsIFile).path.includes("zen-search-color-retention-")) {
    throw Error("Disposable fixture required");
  }
  const { UrlbarShared: S } = ChromeUtils.importESModule("chrome://browser/content/urlbar/UrlbarShared.mjs");
  const { ProvidersManager } = ChromeUtils.importESModule("moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs");
  const M = ProvidersManager.getInstanceForSap("urlbar");
  const checks = [];
  const check = (name, passed) => checks.push({ name, passed: !!passed });
  const query = async text => {
    b.searchMode = null;
    b.value = text;
    b.focus();
    await b.startQuery({ searchString: text });
    await new Promise(resolve => w.setTimeout(resolve, 250));
    return [...w.document.querySelectorAll(".urlbarView-row")].filter(row => row.result && !row.hasAttribute("stale"));
  };
  let rows = await query("fixture");
  const live = rows.filter(row => row.result.type === S.RESULT_TYPE.TAB_SWITCH);
  check("one local tab and one combined split", live.length === 2);
  check("saved unloaded title and image", live.some(row => row.result.payload.title === "Saved local name" && row.result.payload.icon === f.icon));
  const split = live.find(row => row.result.payload.zenSplitView);
  check("combined split title", split?.querySelector(".urlbarView-title")?.textContent === "Left pane | Right pane");
  check("split action label", split?.querySelector(".urlbarView-action")?.textContent === "Switch to Split View");
  check("two separate pane images", split?.querySelectorAll(".zen-split-result-icons img").length === 2);
  check("no unnamed group badges", !rows.some(row => row.textContent.includes("Unnamed group")));
  check("visited page from another Space remains history", rows.some(row => row.result.type === S.RESULT_TYPE.URL && row.result.payload.url === "https://fixture.test/other"));
  check("unvisited page from another Space excluded", !rows.some(row => row.result.payload.url === "https://fixture.test/never"));
  check("suggesting tabs does not load their pages", f.tabs.every(tab => tab.hasAttribute("pending")));
  rows = await query("Saved local name");
  check("renamed tab matches its saved label", rows.some(row => row.result.payload.zenTabId === `id:${f.local.id}`));
  const sidebar = M.getProvider("ZenUrlbarProviderSidebar");
  M.unregisterProvider(sidebar);
  let placesRows, placesData;
  try {
    placesRows = await query("fixture");
    const direct = placesRows.filter(row => row.result.type === S.RESULT_TYPE.TAB_SWITCH);
    check("native Places path retains live tab metadata", direct.length === 2 && direct.every(row => row.result.payload.zenTabId && row.result.payload.icon === f.icon));
    check("native Places path also deduplicates split panes", direct.filter(row => row.result.payload.zenSplitView).length === 1);
    placesData = placesRows.map(row => ({ provider: row.result.providerName, type: row.result.type,
      title: row.result.payload.title, exactTarget: row.result.payload.zenTabId, split: row.result.payload.zenSplitView }));
  } finally {
    M.registerProvider(sidebar);
  }
  rows = await query("right pane");
  check("either split pane label matches the combined result", rows.some(row => row.result.payload.zenSplitView));
  return { checks, passed: checks.every(c => c.passed), placesRows: placesData };
})().then(done, error => done({ error: String(error), stack: error.stack }));
