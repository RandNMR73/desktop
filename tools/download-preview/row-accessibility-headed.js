const done=arguments[arguments.length-1];
(async()=>{
 const profile=Services.dirsvc.get('ProfD',Ci.nsIFile).path;if(!profile.includes('zen-region-colors-native-'))throw Error('Owned disposable profile required');
 const w=Services.wm.getMostRecentWindow('navigator:browser'),d=w.document;
 const service=Cc['@mozilla.org/accessibilityService;1'].getService(Ci.nsIAccessibilityService);
 const pause=ms=>new Promise(r=>w.setTimeout(r,ms));
 const until=async predicate=>{for(let i=0;i<120&&!predicate();i++)await pause(25);return !!predicate();};
 const rows=()=>[...d.querySelectorAll('#zen-library-download-list > div')].filter(n=>!n.hidden);
 const button=d.getElementById('zen-library-button'),foot=d.getElementById('zen-sidebar-foot-buttons');
 const enter=()=>{const r=button.getBoundingClientRect();button.dispatchEvent(new w.MouseEvent('mouseenter',{clientX:r.x+16,clientY:r.y+16}));};
 const leave=()=>button.dispatchEvent(new w.MouseEvent('mouseleave',{clientX:600,clientY:400}));
 const normalize=s=>s.replace(/[\u2068\u2069]/g,'');
 const hit=row=>row.querySelector('.zen-library-download-hit-target');
 const acc=row=>service.getAccessibleFor(hit(row));
 const failures=[],spaces=[],names=[];let checks=0;
 const check=(value,label)=>{checks++;if(!value)failures.push(label);};
 const ready=async()=>{enter();await until(()=>foot.hasAttribute('zen-library-stack-open'));await pause(650);await d.l10n.translateFragment(d.getElementById('zen-library-download-list'));await until(()=>rows().every(row=>acc(row)?.name));};
 for(const space of w.gZenWorkspaces.getWorkspaces()){
  await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid);await ready();
  check(rows().length===4,space.name+': four visible rows');
  for(const row of rows()){
   const accessible=acc(row),name=PathUtils.filename(row.download.target.path);
   check(accessible?.role===Ci.nsIAccessibleRole.ROLE_PUSHBUTTON,space.name+': row is a button');
   check(normalize(accessible?.name||'')==='Download — '+name,space.name+': native download label');
   check(accessible?.actionCount===1,space.name+': one primary accessible action');
   check(!service.getAccessibleFor(row.querySelector('.zen-library-download-list-title')),space.name+': no duplicate decorative title');
   check(!service.getAccessibleFor(row.querySelector('.zen-library-download-badge')),space.name+': no unnamed decorative image');
  }
  const active=rows().find(row=>!row.download.stopped),item=active?.download;
  check(!!active,space.name+': active owned fixture exists');
  if(active){
   const previous=item.launchWhenSucceeded;acc(active).doAction(0);await until(()=>item.launchWhenSucceeded!==previous);
   check(item.launchWhenSucceeded!==previous,space.name+': accessible action reaches primary row handler');
   acc(active).doAction(0);await until(()=>item.launchWhenSucceeded===previous);
   check(item.launchWhenSucceeded===previous,space.name+': second activation restores fixture');
  }
  const completed=rows().find(row=>row.download.succeeded);InspectorUtils.addPseudoClassLock(completed,':hover');
  await pause(40);
  const accessory=service.getAccessibleFor(completed.querySelector('.zen-library-download-action'));
  check(accessory?.role===Ci.nsIAccessibleRole.ROLE_PUSHBUTTON&&accessory.name==='Show in Finder',space.name+': Finder remains a separately named button');
  InspectorUtils.removePseudoClassLock(completed,':hover');
  spaces.push({space:space.name,names:rows().map(row=>normalize(acc(row)?.name||''))});
  leave();await pause(100);
  check(rows().every(row=>!acc(row)),space.name+': closed preview is absent from accessibility tree');
 }
 const oldDirectory=Services.prefs.getStringPref('browser.download.dir');
 const folder=PathUtils.join(profile,'owned-a11y-downloads'),file=PathUtils.join(folder,'Owned disk preview.png');
 const {libraryCaptures}=ChromeUtils.importESModule('moz-src:///zen/library/ZenLibraryCaptures.sys.mjs');
 const store=libraryCaptures();await store.ready;let capture;
 try{
  await IOUtils.makeDirectory(folder);await IOUtils.copy('/Users/matthewnoto/Temp/zen-arc-validation/download-media-preview-2026-10-31/fixtures/Preview fixture.png',file);
  Services.prefs.setStringPref('browser.download.dir',folder);await ready();
  // NSURL resolves macOS /var to /private/var in native source records.
  const isOwnedDisk=row=>row.download._zenDiskFile&&row.download.target.path.endsWith('/owned-a11y-downloads/Owned disk preview.png');
  check(await until(()=>rows().some(isOwnedDisk)),'real native disk source appears');
  const disk=rows().find(isOwnedDisk);
  if(disk){await d.l10n.translateFragment(disk);await until(()=>acc(disk)?.name);const name=normalize(acc(disk)?.name||'');names.push(name);check(name==='File — Owned disk preview.png','disk file gets native source label');}
  capture=await store.save({id:Services.uuid.generateUUID().toString().slice(1,-1),url:'https://example.invalid/owned-a11y',text:'Owned capture',createdDate:Date.now()+1000,captureType:'partialPage',captureLayoutInfo:{webContentSize:{width:400,height:280},webContentOffset:{x:0,y:0},frameRelativeToViewport:{x:0,y:0,width:400,height:280}}},await IOUtils.read(file));
  check(await until(()=>rows().some(row=>row.download._zenLibraryCapture?.id===capture.id)),'real capture store entry appears');
  const captured=rows().find(row=>row.download._zenLibraryCapture?.id===capture.id);
  if(captured){await d.l10n.translateFragment(captured);await until(()=>acc(captured)?.name);const name=normalize(acc(captured)?.name||'');names.push(name);check(name==='Capture — Owned capture','capture gets native source label');}
 }finally{
  if(capture)await store.remove(capture.id,capture);
  Services.prefs.setStringPref('browser.download.dir',oldDirectory);leave();
 }
 return{checks,failures,spaces,names,production_profile_used:false,scope:'Actual Gecko accessible roles, names, actions and hiding; no native Arc keyboard parity claim'};
})().then(done,e=>done({error:String(e),stack:e.stack}));
