const done=arguments[arguments.length-1];
(async()=>{
 const w=Services.wm.getMostRecentWindow('navigator:browser');
 const {Downloads}=ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
 const {DownloadHistory}=ChromeUtils.importESModule('resource://gre/modules/DownloadHistory.sys.mjs');
 const {PlacesUtils}=ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
 const {ZenLibraryFileMenu}=ChromeUtils.importESModule('moz-src:///zen/library/ZenLibraryFileMenu.sys.mjs');
 const {libraryHiddenFiles}=ChromeUtils.importESModule('moz-src:///zen/library/ZenLibraryHiddenFiles.sys.mjs');
 const store=libraryHiddenFiles();await store.ready;
 const pause=ms=>new Promise(r=>w.setTimeout(r,ms));
 const until=async f=>{for(let i=0;i<100;i++){if(await f())return true;await pause(40)}return false};
 let checks=0;const failures=[];const check=(ok,msg)=>{checks++;if(!ok)failures.push(msg)};
 const event=win=>new win.MouseEvent('contextmenu',{screenX:150,screenY:300,button:2});
 const show=async(menu,win,x)=>{await menu.show(event(win),x);await until(()=>win.document.querySelector('.zen-library-download-menu')?.state==='open');return win.document.querySelector('.zen-library-download-menu')};
 const all=await Downloads.getList(Downloads.ALL);for(const prior of await all.getAll())if(prior.source.url.startsWith('https://example.invalid/owned-file-actions-')){await all.remove(prior);await prior.finalize(true)}
 const folder=PathUtils.join(PathUtils.profileDir,'owned-record-menu');await IOUtils.makeDirectory(folder);
 const create=async(isPrivate=false)=>{
  const path=PathUtils.join(folder,isPrivate?'private.txt':'public.txt');await IOUtils.writeUTF8(path,'owned fixture');
  const url='https://example.invalid/owned-file-actions-'+(isPrivate?'private':'public');
  const x=await Downloads.createDownload({source:{url,isPrivate},target:{path},startTime:new Date()});await x.refresh();x.stopped=true;x.succeeded=true;x.endTime=Date.now();x._setBytes(13,13,true);await x.refresh();
  const list=await Downloads.getList(isPrivate?Downloads.PRIVATE:Downloads.PUBLIC);await list.add(x);
  return {x,list,url,path};
 };
 let owner=new ZenLibraryFileMenu(w);let activeCanceled=0,partialRemoved=0;
 const active={stopped:false,target:{path:PathUtils.join(folder,'active')},cancel:async()=>activeCanceled++,removePartialData:async()=>partialRemoved++};
 let popup=await show(owner,w,active);
 check(popup?.childElementCount===1&&popup.firstChild.label==='Cancel Download','active menu contains only Cancel Download');
 popup.firstChild.doCommand();popup.hidePopup();await until(()=>partialRemoved===1);
 check(activeCanceled===1&&partialRemoved===1,'Cancel removes the partial download once');
 await owner.show(event(w),{stopped:true,succeeded:false,canceled:true,target:{path:active.target.path}});
 check(!w.document.querySelector('.zen-library-download-menu'),'paused/failed state has no invented menu items');
 const p=await create();
 await PlacesUtils.history.insert({url:p.url,visits:[{transition:PlacesUtils.history.TRANSITIONS.LINK},{transition:PlacesUtils.history.TRANSITIONS.DOWNLOAD}]});
 await DownloadHistory.addDownloadToHistory(p.x);await DownloadHistory.updateMetaData(p.x);
 popup=await show(owner,w,p.x);check(!!popup,'completed browser record menu opens');
 popup.querySelector('[data-action="hide"]').doCommand();popup.hidePopup();
 const removed=await until(async()=>!(await p.list.getAll()).includes(p.x));
 check(removed,'Hide removes live browser download record');
 check(await IOUtils.exists(p.path),'Hide keeps completed file');
 check(store.hasDownload(p.path)&&!store.has(p.path),'hidden browser record only suppresses hover disk fallback');
 const history=await PlacesUtils.history.fetch(p.url,{includeVisits:true});
 check(history?.visits.some(v=>v.transition===PlacesUtils.history.TRANSITIONS.LINK),'Hide preserves ordinary visits to the same URL');
 check(!history?.visits.some(v=>v.transition===PlacesUtils.history.TRANSITIONS.DOWNLOAD),'Hide removes only download visits');
 const historyList=await DownloadHistory.getList({type:Downloads.PUBLIC});
 check(!(await historyList.getAll()).some(x=>x.source.url===p.url),'persisted download history no longer exposes hidden record');
 owner.destroy();
 const saved=await IOUtils.readJSON(store.path);
 let privateWindow=w.OpenBrowserWindow({private:true});
 await until(()=>privateWindow.gBrowserInit?.delayedStartupFinished);
 const q=await create(true);owner=new ZenLibraryFileMenu(privateWindow);
 try{
  popup=await show(owner,privateWindow,q.x);check(!!popup,'private download menu opens');
  popup.querySelector('[data-action="hide"]').doCommand();popup.hidePopup();
  check(await until(async()=>!(await q.list.getAll()).includes(q.x)),'private Hide removes private download record');
  check(JSON.stringify(await IOUtils.readJSON(store.path))===JSON.stringify(saved),'private Hide writes no persistent path');
  check(await IOUtils.exists(q.path),'private Hide preserves file');
 }finally{owner.destroy();privateWindow.close()}
 return{checks,failures,production_profile_used:false,sharingInvoked:false};
})().then(done,e=>done({error:String(e),stack:e.stack}));
