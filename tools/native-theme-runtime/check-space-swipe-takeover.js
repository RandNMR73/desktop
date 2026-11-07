// Disposable five-Space fixture only. This emulates the new native event fields;
// it is not a physical-input test. See SPACE-TRANSITIONS.md.
const done=arguments[arguments.length-1];
(async()=>{
 const w=Services.wm.getMostRecentWindow('navigator:browser'),ws=w.gZenWorkspaces;
 const pause=ms=>new Promise(r=>w.setTimeout(r,ms)), spaces=ws.getWorkspaces(),cases=[];
 let clock=1000;
 const event=(type,delta=0)=>{
  const e=w.document.createEvent('SimpleGestureEvent');
  e.initSimpleGestureEvent(type,true,true,w,0,0,0,0,0,false,false,false,false,0,null,0,w.SimpleGestureEvent.DIRECTION_RIGHT,delta,0);
  // This candidate still has the installed XUL. Exercise the new JS consumer
  // explicitly; generated binding/native input needs the later full build.
  Object.defineProperty(e,'swipeConsumerHandlesRelease',{value:false,writable:true});
  Object.defineProperty(e,'timeStamp',{value:clock});clock+=16;
  w.gNavToolbox.dispatchEvent(e);
  return {accepted:e.defaultPrevented,ownsRelease:e.swipeConsumerHandlesRelease};
 };
 const read=()=>({active:ws.activeWorkspace,changing:ws.isChangingWorkspace,gesture:ws._swipeManager.isGestureActive,
  offsets:spaces.map(s=>ws.workspaceElement(s.uuid).style.transform),
  opacity:w.document.getElementById('zen-browser-background').style.getPropertyValue('--zen-background-opacity'),
  toolbarOpacity:w.document.getElementById('zen-toolbar-background').style.getPropertyValue('--zen-background-opacity'),
  layers:['zen-browser-background','zen-toolbar-background'].map(id=>{
   const el=w.document.getElementById(id),suffix=id==='zen-browser-background'?'':'-toolbar';
   return{first:el.style.getPropertyValue('--zen-main-browser-background'+suffix+'-old'),second:el.style.getPropertyValue('--zen-main-browser-background'+suffix),progress:Number(el.style.getPropertyValue('--zen-background-opacity'))};
  }),
  scrollbar:w.gZenUIManager.tabsWrapper.style.scrollbarWidth});
 // The old selection animation leaves distant pages parked offscreen. Taking
 // over normalizes those invisible pages; compare every page that is visible
 // in either frame, plus both background layers, rather than hidden layout.
 const weights=layer=>{const v={};v[layer.first]=(v[layer.first]||0)+1-layer.progress;v[layer.second]=(v[layer.second]||0)+layer.progress;return v;};
 // Reversing the ordered page pair exchanges layers and complements alpha;
 // compare their actual compositing weights, with floating-point tolerance.
 const unchanged=(a,b)=>a.layers.every((layer,i)=>{
  const x=weights(layer),y=weights(b.layers[i]);
  return [...new Set([...Object.keys(x),...Object.keys(y)])].every(k=>Math.abs((x[k]||0)-(y[k]||0))<1e-12);
 })&&a.offsets.every((offset,i)=>{
  const x=parseFloat(offset.slice(11)),y=parseFloat(b.offsets[i].slice(11));
  return (Math.abs(x)>=100&&Math.abs(y)>=100)||Math.abs(x-y)<.0001;
 });
 const settledAt=(s,index)=>s.active===spaces[index].uuid&&s.offsets[index]==='translateX(0%)'&&s.opacity==='1'&&!s.changing&&!s.gesture&&s.scrollbar==='';
 const deltaForPages=p=>-p*ws.workspaceElement(ws.activeWorkspace).getBoundingClientRect().width*200/
  (Services.prefs.getIntPref('widget.swipe.pixel_size',550)*Services.prefs.getIntPref('zen.workspaces.swipe-actions.delta-multiplier'));
 for(const compact of [false,true]){
  w.gZenCompactModeManager.preference=compact;w.gNavToolbox.toggleAttribute('zen-user-show',compact);await pause(200);
  for(let from=0;from<spaces.length;from++){
   const target=from===spaces.length-1?from-1:from+1,step=Math.sign(target-from);
   await ws.changeWorkspaceWithID(spaces[from].uuid);
   const switching=ws.changeWorkspaceWithID(spaces[target].uuid);await pause(80);
   const before=read(),probe=event('MozSwipeGestureMayStart'),start=event('MozSwipeGestureStart'),after=read();
   await switching;const afterOldCompletion=read();
   event('MozSwipeGestureUpdate',0);const zeroUpdate=read();
   event('MozSwipeGestureUpdate',deltaForPages(.06*step));event('MozSwipeGestureUpdate',deltaForPages(.12*step));
   const moved=read();event('MozSwipeGesture');const release=read();event('MozSwipeGestureEnd');const end=read();
   await pause(1300);const settled=read();
   cases.push({compact,from,target,kind:'interrupt-release',probe,start,before,after,afterOldCompletion,zeroUpdate,moved,release,end,settled,
    passed:before.changing&&probe.accepted&&start.ownsRelease&&unchanged(before,after)&&unchanged(after,afterOldCompletion)&&unchanged(after,zeroUpdate)&&unchanged(release,end)&&settledAt(settled,target)});
  }
  for(const kind of ['cancel','reverse','keyboard','queued','reduced-motion']){
   await ws.changeWorkspaceWithID(spaces[1].uuid);
   event('MozSwipeGestureStart');event('MozSwipeGestureUpdate',deltaForPages(.12));event('MozSwipeGestureUpdate',deltaForPages(.3));
   let expected=1;
   const before=read();
   if(kind==='keyboard'){
    const changing=ws.changeWorkspaceWithID(spaces[3].uuid);await pause(25);
    event('MozSwipeGestureUpdate',deltaForPages(.6));event('MozSwipeGestureEnd');await changing;expected=3;
   }else if(kind==='queued'){
    const first=ws.changeWorkspaceWithID(spaces[2].uuid),second=ws.changeWorkspaceWithID(spaces[3].uuid);
    event('MozSwipeGestureStart');event('MozSwipeGestureUpdate',0);event('MozSwipeGestureEnd');await Promise.all([first,second]);
   }else if(kind==='reverse'){
    // Reverse after the original forward samples leave Arc's 100ms window.
    clock+=100;event('MozSwipeGestureUpdate',deltaForPages(.2));event('MozSwipeGestureUpdate',deltaForPages(.12));event('MozSwipeGesture');event('MozSwipeGestureEnd');
   }else{
    if(kind==='reduced-motion')Services.prefs.setIntPref('ui.prefersReducedMotion',1);
    event('MozSwipeGestureEnd');
   }
   await pause(1300);const settled=read();
   Services.prefs.clearUserPref('ui.prefersReducedMotion');
   cases.push({compact,kind,before,settled,expected,passed:settledAt(settled,expected)});
  }
 }
 return{input:'Synthetic SimpleGestureEvent with emulated ChromeOnly release flag; not physical/native input',cases,count:cases.length,passed:cases.every(c=>c.passed),failed:cases.filter(c=>!c.passed).map(c=>({compact:c.compact,kind:c.kind,from:c.from,settled:c.settled}))};
})().then(done,e=>done({error:String(e),stack:e.stack}));
