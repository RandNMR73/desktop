const done = arguments[arguments.length - 1];
(async () => {
 const w=Services.wm.getMostRecentWindow('navigator:browser'),d=w.document;
 const button=d.getElementById('zen-library-button'),list=d.getElementById('zen-library-download-list'),foot=d.getElementById('zen-sidebar-foot-buttons');
 const wait=ms=>new Promise(r=>w.setTimeout(r,ms));
 const until=async test=>{for(let i=0;i<100;i++){if(test())return true;await wait(40)}return false};
 const enter=()=>{const r=button.getBoundingClientRect();button.dispatchEvent(new w.MouseEvent('mouseenter',{clientX:r.x+r.width/2,clientY:r.y+r.height/2}))};
 const leave=()=>button.dispatchEvent(new w.MouseEvent('mouseleave',{clientX:600,clientY:400}));
 let checks=0;const failures=[],menus=[];
 const check=(ok,msg)=>{checks++;if(!ok)failures.push(msg)};
 const visible=()=>[...list.children].filter(n=>!n.hidden);
 const openMenu=async row=>{const r=row.getBoundingClientRect();row.dispatchEvent(new w.MouseEvent('contextmenu',{bubbles:true,button:2,screenX:w.mozInnerScreenX+r.x+60,screenY:w.mozInnerScreenY+r.y+20}));await until(()=>d.querySelector('.zen-library-download-menu')?.state==='open');return d.querySelector('.zen-library-download-menu')};
 const order=['copy','separator','message','airdrop','separator','open','show','separator','hide','trash'];
 for(const space of w.gZenWorkspaces.getWorkspaces()){
  await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid);enter();await until(()=>foot.hasAttribute('zen-library-stack-open'));await wait(500);
  const menu=await openMenu(visible().at(-1));check(!!menu,space.name+': menu opens');
  if(!menu)continue;
  check(JSON.stringify([...menu.children].map(n=>n.dataset.action||'separator'))===JSON.stringify(order),space.name+': exact menu ordering');
  const labels=[...menu.querySelectorAll('menuitem')].map(n=>n.label);
  check(labels.every(Boolean),space.name+': every action localized');
  check(labels.includes('Send via iMessage')&&labels.includes('AirDrop')&&labels.includes('Show in Finder')&&labels.includes('Move to Trash'),space.name+': native action titles');
  check(labels.some(s=>s.startsWith('Open in ')),space.name+': resolved default application');
  leave();await wait(550);check(foot.hasAttribute('zen-library-stack-open'),space.name+': menu holds flyout');
  menus.push({space:space.name,labels});menu.hidePopup();await wait(180);check(!foot.hasAttribute('zen-library-stack-open'),space.name+': dismissal releases flyout');
 }
 await w.gZenWorkspaces.changeWorkspaceWithID(w.gZenWorkspaces.getWorkspaces()[0].uuid);
 const {libraryHiddenFiles,LibraryHiddenFiles}=ChromeUtils.importESModule('moz-src:///zen/library/ZenLibraryHiddenFiles.sys.mjs');
 const store=libraryHiddenFiles();await store.ready;
 const folder=PathUtils.join(PathUtils.profileDir,'owned-file-menu');await IOUtils.makeDirectory(folder);
 const prior=Services.prefs.getStringPref('browser.download.dir');
 for(let i=0;i<6;i++)await IOUtils.writeUTF8(PathUtils.join(folder,`owned-${i}.txt`),`owned file ${i}`);
 Services.prefs.setStringPref('browser.download.dir',folder);
 enter();await until(()=>visible().length===4&&visible().every(row=>row.download.target.path.startsWith(folder)));await wait(350);
 const target=visible().at(-1).download.target.path;
 const menu=await openMenu(visible().at(-1));
 check(!!menu,'owned file menu opens');
 if(menu){menu.querySelector('[data-action="hide"]').doCommand();menu.hidePopup();await until(()=>store.has(target));
  check(store.has(target),'Hide persists ordinary file exclusion');
  check(await IOUtils.exists(target),'Hide leaves file on disk');
  enter();await until(()=>visible().length===4&&visible().every(row=>row.download.target.path!==target));
  check(visible().length===4&&!visible().some(row=>row.download.target.path===target),'Hide backfills fourth entry');
  const saved=await IOUtils.readJSON(store.path);const reloaded=new LibraryHiddenFiles({path:store.path,read:async()=>saved,write:async()=>{},notify:()=>{}});await reloaded.ready;
  check(reloaded.has(target),'hidden path reloads from disk');
 }
 // The native directory scan excludes paths before truncating to four.
 const {ZenDownloadPreview}=ChromeUtils.importESModule('moz-src:///zen/library/ZenDownloadPreview.sys.mjs');
 const api=new ZenDownloadPreview(w);const files=await api.files(folder,store.path);
 check(files.length===4&&!files.some(f=>f.target.path===target),'native scan backfills after exclusion');
 const info=await api.fileInfo(files[0]);check(info?.kind==='file'&&info?.exists,'native file metadata');api.destroy();
 leave();Services.prefs.setStringPref('browser.download.dir',prior);enter();await until(()=>visible().every(row=>!row.download.target.path.startsWith(folder)));leave();
 return {checks,failures,menus,production_profile_used:false,sharingInvoked:false};
})().then(done,e=>done({error:String(e),stack:e.stack}));
