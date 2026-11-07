// Disposable five-Space fixture only. This emulates the new native event fields;
// it is not a physical-input test. See SPACE-TRANSITIONS.md.
const done=arguments[arguments.length-1];
(async()=>{
 const w=Services.wm.getMostRecentWindow('navigator:browser'),ws=w.gZenWorkspaces;
 const pause=ms=>new Promise(r=>w.setTimeout(r,ms)), spaces=ws.getWorkspaces(),cases=[];
 let clock=1000,nativeOffset=0;
 const event=(type,delta=0)=>{
  if(type==='MozSwipeGestureStart')nativeOffset=0;
  const e=w.document.createEvent('SimpleGestureEvent');
  e.initSimpleGestureEvent(type,true,true,w,0,0,0,0,0,false,false,false,false,0,null,0,w.SimpleGestureEvent.DIRECTION_RIGHT,delta+nativeOffset,0);
  Object.defineProperty(e,'swipeConsumerHandlesRelease',{value:false,writable:true});
  Object.defineProperty(e,'swipeProgressOffset',{value:0,writable:true});
  Object.defineProperty(e,'timeStamp',{value:clock});clock+=16;
  w.gNavToolbox.dispatchEvent(e);nativeOffset+=e.swipeProgressOffset;return{owned:e.swipeConsumerHandlesRelease,delta,offset:e.swipeProgressOffset};
 };
 const read=()=>({active:ws.activeWorkspace,add:w.document.querySelector('.zen-swipe-add-space-container')?.style.translate,
  opacity:w.document.querySelector('.zen-swipe-add-space-background')?.style.opacity,
  library:w.document.querySelector('zen-library')?.openProgress,
  offsets:spaces.map(s=>ws.workspaceElement(s.uuid).style.transform)});
 for(const compact of [false,true]){
  w.gZenCompactModeManager.preference=compact;w.gNavToolbox.toggleAttribute('zen-user-show',compact);await pause(200);
  for(const edge of ['new-space','library']){
  const sign=edge==='library'?-1:1,target=edge==='library'?0:spaces.length-1;
  await ws.changeWorkspaceWithID(spaces[target-sign].uuid);
  const switching=ws.changeWorkspaceWithID(spaces[target].uuid);await pause(80);
  const initialOffset=parseFloat(ws.workspaceElement(spaces[target].uuid).style.transform.slice(11))/100;
  const width=ws.workspaceElement(spaces[target].uuid).getBoundingClientRect().width;
  const perPage=-width*200/(Services.prefs.getIntPref('widget.swipe.pixel_size',550)*Services.prefs.getIntPref('zen.workspaces.swipe-actions.delta-multiplier'));
  event('MozSwipeGestureStart');await switching;
  const crosses=event('MozSwipeGestureUpdate',perPage*(initialOffset+.02*sign)),first=read();
  const duplicate=event('MozSwipeGestureUpdate',perPage*(initialOffset+.02*sign)),second=read();
  event('MozSwipeGestureUpdate',-nativeOffset);event('MozSwipeGestureEnd');await pause(1200);
  event('MozSwipeGestureStart');event('MozSwipeGestureUpdate',perPage*.02*sign);const reference=read();
  event('MozSwipeGestureUpdate',0);event('MozSwipeGestureEnd');await pause(200);
  const key=edge==='library'?'library':'opacity';
  const duplicateStable=JSON.stringify({...first,library:0})===JSON.stringify({...second,library:0})&&Math.abs((first.library||0)-(second.library||0))<1e-12;
  cases.push({compact,edge,initialOffset,crosses,duplicate,first,second,reference,duplicateStable,entryMatches:Math.abs(Number(first[key])-Number(reference[key]))<1e-6});
  }
 }
 return{cases,count:cases.length,stable:cases.every(c=>c.duplicateStable&&c.entryMatches)};
})().then(done,e=>done({error:String(e),stack:e.stack}));
