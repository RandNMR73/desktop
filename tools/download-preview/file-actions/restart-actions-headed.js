const done=arguments[arguments.length-1];
(async()=>{
 const w=Services.wm.getMostRecentWindow('navigator:browser');let checks=0;const failures=[];
 const check=(ok,msg)=>{checks++;if(!ok)failures.push(msg)};
 const {libraryHiddenFiles}=ChromeUtils.importESModule('moz-src:///zen/library/ZenLibraryHiddenFiles.sys.mjs');const store=libraryHiddenFiles();await store.ready;
 const saved=await IOUtils.readJSON(store.path);
 check(saved.paths.length===1&&store.has(saved.paths[0]),'ordinary hidden file survives actual browser restart');
 check(saved.downloadPaths.length===1&&store.hasDownload(saved.downloadPaths[0]),'hidden download fallback survives actual browser restart');
 check(await IOUtils.exists(saved.paths[0]),'ordinary hidden file still exists after restart');
 check(await IOUtils.exists(saved.downloadPaths[0]),'browser download file still exists after restart');
 const {ZenDownloadPreview}=ChromeUtils.importESModule('moz-src:///zen/library/ZenDownloadPreview.sys.mjs');const api=new ZenDownloadPreview(w);
 const files=await api.files(PathUtils.join(PathUtils.profileDir,'owned-file-menu'),store.path);
 check(files.length===4&&files.every(x=>!store.has(x.target.path)),'native list still backfills correctly after restart');api.destroy();
 const {PlacesUtils}=ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');const history=await PlacesUtils.history.fetch('https://example.invalid/owned-file-actions-public',{includeVisits:true});
 check(history?.visits.some(v=>v.transition===PlacesUtils.history.TRANSITIONS.LINK),'ordinary browsing history survives restart');
 const {DownloadHistory}=ChromeUtils.importESModule('resource://gre/modules/DownloadHistory.sys.mjs');const {Downloads}=ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
 const list=await DownloadHistory.getList({type:Downloads.PUBLIC});check(!(await list.getAll()).some(x=>x.source.url==='https://example.invalid/owned-file-actions-public'),'hidden download stays out of persisted history');
 return{checks,failures,production_profile_used:false};
})().then(done,e=>done({error:String(e),stack:e.stack}));
