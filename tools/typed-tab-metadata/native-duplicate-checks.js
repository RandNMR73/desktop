const done = arguments[arguments.length - 1];
(async () => {
  if (!Services.dirsvc.get("ProfD", Ci.nsIFile).path.includes("zen-search-color-retention-")) throw Error("Disposable fixture required");
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  await w.gZenWorkspaces.promiseInitialized;
  const {SessionStore} = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/SessionStore.sys.mjs");
  const {ZenUrlbarProviderRecentTabs: Recent} = ChromeUtils.importESModule("resource:///modules/ZenUBSidebarProvider.sys.mjs");
  const {ProvidersManager} = ChromeUtils.importESModule("moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs");
  const {UrlbarShared:S} = ChromeUtils.importESModule("chrome://browser/content/urlbar/UrlbarShared.mjs");
  const active = w.gZenWorkspaces.activeWorkspace;
  const other = w.gZenWorkspaces.getWorkspaces().find(s=>s.uuid!==active).uuid;
  const made = [], url = "https://duplicatefixture.test/shared";
  for (const tab of w.gZenWorkspaces.allStoredTabs) {
    if (tab.linkedBrowser.currentURI.spec === url) w.gBrowser.removeTab(tab,{animate:false});
  }
  const add = (label, order, context=0, space=active) => {
    const tab = w.gBrowser.addTrustedTab("about:blank", {skipAnimation:true, skipLoad:true, userContextId:context});
    tab.setAttribute("zen-workspace-id",space);
    SessionStore.setTabState(tab,{entries:[{url,title:label}],index:1,userContextId:context,zenWorkspace:space,zenStaticLabel:label});
    tab.setAttribute("zen-static-label",label);
    Object.defineProperty(tab,"lastAccessed",{configurable:true,value:order});
    made.push(tab);
    return tab;
  };
  const old=add("Older duplicate",10), recent=add("Recent duplicate",20), container=add("Container duplicate",30,1), hidden=add("Hidden duplicate",40,0,other);
  const deadline=Date.now()+3000;
  while (made.some(t=>t.linkedBrowser.currentURI.spec!==url)) {
    if(Date.now()>deadline) throw Error("Pending tab restoration did not complete");
    await new Promise(resolve=>w.setTimeout(resolve,20));
  }
  const scope=Recent.typedScope(w), checks=[];
  const check=(name,passed)=>checks.push({name,passed:!!passed});
  check("duplicate URL chooses most recently used matching target",scope.byKey.get(Recent.tabKey(url,0,""))?.zenTabId===`id:${recent.id}`);
  check("same URL in another container keeps separate target",scope.byKey.get(Recent.tabKey(url,1,""))?.zenTabId===`id:${container.id}`);
  check("more recent duplicate in another Space is excluded",!scope.results.some(r=>r.payload.zenTabId===`id:${hidden.id}`));
  const manager=ProvidersManager.getInstanceForSap("urlbar"), sidebar=manager.getProvider("ZenUrlbarProviderSidebar");
  const query=async text=>{
    w.gURLBar.searchMode=null; w.gURLBar.value=text; w.gURLBar.focus();
    await w.gURLBar.startQuery({searchString:text});
    await new Promise(resolve=>w.setTimeout(resolve,300));
    return [...w.document.querySelectorAll(".urlbarView-row")].filter(row=>row.result&&!row.hasAttribute("stale"))
      .map(row=>({type:row.result.type,provider:row.result.providerName,payload:{title:row.result.payload.title,url:row.result.payload.url,zenTabId:row.result.payload.zenTabId,userContext:row.result.payload.userContext}}));
  };
  let native;
  manager.unregisterProvider(sidebar);
  try { native=await query("duplicatefixture"); } finally { manager.registerProvider(sidebar); }
  const tabs=native.filter(r=>r.type===S.RESULT_TYPE.TAB_SWITCH);
  check("native duplicate search retains two container-specific results",tabs.length===2);
  check("native targets use saved identity and labels",tabs.every(r=>r.payload.zenTabId===`id:${recent.id}`&&r.payload.title==="Recent duplicate"||r.payload.zenTabId===`id:${container.id}`&&r.payload.title==="Container duplicate"));
  const rename=await query("Older duplicate");
  check("a duplicate can still be found by its distinct saved name",rename.some(r=>r.payload.zenTabId===`id:${old.id}`));
  check("duplicate checks do not load pages",made.every(t=>t.hasAttribute("pending")));
  return {passed:checks.every(c=>c.passed),checks,native,rename};
})().then(done,error=>done({error:String(error),stack:error.stack}));
