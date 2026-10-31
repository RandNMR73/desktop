const done=arguments[arguments.length-1];
const fixtures=arguments[0];
(async()=>{
 const w=Services.wm.getMostRecentWindow('navigator:browser'),d=w.document;
 const {Downloads}=ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
 const {nativeMediaPreview}=ChromeUtils.importESModule('moz-src:///zen/library/ZenNativeMediaPreview.sys.mjs');
 const preview=nativeMediaPreview(w),downloadList=await Downloads.getList(Downloads.ALL);
 const pause=ms=>new Promise(r=>w.setTimeout(r,ms));
 const until=async(fn)=>{for(let i=0;i<100;i++){if(fn())return true;await pause(30)}return false};
 let checks=0;const failures=[];const check=(ok,label)=>{checks++;if(!ok)failures.push(label)};
 const folder=PathUtils.join(PathUtils.profileDir,'preview-fixtures');await IOUtils.makeDirectory(folder);
 const downloads=[];
 for(const [i,name]of ['Preview fixture.pdf','Preview fixture.png'].entries()){
  const path=PathUtils.join(folder,name);await IOUtils.copy(PathUtils.join(fixtures,name),path);
  const download=await Downloads.createDownload({source:'https://example.com/preview-'+i,target:path});
  download.startTime=new Date(Date.now()+i*1000);download.succeeded=true;download.stopped=true;download.endTime=Date.now()+i*1000;await download.refresh();
  await downloadList.add(download);downloads.push(download);
 }
 w._nativeMediaFixture={downloads,folder};
 const button=d.getElementById('zen-library-button'),list=d.getElementById('zen-library-download-list'),foot=d.getElementById('zen-sidebar-foot-buttons');
 const selected=w.gBrowser.selectedTab;
 for(const space of w.gZenWorkspaces.getWorkspaces()){
  await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid);const selected=w.gBrowser.selectedTab;
  const r=button.getBoundingClientRect();button.dispatchEvent(new w.MouseEvent('mouseenter',{clientX:r.x+r.width/2,clientY:r.y+r.height/2}));
  check(await until(()=>foot.hasAttribute('zen-library-stack-open')),space.name+': hover opens');
  const row=[...list.children].find(n=>!n.hidden&&n.download?.target.path===downloads[0].target.path);
  check(!!row,space.name+': PDF row');
  row?.dispatchEvent(new w.MouseEvent('click',{bubbles:true,button:0}));
  check(await until(()=>preview.isOpen),space.name+': PDF click opens native preview');
  check(!foot.hasAttribute('zen-library-stack-open'),space.name+': hover closes behind preview');
  check(w.gBrowser.selectedTab===selected,space.name+': tab unchanged');
  preview.close();check(!preview.isOpen,space.name+': explicit close');
 }
 await w.gZenWorkspaces.changeWorkspaceWithID(w.gZenWorkspaces.getWorkspaces()[0].uuid);
 const Library=w.customElements.get('zen-library');Library.toggle('downloads');
 check(await until(()=>!!d.querySelector('zen-library-downloads-section')), 'Library Downloads opens');
 const section=d.querySelector('zen-library-downloads-section');
 check(await until(()=>[...section.querySelectorAll('.zen-library-row-title')].some(n=>n.textContent==='Preview fixture.pdf')),'Library contains completed PDF');
 const title=[...section.querySelectorAll('.zen-library-row-title')].find(n=>n.textContent==='Preview fixture.pdf');
 title?.closest('.zen-library-row').dispatchEvent(new w.MouseEvent('click',{bubbles:true,button:0}));
 check(await until(()=>preview.isOpen),'Library PDF click opens same native preview');preview.close();
 Library.toggle('downloads');
 return {checks,failures,productionProfile:false};
})().then(done,e=>done({error:String(e),stack:e.stack}));
