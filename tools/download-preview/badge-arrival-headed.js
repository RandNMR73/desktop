// This fixture only operates on the disposable browser profile owned by the test.
const done=arguments[arguments.length-1], spaceIndex=Number(arguments[0]||0);
(async()=>{
 const profile=Services.dirsvc.get("ProfD",Ci.nsIFile).path;
 if(!profile.includes("zen-region-colors-native-"))throw Error("Owned disposable profile required");
 const w=Services.wm.getMostRecentWindow("navigator:browser"),d=w.document;
 const {Downloads}=ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
 const {previewDownloadRecords}=ChromeUtils.importESModule("moz-src:///zen/library/ZenLibraryPreviewSources.sys.mjs");
 const pool=previewDownloadRecords(false),downloads=await Downloads.getList(Downloads.PUBLIC);
 const foot=d.getElementById("zen-sidebar-foot-buttons"),button=d.getElementById("zen-library-button"),
  badge=d.getElementById("library-button-badge"),parent=badge.parentElement,sprite=button.querySelector(".zen-library-sprite");
 const pause=ms=>new Promise(r=>w.setTimeout(r,ms)),until=async fn=>{for(let i=0;i<150&&!fn();i++)await pause(20);return !!fn();};
 const enter=()=>{const r=button.getBoundingClientRect();button.dispatchEvent(new w.MouseEvent("mouseenter",{clientX:r.x+16,clientY:r.y+16}));};
 const leave=()=>button.dispatchEvent(new w.MouseEvent("mouseleave",{clientX:600,clientY:600}));
 const selected=()=>d.querySelector("#zen-library-download-list > [zen-library-footer-badge]")?.download;
 const animations=()=>[...parent.getAnimations(),...badge.getAnimations(),...sprite.getAnimations()].filter(a=>a.effect?.getKeyframes().some(k=>k.transform||k.translate));
 const finish=async()=>{for(const a of animations())a.finish();await pause(20);};
 const freeze=()=>{const a=animations();for(const x of a)x.pause();return a;};
 // Frozen geometry samples share one task; the independent native cleanup
 // timer must not advance between deliberate compositor time samples.
 const sample=(list,time)=>{for(const a of list)a.currentTime=Math.min(time,a.effect.getTiming().duration);};
 const matrix=node=>{const s=w.getComputedStyle(node).transform;return s==="none"?new w.DOMMatrix():new w.DOMMatrix(s);};
 const folder=PathUtils.join(profile,"owned-badge-arrival");await IOUtils.makeDirectory(folder);
 let checks=0,next=0;const failures=[],samples=[],owned=[];
 const check=(ok,message)=>{checks++;if(!ok)failures.push(message);};
 const near=(a,b,tolerance=.03)=>Math.abs(a-b)<tolerance;
 const add=async state=>{
  const path=PathUtils.join(folder,`Arrival-${next++}.png`);
  await IOUtils.copy("/Users/matthewnoto/Temp/zen-arc-validation/download-media-preview-2026-10-31/fixtures/Preview fixture.png",path);
  const x=await Downloads.createDownload({source:{url:"https://example.com/arrival-"+next},target:{path},startTime:new Date(Date.now()+next)});
  await x.refresh();x.target.exists=true;
  Object.assign(x,{stopped:state!=="active",succeeded:state==="completed",hasProgress:true,progress:25,currentBytes:25,totalBytes:100});
  await downloads.add(x);owned.push(x);return x;
 };
 const curve=x=>{let low=0,high=1,t=.5;const cubic=(t,a,b)=>3*(1-t)**2*t*a+3*(1-t)*t*t*b+t*t*t;for(let i=0;i<40;i++){t=(low+high)/2;if(cubic(t,.78,.7)<x)low=t;else high=t;}return cubic(t,0,1);};
 const spring=t=>1+Math.exp(-12.5*t)*(-Math.cos(Math.sqrt(343.75)*t)-2.5/Math.sqrt(343.75)*Math.sin(Math.sqrt(343.75)*t));
 const space=w.gZenWorkspaces.getWorkspaces()[spaceIndex];await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid);
 try {
  enter();await pause(550);leave();await pause(400);
  for(const state of ["active","completed"]){
   const x=await add(state),arriving=freeze();
   check(arriving.length===2,state+": badge and icon receive separate arrival motion");
   const duration=arriving[0]?.effect.getTiming().duration;
   check(near(duration,980.8355971541216,.001),state+": native drop/hold/spring duration");
   const expectedScale=state==="completed"?.55:.8;
   for(const time of [0,100,200,210,220,270,350,600]){
    await sample(arriving,time);
    const p=time<=200?curve(time/200):time<=220?1:spring((time-220)/1000);
    const y=time<=200?-8+20*p:time<=220?12:12*(1-p);
    const iconY=time<=200?6*p:time<=220?6:6*(1-p);
    check(near(matrix(parent).f,y),`${state}: badge Y at${time}ms`);
    check(near(Number(w.getComputedStyle(parent).opacity),time<=200?p:1,.0001),`${state}: opacity at${time}ms`);
    check(near(parseFloat(w.getComputedStyle(sprite).translate.split(" ")[1]||"0"),iconY),`${state}: icon Y at${time}ms`);
    check(near(matrix(badge).a,expectedScale,.0001),`${state}: scale is constant during arrival`);
   }
   await finish();check(selected()===x&&animations().length===0,state+": arrival settles without clearing selection");
   pool.badge.dismiss(x);const outgoing=freeze();
   check(outgoing.length===2,state+": dismissal owns badge and icon motion");
   check(selected()===x&&pool.badge.current===null,state+": local artwork survives shared dismissal");
   const badgeAnimation=badge.getAnimations()[0];
   check(badgeAnimation?.effect.getTiming().duration===140,state+": native fade duration");
   const baseline=button.getBoundingClientRect();
   for(const p of [0,.25,.5,.75,1]){
    await sample(outgoing,140*p);
    const m=matrix(badge),scale=expectedScale+(.2-expectedScale)*p;
    const center=new w.DOMPoint(20,20).matrixTransform(m);
    check(near(center.x,24-14*p)&&near(center.y,2+20*p),state+": native dismissal center at"+p);
    check(near(Math.hypot(m.a,m.b),scale,.0001)&&near(Math.atan2(m.b,m.a)*180/Math.PI,-45*p),state+": native rotation and scale at"+p);
    check(near(Number(w.getComputedStyle(badge).opacity),1-p,.0001),state+": dismissal opacity at"+p);
   }
   for(const [time,scale] of [[160,1],[210,1.1],[260,1.2],[270,1.2],[320,1.1],[370,1]]){
    await sample(outgoing,time);check(near(matrix(sprite).a,scale,.0001),state+": icon pulse at"+time);
   }
   await finish();check(!foot.hasAttribute("zen-library-badge")&&!selected(),state+": dismissal cleanup releases local artwork");
   samples.push({state,arrivalFrames:arriving[0]?.effect.getKeyframes().length,duration,buttonX:baseline.x});
   await downloads.remove(x);owned.splice(owned.indexOf(x),1);
  }
  const old=await add("completed");await finish();pool.badge.dismiss(old);const stale=freeze();
  await sample(stale,70);const nextItem=await add("active");
  check(selected()===nextItem&&stale.every(a=>a.playState==="idle"),"replacement cancels prior dismissal");
  await finish();await pause(420);check(selected()===nextItem&&foot.hasAttribute("zen-library-badge"),"old cleanup cannot hide replacement");
  enter();await pause(550);const expanded=await add("completed");
  check(animations().length===0,"arrival while expanded does not move the footer or icon");
  leave();await pause(400);check(selected()===expanded,"expanded arrival remains selected after closing");
  await downloads.remove(expanded);owned.splice(owned.indexOf(expanded),1);
  await finish();
  const interrupt=await add("active");check(animations().length===2,"new arrival starts before expansion interrupt");
  enter();await pause(550);check(animations().length===0,"expansion cancels outstanding footer arrival");
  leave();await pause(400);check(selected()===interrupt,"interrupted arrival retains badge identity");
 } finally {
  leave();for(const x of owned)await downloads.remove(x);await finish();await IOUtils.remove(folder,{recursive:true});
 }
 return {space:space.name,checks,failures,samples,production_profile_used:false};
})().then(done,error=>done({error:String(error),stack:error.stack}));
