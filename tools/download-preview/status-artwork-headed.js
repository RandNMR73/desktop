const done = arguments[arguments.length - 1];
(async () => {
  const profile = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
  if (!profile.includes("zen-region-colors-native-")) throw new Error("Owned disposable profile required");
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const { ZenDownloadPreview } = ChromeUtils.importESModule("moz-src:///zen/library/ZenDownloadPreview.sys.mjs");
  const { ZenLibraryFileMenu } = ChromeUtils.importESModule("moz-src:///zen/library/ZenLibraryFileMenu.sys.mjs");
  const downloads = await Downloads.getList(Downloads.PUBLIC);
  const list = d.getElementById("zen-library-download-list"), foot = d.getElementById("zen-sidebar-foot-buttons");
  const button = d.getElementById("zen-library-button"), footer = d.getElementById("library-button-badge");
  const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
  const enter = () => { const r = button.getBoundingClientRect(); button.dispatchEvent(new w.MouseEvent("mouseenter", {clientX:r.x+16,clientY:r.y+16})); };
  const leave = () => button.dispatchEvent(new w.MouseEvent("mouseleave", {clientX:400,clientY:400}));
  const row = x => [...list.children].find(n => !n.hidden && n.download?.target.path === x.target.path);
  const badge = x => {
    const item=row(x);
    if (!item) throw new Error("Missing fixture row: " + JSON.stringify({exists:x.target.exists,succeeded:x.succeeded,stopped:x.stopped,rows:[...list.children].map(n=>({hidden:n.hidden,path:n.download?.target.path}))}));
    return item.querySelector(".zen-library-download-badge");
  };
  const settle = async () => { await pause(100); await Promise.allSettled(list.getAnimations({subtree:true}).map(a => a.finished)); };
  let checks=0; const failures=[], samples=[], calls=[], deferred=[];
  const check = (ok, message) => { checks++; if (!ok) failures.push(message); };
  const owned = [], folder = PathUtils.join(profile, "owned-status-artwork");
  await IOUtils.makeDirectory(folder);
  const png = Uint8Array.from(w.atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg=="), c=>c.charCodeAt(0));
  const thumbnail = ZenDownloadPreview.prototype.thumbnail, prefetch = ZenLibraryFileMenu.prototype.prefetch;
  let defer = false;
  const image = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lime"/></svg>');
  ZenDownloadPreview.prototype.thumbnail = function(x, ...args) {
    if (!x.target.path.startsWith(folder)) return thumbnail.call(this,x,...args);
    calls.push({kind:"thumbnail",succeeded:x.succeeded,stopped:x.stopped});
    if (!x.succeeded) return Promise.resolve(null);
    return defer ? new Promise(resolve=>deferred.push(resolve)) : Promise.resolve({url:image,preview:true});
  };
  ZenLibraryFileMenu.prototype.prefetch = function(x, ...args) {
    if (!x.target.path.startsWith(folder)) return prefetch.call(this,x,...args);
    calls.push({kind:"metadata",succeeded:x.succeeded,stopped:x.stopped});
  };
  const apply = (x, state) => {
    Object.assign(x,{stopped:true,succeeded:false,canceled:false,hasPartialData:false,error:null,currentBytes:40,totalBytes:100,progress:40,hasProgress:true});
    if (state === "active") x.stopped=false;
    if (state === "paused") {x.canceled=true;x.hasPartialData=true;}
    if (state === "cancelled") x.canceled=true;
    if (state === "failed") x.error={message:"Owned failure"};
    if (state === "completed") {x.succeeded=true;x.endTime=Date.now();}
    x._notifyChange();
  };
  const add = async name => {
    const path=PathUtils.join(folder,name+".png"); await IOUtils.write(path,png);
    const x=await Downloads.createDownload({source:{url:"https://example.invalid/"+name},target:{path},startTime:new Date()});
    await x.refresh(); x.target.exists=await IOUtils.exists(path);
    apply(x,"active"); await downloads.add(x); owned.push(x); return x;
  };
  try {
    enter(); await pause(650); leave(); await pause(350);
    const x=await add("Status fixture"); await pause(350);
    for(const space of w.gZenWorkspaces.getWorkspaces()) {
      await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid); enter(); await pause(650);
      // Success first populates artwork; each following state must clear it.
      for(const state of ["completed","failed","active","paused","cancelled","notStarted","completed"]) {
        const before=calls.length; apply(x,state); await settle();
        const b=badge(x), cs=w.getComputedStyle(b), r=b.getBoundingClientRect();
        const content=b.querySelector(".zen-library-download-progress-content"), svg=b.querySelector("svg");
        const text=row(x).querySelector(".zen-library-download-list-title").getBoundingClientRect();
        check(r.width===40&&r.height===40&&r.x===8&&text.x===60,space.name+" "+state+": fixed slot and title alignment");
        if(state==="completed") {
          check(cs.backgroundImage!=="none"&&b.hasAttribute("preview"),space.name+": successful file restores preview");
        } else {
          check(cs.backgroundImage==="none"&&!b.hasAttribute("preview"),space.name+" "+state+": no file artwork");
          check(calls.length===before,space.name+" "+state+": no thumbnail or metadata requests");
          if(state==="active") check(w.getComputedStyle(svg).display!=="none"&&w.getComputedStyle(content).display!=="none",space.name+": resume restores progress");
          else check(w.getComputedStyle(svg).display==="none"||w.getComputedStyle(content).display==="none",space.name+" "+state+": empty artwork slot");
        }
        samples.push({space:space.name,state,frame:r.toJSON(),background:cs.backgroundImage,subtitle:row(x).querySelector(".zen-library-download-list-subtitle").textContent});
      }
      leave(); await pause(350);
    }
    apply(x,"active"); await settle();
    check(w.getComputedStyle(footer).backgroundImage==="none","closed active footer has no stale file background");
    apply(x,"failed"); await settle();
    check(w.getComputedStyle(footer).backgroundImage==="none","closed failed footer has no file artwork");
    enter(); await pause(650); defer=true; apply(x,"completed"); await settle();
    check(deferred.length>=2,"row and footer have outstanding completed-thumbnail results");
    apply(x,"cancelled"); await settle();
    for(const resolve of deferred.splice(0)) resolve({url:image,preview:true});
    await settle();
    check([badge(x),footer].every(b=>w.getComputedStyle(b).backgroundImage==="none"&&!b.hasAttribute("preview")),"late success thumbnail cannot repaint a cancelled item");
    defer=false; apply(x,"completed"); await settle();
    const beforeReplacement=badge(x); const y=await add("Replacement fixture"); await settle();
    check(badge(y)===beforeReplacement,"new item reuses the previously successful bottom row");
    apply(y,"failed"); await settle();
    check(w.getComputedStyle(badge(y)).backgroundImage==="none"&&!badge(y).hasAttribute("preview"),"recycled failed row does not retain another file's image");
    check(w.getComputedStyle(badge(x)).backgroundImage!=="none","successful item retains its artwork after moving to another slot");
    check(!calls.some(call=>!call.succeeded),"only completed files request artwork or metadata lookups");
  } finally {
    defer=false; for(const resolve of deferred)resolve(null);
    ZenDownloadPreview.prototype.thumbnail=thumbnail; ZenLibraryFileMenu.prototype.prefetch=prefetch;
    leave(); for(const x of owned)await downloads.remove(x); await IOUtils.remove(folder,{recursive:true});
  }
  return {checks,failures,samples,requests:calls.length,production_profile_used:false};
})().then(done,error=>done({error:String(error),stack:error.stack}));
