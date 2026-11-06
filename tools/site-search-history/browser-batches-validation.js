const done=arguments[arguments.length-1];
const checks=[],states=[];
(async()=>{
 if(!PathUtils.filename(Services.dirsvc.get('ProfD',Ci.nsIFile).path).startsWith('zen-search-typed-'))throw Error('fixture required');
 const {PlacesUtils:P}=ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
 const {SearchService:S}=ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs');
 const w=Services.wm.getMostRecentWindow('navigator:browser'),b=w.gURLBar;
 await S.init();
 const check=(name,pass,actual)=>{checks.push({name,pass,actual});if(!pass)throw Error(name);};
 async function run(text,engine){
  b.focus();b.searchMode=engine?{engineName:engine,entry:'tabtosearch',isPreview:false}:null;
  b.setValue(text);b.startQuery({searchString:text,allowAutofill:true});await b.lastQueryContextPromise;
  return b.view.visibleResults.filter(r=>r.providerName==='ZenUrlbarProviderSiteSearchHistory').map(r=>r.payload.suggestion);
 }
 function close(){b.handleRevert();b.view.close();b.searchMode=null;}
 for(const name of ['YouTube','Amazon','Google','Reddit','X','ChatGPT']){
  close();await P.history.clear();
  const engine=S.getEngineByName(name),host=new URL(engine.getSubmission('fixture',null,'searchbar').uri.spec).hostname;
  const now=Date.now(),day=86400000;
  const add=(url,title,ages,typed=false)=>P.history.insert({url,title,visits:ages.map(age=>({date:new Date(now-age*day),transition:typed?2:1}))});
  for(const [term,ages]of [['lattice model',[.1,.2]],['lattice graph',[10,11]],['lattice tools',[14,15]]])
   await add(engine.getSubmission(term,null,'searchbar').uri.spec,term,ages);
  for(let i=0;i<4;i++)await add('https://filler.test/page-'+i,host+' lattice',[.3,.4,.5,.6,.7]);
  const prefixes=Array.from({length:3},(_,i)=>'https://'+host+'/prefix-only-'+i);
  for(const [i,url]of prefixes.entries())await add(url,'Prefix only',Array.from({length:30-i*3},(_,j)=>1+j*.1),true);
  const direct=await run('lattice',name);
  check(name+' direct final order',JSON.stringify(direct)===JSON.stringify(['lattice model','lattice graph','lattice tools','lattice']),direct);
  close();await run(host,null);await run('',name);
  const whole=await run('lattice',name);
  states.push({name,direct,whole});
  check(name+' alias transition preserves first batch order',JSON.stringify(whole)===JSON.stringify(['lattice model','lattice','lattice graph','lattice tools']),whole);
  close();await run(host,null);await run('',name);await run('','Bing');await run('',name);
  check(name+' changing engines clears alias state',JSON.stringify(await run('lattice',name))===JSON.stringify(direct));
  await run('',name);
  check(name+' clear and retype uses current provider state',JSON.stringify(await run('lattice',name))===JSON.stringify(direct));
  close();await run(host,null);await run('',name);await run('l',name);
  check(name+' incremental query does not retain obsolete alias matches',JSON.stringify(await run('lattice',name))===JSON.stringify(direct));
  close();await run(host,null);await run('',name);close();
  check(name+' closing clears alias state',JSON.stringify(await run('lattice',name))===JSON.stringify(direct));
  close();await run(host,null);await run('',name);
  const older=run('la',name),latest=run('lattice missing',name);
  await Promise.all([older,latest]);
  check(name+' cancelled query cannot append stale history',JSON.stringify(b.view.visibleResults.map(r=>r.payload.suggestion))===JSON.stringify(['lattice missing']));
  close();await run(host,null);await run('',name);
  const history=Services.prefs.getBoolPref('browser.urlbar.suggest.history');
  try{Services.prefs.setBoolPref('browser.urlbar.suggest.history',false);await run('lattice',name);}
  finally{Services.prefs.setBoolPref('browser.urlbar.suggest.history',history);}
  await run('',name);
  check(name+' disabling history clears alias state',JSON.stringify(await run('lattice',name))===JSON.stringify(direct));
  close();await run(host,null);await run('',name);
  await P.history.remove(prefixes);
  check(name+' history deletion clears predecessor state',JSON.stringify(await run('lattice',name))===JSON.stringify(direct));
 }
 close();
 done({pass:true,checks,states});
})().catch(error=>done({pass:false,error:String(error),stack:error.stack,checks,states}));
