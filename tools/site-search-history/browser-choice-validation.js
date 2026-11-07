const done=arguments[arguments.length-1];
(async()=>{
 if(!Services.dirsvc.get('ProfD',Ci.nsIFile).path.includes('zen-search-typed-'))throw Error('Fixture only');
 const {PlacesUtils:P}=ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
 const {CommandSelectionHistory,ZenCommandSelectionHistory:H}=ChromeUtils.importESModule('resource:///modules/zen/urlbar/ZenCommandSelectionHistory.sys.mjs');
 const w=Services.wm.getMostRecentWindow('navigator:browser'),b=w.gURLBar,checks=[];
 const check=(name,pass,actual)=>{checks.push({name,pass:!!pass,actual});if(!pass)throw Error(name);};
 const query=async text=>{
  b.focus();b.searchMode={engineName:'YouTube',entry:'shortcut',isPreview:false};b.setValue(text);
  await new Promise((resolve,reject)=>{
   const timer=w.setTimeout(()=>{b.controller.removeListener(listener);reject(Error('query timeout'));},5000);
   const listener={onQueryFinished(context){if(context.searchString!==text||context.searchMode?.engineName!=='YouTube')return;w.clearTimeout(timer);b.controller.removeListener(listener);resolve();}};
   b.controller.addListener(listener);b.startQuery({searchString:text,allowAutofill:true});
  });
  return b.view.visibleResults.map(r=>r.payload.suggestion);
 };
 const choice=await H.selectedResult('lattice');
 check('keyboard commit captured original query and native search identity',choice?.query==='lattice'&&choice.identity.kind===0&&choice.identity.value==='lattice models',choice);
 check('next keyboard query promotes choice after visit dates were restored',b.view.visibleResults[0].payload.suggestion==='lattice models');
 check('completion selects the remembered suffix',b.value==='lattice models'&&b.selectionStart===7&&b.selectionEnd===14);
 const disk=await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir,'zen-command-selections.json'));
 check('actual committed choice persists in profile JSON',disk.profiles.find(p=>p.id==='Default')?.entries.some(e=>e.query==='lattice'&&e.identity.value==='lattice models'));
 const restored=new CommandSelectionHistory();
 check('a new store restores the chosen result',(await restored.selectedResult('lattice'))?.identity.value==='lattice models');
 check('another profile does not inherit the choice',await H.selectedResult('lattice',{profileID:'container:999'})===null);
 check('private lookup has no learned choice',await H.selectedResult('lattice',{isPrivate:true})===null);
 const upper=await query('Lattice');
 check('query case is exact, independently of search identity case',upper[0]==='lattice compiler',upper);
 await H.record({query:'lattice',identity:choice.identity,selectedAt:Date.now()-86400001});
 const expired=await query('lattice');
 check('expired choice no longer promotes in the actual urlbar',expired[0]==='lattice compiler',expired);
 await H.record({query:'lattice',identity:choice.identity});
 const renewed=await query('lattice');
 check('fresh choice promotes again without modifying visits',renewed[0]==='lattice models',renewed);
 await P.history.clear();
 for(let i=0;i<100&&await H.selectedResult('lattice')!==null;i++)await new Promise(r=>w.setTimeout(r,20));
 check('clearing browser history clears learned choices',await H.selectedResult('lattice')===null);
 let cleared;
 for(let i=0;i<150;i++){
  cleared=await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir,'zen-command-selections.json'));
  if(!cleared.profiles.length)break;await new Promise(r=>w.setTimeout(r,20));
 }
 check('history clearing is persisted',cleared.profiles.length===0);
 b.view.close();b.handleRevert();
 done({passed:true,checks,normalProfileUsed:false});
})().catch(e=>done({passed:false,error:String(e),stack:e.stack}));
