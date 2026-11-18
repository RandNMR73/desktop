/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
const done=arguments[arguments.length-1];
(async()=>{
  const [expected]=arguments,w=Services.wm.getMostRecentWindow('navigator:browser'),bar=w.gURLBar;
  const check=(condition,message)=>{if(!condition)throw Error(message);};
  check(Services.dirsvc.get('XREExeF',Ci.nsIFile).path===expected.executable &&
    Services.dirsvc.get('ProfD',Ci.nsIFile).path===expected.profile &&
    Services.appinfo.processID===expected.pid &&
    Cc['@mozilla.org/gfx/info;1'].getService(Ci.nsIGfxInfo).isHeadless,'owned headless runtime');
  const uri='resource:///modules/zen/urlbar/ZenSiteSearchHistory.sys.mjs';
  const resource=Services.io.getProtocolHandler('resource').QueryInterface(Ci.nsIResProtocolHandler);
  const archive=Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);archive.initWithPath(expected.archive);
  check(resource.resolveURI(Services.io.newURI(uri))==='jar:'+Services.io.newFileURI(archive).spec+'!/modules/zen/urlbar/ZenSiteSearchHistory.sys.mjs','owned packaged module resolution');
  const bytes=new Uint8Array(await(await w.fetch(uri)).arrayBuffer());
  const hash=Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash);hash.init(Ci.nsICryptoHash.SHA256);hash.update(bytes,bytes.length);
  const sourceSHA256=Array.from(hash.finish(false),c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('');
  check(sourceSHA256===expected.moduleSHA256,'packaged source hash');
  const {typedSiteSearches:read}=ChromeUtils.importESModule(uri);
  check(String(read)===expected.functionSource,'actual imported function source');
  const {PlacesUtils:P}=ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
  const {SearchService:S}=ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs');
  const {ZenUrlbarProviderSiteSearchHistory:Provider,clearCommandPrefixSession}=ChromeUtils.importESModule('resource:///modules/ZenUBSiteSearchHistoryProvider.sys.mjs');
  await S.init();const engine=S.getEngineByName('Bing');check(engine,'fixture engine');
  const report={passed:false,runtime:{headless:true,sourceSHA256,loadedFunctionMatchesSource:true,moduleOrMethodInjection:false},model:[],locale:[],pipeline:[]};
  const mockEngine={id:'owned-engine',getSubmission:()=>({uri:{spec:'https://owned.invalid/?q=zen_scope_history_probe'}})};
  const terms=['Lattice','lattice model',' LATtICE\t tool ','I','İ','ı','i','é','e\u0301','ΣΟΣ','中文','\u0085lattice','\ufefflattice','',null];
  const queries=['l','LATTICE','I','é','e\u0301','中文','\u0085','','   ','absent'];
  const dates=[0,300000,300001,600001,NaN,Infinity,1000000];
  for(let scenario=0;scenario<8;scenario++){
    const rows=Array.from({length:32},(_,i)=>Object.freeze({url:'https://owned.invalid/'+i,date:dates[(i+scenario)%dates.length]*1000,visitCount:[0,1,2,-1,NaN,9007199254740992][(i+scenario)%6]}));
    const parsed=rows.map((_,i)=>i%13===0?null:i%11===0?{}:{engine:{id:i%7===0?'other':'owned-engine'},terms:scenario===7&&i===5?42:terms[(i+scenario)%terms.length]});
    const before=JSON.stringify({rows,parsed});
    for(const locale of ['en','tr','ja','invalid_locale'])for(const query of queries)for(const budget of [0,3,Infinity]){
      let currentCalls=0,sqlCalls=0;
      const db={async executeCached(sql,params,callback){sqlCalls++;
        check(sql.includes('SELECT p.url, p.last_visit_date AS date, p.visit_count AS visitCount'),'fixed SQL projection');
        let cancelled=false;
        for(const row of rows){if(cancelled)break;callback({getResultByName:key=>row[key],getResultByIndex:index=>{
          check(Number.isInteger(index)&&index>=0&&index<3,'projected field index');return row[['url','date','visitCount'][index]];
        }},()=>{cancelled=true;});}
      }};
      let result;try{result={rows:await read(db,mockEngine,url=>parsed[Number(url.split('/').at(-1))],query,{now:2000000,limit:15,locale,current:()=>++currentCalls<=budget})};}
      catch(error){result={error:{name:error.name,message:error.message}};}
      report.model.push({scenario,locale,query,budget:Number.isFinite(budget)?budget:'unlimited',currentCalls,sqlCalls,result});
    }
    check(JSON.stringify({rows,parsed})===before,'frozen model input unchanged');
  }
  for(const [name,terms,dates] of [
    ['duplicate-300000',['Lattice','LATTICE'],[0,300000]],
    ['duplicate-300001',['Lattice','LATTICE'],[0,300001]],
    ['duplicate-chain',['Lattice','LATTICE','lattice'],[0,300000,300001]],
    ['tied-date-distinct-keys',['lattice z','lattice a','lattice b'],[300001,300001,300001]],
    ['same-key-tied-date',['Lattice','LATTICE'],[300001,300001]],
  ]){
    const db={async executeCached(sql,params,callback){for(let i=0;i<terms.length;i++){
      const values=['https://owned.invalid/'+i,dates[i]*1000,2**(i+1)];callback({getResultByName:key=>values[['url','date','visitCount'].indexOf(key)],getResultByIndex:index=>values[index]},()=>{});
    }}};
    report.model.push({name,rows:await read(db,mockEngine,url=>({engine:mockEngine,terms:terms[Number(url.split('/').at(-1))]}),'lattice',{now:1000000,locale:'en',limit:15})});
  }
  const db=await P.promiseDBConnection(),now=expected.fixtureNow;
  await P.history.clear();
  const search=term=>engine.getSubmission(term,null,'searchbar').uri.spec;
  const insert=(term,index)=>P.history.insert({url:search(term),title:term,visits:[{date:new Date(now-86400000-index*1000),transition:1},{date:new Date(now-43200000-index*1000),transition:1}]});
  for(const [index,term]of ['lattice compiler','lattice models','lattice tools','LATTICE variants','I scope','İ scope','ı scope','é search','e\u0301 search','中文搜索'].entries())await insert(term,index);
  await P.history.insert({url:search('lattice reordered').replace('?','?owned=first&'),title:'lattice reordered',visits:[{date:new Date(now-50000),transition:1}]});
  await P.history.insert({url:'https://unrelated.owned.invalid/saved',title:'unrelated owned page',visits:[{date:new Date(now-50000),transition:1}]});
  const parse=url=>S.parseSubmissionURL(url);
  for(const locale of ['en','tr','ja'])for(const query of ['lattice','I','é','e\u0301','中文','','missing'])report.locale.push({locale,query,rows:await read(db,engine,parse,query,{now,locale,limit:15})});
  check((await read({executeCached:()=>{throw Error('cancelled query read SQLite');}},engine,parse,'lattice',{current:()=>false})).length===0,'cancelled current guard');
  check(!(await new Provider().isActive({isPrivate:true,searchString:'lattice',searchMode:{engineName:engine.name}})),'private provider guard');
  Services.prefs.setStringPref('zen.urlbar.site-search.menu','[]');
  Services.prefs.setBoolPref('zen.urlbar.site-search.typed-history',true);
  Services.prefs.setBoolPref('browser.urlbar.suggest.history',true);
  function close(){bar.handleRevert();bar.view.close();bar.searchMode=null;clearCommandPrefixSession(w);}
  function snapshot(){return {query:bar.view.queryContext?.searchString,values:bar.view.visibleResults.map(r=>({provider:r.providerName,type:r.type,source:r.source,heuristic:r.heuristic,payload:r.payload,autofill:r.autofill??null,suggestedIndex:r.suggestedIndex})),selection:{value:bar.value,start:bar.selectionStart,end:bar.selectionEnd,index:bar.view.selectedRowIndex}};}
  async function query(text,reset=true){
    if(reset)close();bar.focus();bar.searchMode={engineName:engine.name,entry:'shortcut',isPreview:false};bar.setValue(text);
    await new Promise((resolve,reject)=>{
      const timer=w.setTimeout(()=>{bar.controller.removeListener(listener);reject(Error('query timeout'));},15000);
      const listener={onQueryFinished(context){if(context.searchString!==text)return;w.clearTimeout(timer);bar.controller.removeListener(listener);resolve();}};
      bar.controller.addListener(listener);bar.startQuery({searchString:text,allowAutofill:true});
    });await new Promise(resolve=>w.setTimeout(resolve,0));return snapshot();
  }
  try{
    for(const text of ['lattice','lattice missing','I','é','中文',''])report.pipeline.push({phase:'ordinary',text,state:await query(text)});
    bar.setValue('lat');bar.startQuery({searchString:'lat',allowAutofill:true});
    const old=bar.lastQueryContextPromise;
    const latest=await query('lattice missing',false);await old;
    check(latest.query==='lattice missing'&&latest.values.every(r=>r.payload.suggestion==='lattice missing'),'superseded query cannot append stale results');
    report.pipeline.push({phase:'superseded',state:latest});
    await P.history.remove(search('lattice compiler'));
    const removed=await read(db,engine,parse,'lattice',{now,locale:'en',limit:15});
    check(!removed.some(row=>row.query==='lattice compiler'),'history deletion immediately reflected');
    report.deletedRows=removed;report.pipeline.push({phase:'after-delete',state:await query('lattice')});
  }finally{close();}
  report.passed=true;done(report);
})().catch(error=>done({passed:false,error:String(error),stack:error.stack}));
