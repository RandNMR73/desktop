/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
const done = arguments[arguments.length - 1];
(async () => {
  if (!Services.dirsvc.get("ProfD", Ci.nsIFile).path.includes("zen-search-recents-"))
    throw new Error("Requires the disposable recent-search profile");
  const { PlacesUtils: P } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const { SearchService: S } = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs");
  const { recentSiteSearches, siteSearchHistoryPrefix } = ChromeUtils.importESModule("resource:///modules/zen/urlbar/ZenSiteSearchHistory.sys.mjs");
  await S.init();
  const engine = S.getEngineByName("YouTube"), other = S.getEngineByName("Amazon");
  if (!engine || !other) throw new Error("Fixture engines have not loaded");
  const db = await P.promiseDBConnection(), now = Date.now(), day = 86400000, checks = [];
  const check = (name, passed, detail) => { checks.push({name,passed,...(passed?{}:{detail})}); if (!passed) throw new Error(name+": "+JSON.stringify(detail)); };
  const { ZenUrlbarProviderSiteSearchHistory } = ChromeUtils.importESModule("resource:///modules/ZenUBSiteSearchHistoryProvider.sys.mjs");
  const provider = new ZenUrlbarProviderSiteSearchHistory();
  const context = {isPrivate:false,searchString:"",searchMode:{engineName:engine.name}};
  check("provider enables empty explicit scopes",await provider.isActive(context));
  for (const [name,extra] of [["private history",{isPrivate:true}],["typed query",{searchString:"gpu"}],
    ["preview scope",{searchMode:{engineName:engine.name,isPreview:true}}],["ordinary command bar",{searchMode:null}]])
    check("provider excludes "+name,!(await provider.isActive({...context,...extra})));
  await P.history.clear();
  const searchURL = (terms, e=engine) => e.getSubmission(terms,null,"searchbar").uri.spec;
  async function visit(terms, age, {e=engine, transition=P.history.TRANSITIONS.LINK, suffix="", title=terms}={}) {
    await P.history.insert({ url: searchURL(terms,e)+suffix, title,
      visits: [{date:new Date(now-age*day),transition}] });
  }
  await visit("Old query",15);
  await visit("GPU mode",4);
  await visit("Hot interconnects",2);
  await visit("GPU mode",1,{suffix:"&fixture=variant"});
  await visit("NCCL and NVLink",.5);
  await visit("Other site's query",.1,{e:other});
  await visit("Download only",.2,{transition:P.history.TRANSITIONS.DOWNLOAD});
  await visit("Frame only",.2,{transition:P.history.TRANSITIONS.FRAMED_LINK});
  await visit("",.2);
  const recent=options=>recentSiteSearches(db,engine,url=>S.parseSubmissionURL(url),{now,...options});
  const rows=await recent();
  check("site history uses recent visible searches, distinct queries and visit order",
    JSON.stringify(rows.map(r=>r.query))===JSON.stringify(["NCCL and NVLink","GPU mode","Hot interconnects"]),rows);
  check("limit applies after duplicate queries",(await recent({limit:2})).length===2);
  check("cancelled read emits no history",(await recent({current:()=>false})).length===0);
  check("non-web and POST engines have no history prefix",siteSearchHistoryPrefix({getSubmission:()=>({uri:{spec:"file:///tmp/search"}})})===null &&
    siteSearchHistoryPrefix({getSubmission:()=>({uri:{spec:searchURL("zen_scope_history_probe")},postData:{}})})===null);
  await P.history.remove(searchURL("NCCL and NVLink"));
  check("history removal immediately removes the recent",(await recent())[0]?.query==="GPU mode");
  await P.history.clear();
  check("clear history removes all scoped recents",(await recent()).length===0);
  const reordered = searchURL("Reordered query").replace("?search_query=", "?fixture=first&search_query=");
  await P.history.insert({url:reordered,title:"Reordered query",visits:[{date:new Date(now-day),transition:P.history.TRANSITIONS.LINK}]});
  check("search URL parameter order does not hide a recent query",(await recent())[0]?.query==="Reordered query");
  await P.history.clear();
  // Leave safe, known rows for the visual and input test.
  await visit("NCCL, NVLink, InfiniBand, RDMA, GPUDirect RDMA, or large-scale communication optimization.",.5);
  await visit("gpu mode",1);
  await visit("hot interconnects",2);
  done({passed:true,checks,engine:engine.name});
})().catch(error=>done({passed:false,error:String(error),stack:error.stack}));
