const done=arguments[arguments.length-1];
(async()=>{
 if(!Services.dirsvc.get('ProfD',Ci.nsIFile).path.includes('zen-search-typed-'))throw Error('Fixture only');
 const {PlacesUtils:P}=ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
 const {SearchService:S}=ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs');
 const {ZenCommandSelectionHistory:H}=ChromeUtils.importESModule('resource:///modules/zen/urlbar/ZenCommandSelectionHistory.sys.mjs');
 await S.init();const e=S.getEngineByName('YouTube'),w=Services.wm.getMostRecentWindow('navigator:browser');
 await P.history.clear();await H.clear({allProfiles:true});
 const now=Date.now();
 for(const [term,ages]of [['lattice compiler',[1,.5]],['lattice models',[30,29]]]){
  await P.history.insert({url:e.getSubmission(term,null,'searchbar').uri.spec,title:term,visits:ages.map(age=>({date:new Date(now-age*86400000),transition:P.history.TRANSITIONS.LINK}))});
 }
 done({ready:true,query:'lattice',choice:'lattice models',history:await H.selectedResult('lattice')});
})().catch(e=>done({error:String(e),stack:e.stack}));
