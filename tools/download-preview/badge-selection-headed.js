// Owned disposable browser only. The expected timers and replacement order
// are recorded in arc-badge-selection-reference.json.
const done = arguments[arguments.length - 1];
const phase = arguments[0] || "selection", spaceIndex = Number(arguments[1] || 0);
(async () => {
  const profile = Services.dirsvc.get("ProfD",Ci.nsIFile).path;
  if (!profile.includes("zen-region-colors-native-")) throw new Error("Owned disposable profile required");
  const w = Services.wm.getMostRecentWindow("navigator:browser"), d = w.document;
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const downloads = await Downloads.getList(Downloads.PUBLIC);
  const foot = d.getElementById("zen-sidebar-foot-buttons"), button = d.getElementById("zen-library-button");
  const list = d.getElementById("zen-library-download-list");
  const pause = ms => new Promise(resolve => w.setTimeout(resolve,ms));
  const until = async (fn, ms = 1500) => {
    const end = w.performance.now() + ms;
    while (!fn() && w.performance.now() < end) await pause(20);
    return !!fn();
  };
  const enter = () => { const r=button.getBoundingClientRect(); button.dispatchEvent(new w.MouseEvent("mouseenter",{clientX:r.x+16,clientY:r.y+16})); };
  const leave = () => button.dispatchEvent(new w.MouseEvent("mouseleave",{clientX:400,clientY:400}));
  const selected = () => list.querySelector("[zen-library-footer-badge]")?.download;
  const badge = () => foot.hasAttribute("zen-library-badge");
  const folder = PathUtils.join(profile,"owned-badge-selection");
  await IOUtils.makeDirectory(folder);
  const failures = [], samples = [], owned = [];
  let checks = 0, next = 0;
  const check = (value,message) => {checks++;if (!value) failures.push(message);};
  const apply = (x,state) => {
    Object.assign(x,{stopped:state!=="active",succeeded:state==="completed",canceled:["paused","cancelled"].includes(state),
      hasPartialData:state==="paused",error:state==="failed"?{message:"Owned failure"}:null,
      currentBytes:33,totalBytes:100,hasProgress:true,progress:33});
    if (state==="completed") x.endTime=Date.now();
    x._notifyChange();
  };
  const add = async state => {
    const path=PathUtils.join(folder,`Fixture-${next++}.txt`);
    await IOUtils.writeUTF8(path,"Owned badge fixture");
    const x=await Downloads.createDownload({source:{url:"https://example.com/"+next},target:{path},startTime:new Date(Date.now()+next)});
    await x.refresh();x.target.exists=await IOUtils.exists(path);apply(x,state);await downloads.add(x);owned.push(x);return x;
  };
  const remove = async x => {await downloads.remove(x);owned.splice(owned.indexOf(x),1);};
  const space=w.gZenWorkspaces.getWorkspaces()[spaceIndex];
  await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid);
  try {
    enter();await pause(650);leave();await pause(350);
    if (phase==="selection") {
      const a=await add("active"), b=await add("active"), c=await add("active"), last=await add("active");
      check(selected()===last,"new arrival owns the footer");
      apply(last,"completed");check(selected()===c,"completion switches immediately to newest other activity");
      check(Math.abs(d.getElementById("library-button-badge").getBoundingClientRect().width-32)<0.05,"replacement active footer is 32pt");
      enter();await pause(650);
      const replacementRow=list.querySelector("[zen-library-footer-badge]");
      check(Math.abs(replacementRow.querySelector(".zen-library-download-badge").getBoundingClientRect().width-40)<0.05,"older selected activity expands in its own 40pt row");
      leave();
      const closing=replacementRow.getAnimations().find(a=>a.effect.getKeyframes().some(f=>f.transform));
      const endpoint=closing?.effect.getKeyframes().at(-1);
      check(!!endpoint&&Math.abs(new w.DOMMatrix(endpoint.transform).a-0.8)<0.0001&&Number(endpoint.opacity)===1,"replacement activity closes to an opaque0.8-scale footer");
      if (closing) await closing.finished.catch(()=>{});
      await until(()=>!list.querySelector("[zen-library-active-badge]"));
      check(!list.querySelector("[zen-library-active-badge]"),"replacement motion releases row ownership after closing");
      apply(c,"failed");check(selected()===b,"failure switches to next active item");
      apply(b,"paused");check(selected()===b,"pausing retains current identity");
      enter();await pause(650);check(selected()===b,"expanding preserves paused badge");
      leave();await pause(350);check(selected()===b,"closing preserves paused badge");
      await remove(b);check(selected()===a,"removal returns to older visible activity");
      await remove(a);check(!badge()&&!selected(),"removing last activity does not revive completed or failed items");
      await remove(c);await remove(last);
      const hidden=await add("active");
      const rest=[];for (const state of ["completed","paused","completed","failed"]) rest.push(await add(state));
      check(![...list.children].some(row=>!row.hidden&&row.download===hidden),"older activity is outside the four visible rows");
      enter();await pause(650);check(!badge(),"expansion cannot restore hidden activity or a paused candidate");
      leave();await pause(350);
      const shown=[...list.children].filter(row=>!row.hidden);
      check(shown.length===4,"preview remains bounded to four items");
      check(shown.every(row=>Math.abs(row.querySelector(".zen-library-download-badge").getBoundingClientRect().width-40)<0.05),"row thumbnail slots remain 40pt");
      samples.push({space:space.name,visible:shown.map(row=>row.download.target.path)});
    } else if (phase==="retry") {
      const x=await add("failed");enter();await pause(650);leave();await pause(350);
      check(!badge(),"failed badge is consumed before retry");
      const execute=x.saver.execute;
      let release;const gate=new Promise(resolve=>{release=resolve;});
      x.saver.execute=()=>gate;
      try {
        const attempt=x.start();
        check(await until(()=>selected()===x&&!x.stopped),"real Download.start restores the retry badge");
        check(d.getElementById("library-button-badge").hasAttribute("downloading"),"retry displays the active progress artwork");
        release();await attempt;
        check(x.succeeded&&badge()&&selected()===x,"completed retry keeps its selected thumbnail");
        enter();await pause(650);check(!badge(),"next expansion consumes the retried completion");
      } finally {release();x.saver.execute=execute;}
    } else if (phase==="expiry") {
      for (const [state, milliseconds] of [["completed",30000],["failed",5000],["cancelled",5000]]) {
        const x=await add(state), start=w.performance.now();
        check(selected()===x&&badge(),state+": arrival selected");
        await pause(Math.max(0,milliseconds-250-(w.performance.now()-start)));
        check(selected()===x&&badge(),state+": still selected before native deadline");
        check(await until(()=>!badge(),1500),state+": expires after native delay");
        const elapsed=w.performance.now()-start;
        check(elapsed>=milliseconds-50&&elapsed<milliseconds+1500,state+": observed lifetime within scheduler tolerance");
        check([...list.children].some(row=>row.download===x),state+": expiry preserves preview history");
        samples.push({state,milliseconds,elapsed});await remove(x);
      }
    } else throw new Error("Unknown phase");
  } finally {
    leave();for (const x of owned) await downloads.remove(x);
    await IOUtils.remove(folder,{recursive:true});
  }
  return {phase,space:space.name,checks,failures,samples,production_profile_used:false};
})().then(done,error=>done({error:String(error),stack:error.stack}));
