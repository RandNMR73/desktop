const done=arguments[arguments.length-1];
(async()=>{
 if(!Services.dirsvc.get('ProfD',Ci.nsIFile).path.includes('zen-search-typed-'))throw Error('Disposable profile only');
 const {SearchService:S}=ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs');
 const {ZenUrlbarProviderSiteSearchHistory:Provider}=ChromeUtils.importESModule('resource:///modules/ZenUBSiteSearchHistoryProvider.sys.mjs');
 const {commandMatchingAvailable,matchCommandCandidateSignals}=ChromeUtils.importESModule('resource:///modules/zen/urlbar/ZenCommandMatching.sys.mjs');
 await S.init();const engines=await S.getEngines(),remote=engines.find(e=>e.supportsResponseType('application/x-suggestions+json'));if(!remote)throw Error('Remote engine fixture missing');
 const checks=[],check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
 const context={searchString:'lattice',isPrivate:false,searchMode:{engineName:remote.name}},p=new Provider();
 const keys=['browser.search.suggest.enabled','browser.urlbar.suggest.searches'];
 const old=keys.map(k=>({key:k,user:Services.prefs.prefHasUserValue(k),value:Services.prefs.getBoolPref(k)}));
 try {
  keys.forEach(k=>Services.prefs.setBoolPref(k,true));
  check('remote suggestions keep their built-in provider',!(await p.isActive(context)));
  Services.prefs.setBoolPref(keys[0],false);
  check('history still works when remote suggestions are disabled',await p.isActive(context));
  check('missing engines do not claim a typed query',!(await p.isActive({...context,searchMode:{engineName:'missing-fixture-engine'}})));
  check('native matching ABI is available',commandMatchingAvailable());
  const signals=matchCommandCandidateSignals('lattice',[{archetype:'chromiumSearchHistory',title:'lattice compiler',completionText:'lattice compiler'}]);
  check('native search completion uses the term',signals?.[0]?.completion==='lattice compiler');
  check('native matching returns title measurements',signals[0].features.titleMatchScore>0);
 }finally{for(const o of old)o.user?Services.prefs.setBoolPref(o.key,o.value):Services.prefs.clearUserPref(o.key);}
 done({pass:true,checks});
})().catch(e=>done({pass:false,error:String(e),stack:e.stack}));
