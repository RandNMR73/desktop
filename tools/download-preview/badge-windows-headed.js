const done = arguments[arguments.length-1];
(async () => {
  const profile=Services.dirsvc.get("ProfD",Ci.nsIFile).path;
  if(!profile.includes("zen-region-colors-native-")) throw new Error("Owned disposable profile required");
  const main=Services.wm.getMostRecentWindow("navigator:browser");
  const {Downloads}=ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const publicList=await Downloads.getList(Downloads.PUBLIC), privateList=await Downloads.getList(Downloads.PRIVATE);
  const folder=PathUtils.join(profile,"owned-badge-windows");await IOUtils.makeDirectory(folder);
  const pause=ms=>new Promise(resolve=>main.setTimeout(resolve,ms));
  const until=async predicate=>{for(let i=0;i<200&&!predicate();i++)await pause(25);return !!predicate();};
  const windows=[], owned=[], failures=[];let checks=0;
  const check=(value,message)=>{checks++;if(!value)failures.push(message);};
  const selected=win=>win.document.getElementById("zen-library-download-list")?.querySelector("[zen-library-footer-badge]")?.download;
  const badge=win=>win.document.getElementById("zen-sidebar-foot-buttons")?.hasAttribute("zen-library-badge");
  const enter=win=>{const button=win.document.getElementById("zen-library-button"),r=button.getBoundingClientRect();button.dispatchEvent(new win.MouseEvent("mouseenter",{clientX:r.x+16,clientY:r.y+16}));};
  const leave=win=>win.document.getElementById("zen-library-button").dispatchEvent(new win.MouseEvent("mouseleave",{clientX:400,clientY:400}));
  const open=async options=>{const win=main.OpenBrowserWindow(options);windows.push(win);check(await until(()=>win.gBrowserInit?.delayedStartupFinished),"owned window starts");await pause(200);return win;};
  const add=async isPrivate=>{
    const path=PathUtils.join(folder,"Fixture-"+owned.length+".txt");await IOUtils.writeUTF8(path,"Owned multiwindow fixture");
    const x=await Downloads.createDownload({source:{url:"https://example.com/owned-window-"+owned.length,isPrivate},target:{path},startTime:new Date()});
    await x.refresh();x.target.exists=true;x.stopped=false;x.succeeded=false;x._setBytes(33,100,true);
    const list=isPrivate?privateList:publicList;owned.push({list,x});await list.add(x);return x;
  };
  const complete=x=>{Object.assign(x,{stopped:true,succeeded:true,canceled:false,hasPartialData:false,error:null,currentBytes:100,progress:100,endTime:Date.now()});x._notifyChange();};
  try {
    enter(main);await pause(650);leave(main);await pause(350);
    const x=await add(false), second=await open();
    check(await until(()=>selected(main)===x&&selected(second)===x),"normal windows share selected activity");
    complete(x);check(await until(()=>badge(main)&&badge(second)),"normal windows retain selected completion");
    enter(second);await pause(650);
    check(await until(()=>!badge(main)&&!badge(second)),"expansion in one window consumes the shared completed badge and finishes local dismissal");
    leave(second);const y=await add(false);second.close();check(await until(()=>second.closed),"secondary normal window closes");
    check(selected(main)===y,"closing secondary window preserves normal selection");
    const privateOne=await open({private:true}), privateTwo=await open({private:true});
    check(!badge(privateOne)&&!badge(privateTwo),"private windows do not inherit normal badges");
    const secret=await add(true);
    check(await until(()=>selected(privateOne)===secret&&selected(privateTwo)===secret),"private windows share their own selected activity");
    check(selected(main)===y,"private arrival leaves normal selection intact");
    privateOne.close();check(await until(()=>privateOne.closed),"first private owner closes");
    complete(secret);check(selected(privateTwo)===secret,"remaining private owner processes completion");
    enter(privateTwo);await pause(650);check(!badge(privateTwo),"remaining private window consumes completion");
    check(selected(main)===y,"private consumption does not consume normal badge");
    leave(privateTwo);privateTwo.close();check(await until(()=>privateTwo.closed),"last private owner closes");
    const next=await open({private:true});check(!badge(next),"new private session does not revive old private badge");
    check(selected(main)===y,"new private session leaves normal selection intact");
  } finally {
    leave(main);for(const {list,x} of owned){x.stopped=true;await list.remove(x);}
    for(const win of windows)if(!win.closed)win.close();
    await IOUtils.remove(folder,{recursive:true});
  }
  return {checks,failures,production_profile_used:false,ownedWindows:windows.length};
})().then(done,error=>done({error:String(error),stack:error.stack}));
