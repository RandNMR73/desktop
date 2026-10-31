const done=arguments[arguments.length-1];
(async()=>{
 const w=Services.wm.getMostRecentWindow('navigator:browser'),d=w.document;
 const {Downloads}=ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
 const downloads=await Downloads.getList(Downloads.PUBLIC),list=d.getElementById('zen-library-download-list'),foot=d.getElementById('zen-sidebar-foot-buttons'),button=d.getElementById('zen-library-button');
 const pause=ms=>new Promise(r=>w.setTimeout(r,ms)),open=()=>foot.hasAttribute('zen-library-stack-open');
 const enter=()=>{const r=button.getBoundingClientRect();button.dispatchEvent(new w.MouseEvent('mouseenter',{clientX:r.x+16,clientY:r.y+16}))};
 const leave=()=>button.dispatchEvent(new w.MouseEvent('mouseleave',{clientX:400,clientY:400}));
 const until=async fn=>{for(let i=0;i<100&&!fn();i++)await pause(5)};
 const near=(a,b,t=.002)=>Math.abs(a-b)<t;
 let checks=0;const failures=[],traces=[];const check=(ok,msg)=>{checks++;if(!ok)failures.push(msg)};
 const row=x=>[...list.children].find(n=>!n.hidden&&n.download?.target.path===x.target.path);
 const icon=x=>row(x).querySelector('.zen-library-download-badge');
 const content=b=>b.querySelector('.zen-library-download-progress-content');
 const arc=b=>b.querySelector('.zen-library-download-progress-arc');
 const ring=b=>arc(b).getAnimations().find(a=>a.effect.getKeyframes().some(k=>k.strokeDasharray));
 const completion=b=>content(b).getAnimations();
 const footer=d.getElementById('library-button-badge');
 const set=(x,p)=>{x.currentBytes=p;x.progress=p;x._notifyChange()};
 const finishRing=async b=>{ring(b)?.finish();await pause(10)};
 const owned=[];
 leave();await pause(400);enter();await until(open);await pause(400);
 const fixtures=[...list.children].filter(n=>!n.hidden).map(n=>n.download);
 const add=async(index=0,p=20)=>{const x=await Downloads.createDownload({target:{path:fixtures[index].target.path},source:{url:'https://example.invalid/owned-completion-'+index},startTime:new Date(),endTime:0});await x.refresh();x.target.exists=await IOUtils.exists(x.target.path);x.succeeded=false;x.stopped=false;x.canceled=false;x._setBytes(p,100,true);await downloads.add(x);owned.push(x);await pause(100);return x};
 let x=await add();
 try {
  check(!ring(icon(x))&&!ring(footer),'initial progress appears without an invented transition');
  set(x,70);await until(()=>ring(icon(x)));
  const firstRings=[ring(icon(x)),ring(footer)];
  check(firstRings.every(Boolean),'row and footer animate progress updates');
  for(const a of firstRings){a.pause();a.currentTime=175}
  const easeOutMid=.6846427917480469,easeInMid=.3153572082519531; // SwiftUI UnitCurve samples.
  const expected=20+50*easeOutMid;
  for(const b of [icon(x),footer]){
   check(near(parseFloat(w.getComputedStyle(arc(b)).strokeDasharray),expected),'progress midpoint matches native 350ms easeOut');
   check(ring(b).effect.getTiming().duration===350,'progress uses native default easeOut duration');
  }
  set(x,40);await until(()=>ring(icon(x))!==firstRings[0]);
  for(const b of [icon(x),footer]){
   check(near(parseFloat(ring(b).effect.getKeyframes()[0].strokeDasharray),expected),'interrupted progress starts from the visible trim');
   ring(b).finish();
  }
  await pause(30);set(x,0);await until(()=>ring(icon(x)));
  for(const b of [icon(x),footer]){
   const a=ring(b);a.pause();a.currentTime=175;
   check(w.getComputedStyle(arc(b)).visibility==='visible','shrinking progress remains visible before reaching zero');
   a.finish();
  }
  await pause(30);
  check([icon(x),footer].every(b=>w.getComputedStyle(arc(b)).visibility==='hidden'),'zero trim finishes without a round-cap dot');
  set(x,60);await until(()=>ring(icon(x)));await finishRing(icon(x));await finishRing(footer);
  set(x,100);await until(()=>completion(icon(x)).length===2);
  let badge=icon(x),copies=[badge,footer],animations=copies.flatMap(completion);
  const start=animations[0].startTime;
  check(animations.length===4&&animations.every(a=>a.startTime===start),'row and footer share the same completion clock');
  check(copies.every(b=>b.hasAttribute('completing')),'100% while active changes to completion state');
  check(copies.every(b=>w.getComputedStyle(content(b),'::after').maskImage.includes('download-progress-checkmark.svg')),'completion uses the native size-9 heavy checkmark mask');
  check(copies.every(b=>w.getComputedStyle(b.querySelector('.zen-library-download-progress-rings')).opacity==='0.5'),'completion dims both progress rings to native 50%');
  for(const a of animations){a.pause();a.currentTime=1100}
  for(const b of copies){
   check(Number(w.getComputedStyle(content(b)).opacity)===1,'badge remains opaque during completion hold');
   check(new w.DOMMatrix(w.getComputedStyle(content(b)).transform).a===1,'coalesced early scale writes do not invent a pulse');
  }
  for(const a of animations)a.currentTime=1225;
  for(const b of copies)check(near(new w.DOMMatrix(w.getComputedStyle(content(b)).transform).a,1+.03*easeOutMid,.00001),'late scale pulse follows native easeOut');
  for(const a of animations)a.currentTime=1375;
  for(const b of copies){
   check(near(new w.DOMMatrix(w.getComputedStyle(content(b)).transform).a,1.03-.06*easeInMid,.00001),'final scale contraction follows native easeIn');
   check(near(Number(w.getComputedStyle(content(b)).opacity),1-easeInMid,.00001),'final fade follows native easeIn');
  }
  x._notifyChange();await pause(30);
  check(completion(icon(x)).every(a=>animations.includes(a)),'repeated 100% notifications do not restart completion');
  const y=await add(1);
  badge=icon(x);
  check(completion(badge).every(a=>a.startTime===start),'moving to another preview slot preserves the original clock');
  check(!icon(y).hasAttribute('completing')&&!footer.hasAttribute('completing'),'replacement item does not inherit a checkmark or fade');
  for(const a of completion(badge))a.finish();await pause(40);
  check(completion(badge).length===0&&w.getComputedStyle(content(badge)).opacity==='0','finished fade releases compositor animations');
  x.stopped=true;x.succeeded=true;x.endTime=Date.now();x._notifyChange();await pause(70);
  check(!icon(x).hasAttribute('completing')&&w.getComputedStyle(content(icon(x))).opacity==='1','finished file replaces and resets the faded progress view');
  check(icon(x).hasAttribute('completed')&&!icon(x).hasAttribute('downloading'),'file thumbnail is available immediately on success');
  set(y,100);await until(()=>completion(icon(y)).length===2);
  y.stopped=true;y.canceled=true;y._notifyChange();await pause(60);
  check(!icon(y).hasAttribute('completing')&&completion(icon(y)).length===0,'pausing destroys the active progress animation');
  check(w.getComputedStyle(content(icon(y))).display==='none','paused slot remains empty');
  y.stopped=false;y.canceled=false;y._notifyChange();await pause(60);
  check(!icon(y).hasAttribute('completing')&&completion(icon(y)).length===0,'resuming at 100% behaves like a newly created native progress view');
  set(y,40);await pause(10);y.stopped=true;y.succeeded=true;y.endTime=Date.now();y._notifyChange();await pause(60);
  check(icon(y).hasAttribute('completed')&&completion(icon(y)).length===0,'success without a 100% progress update introduces no artificial completion delay');
  const z=await add(2,100);
  check(!icon(z).hasAttribute('completing'),'initial 100% progress does not run native onChange');
  set(z,50);await pause(10);set(z,100);await until(()=>completion(icon(z)).length===2);
  check(icon(z).hasAttribute('completing'),'later transition to 100% does run completion');
  traces.push({completionStart:start,nativeUnitCurveMidpoints:{easeIn:easeInMid,easeOut:easeOutMid},progressDuration:350,completionDuration:1450});
 } finally {leave();for(const item of owned)await downloads.remove(item)}
 return{checks,failures,traces,production_profile_used:false,test_method:'owned headed Zen; frozen compositor timelines compared with independently sampled SwiftUI UnitCurve values'};
})().then(done,e=>done({error:String(e),stack:e.stack}));
