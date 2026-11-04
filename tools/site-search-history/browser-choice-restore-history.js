const done=arguments[arguments.length-1];
(async()=>{
 if(!Services.dirsvc.get('ProfD',Ci.nsIFile).path.includes('zen-search-typed-'))throw Error('Fixture only');
 const {PlacesUtils:P}=ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
 const {SearchService:S}=ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs');
 const {ZenCommandSelectionHistory:H}=ChromeUtils.importESModule('resource:///modules/zen/urlbar/ZenCommandSelectionHistory.sys.mjs');
 const w=Services.wm.getMostRecentWindow('navigator:browser');w.gBrowser.selectedBrowser.stop();
 const e=S.getEngineByName('YouTube'),url=e.getSubmission('lattice models',null,'searchbar').uri.spec;
 await P.history.remove(url);
 await P.history.insert({url,title:'lattice models',visits:[30,29].map(age=>({date:new Date(Date.now()-age*86400000),transition:P.history.TRANSITIONS.LINK}))});
 done({restored:true,record:await H.selectedResult('lattice')});
})().catch(e=>done({error:String(e),stack:e.stack}));
