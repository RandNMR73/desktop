const done=arguments[arguments.length-1];
(async()=>{
 const w=Services.wm.getMostRecentWindow('navigator:browser'),d=w.document,x=w.__progressFixture;
 const pause=ms=>new Promise(r=>w.setTimeout(r,ms));const images=[];
 let index=0;
 for(const space of w.gZenWorkspaces.getWorkspaces()){
  await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid);
  for(const progress of [0,25,50,75,100]) {
   x.stopped=true;x._notifyChange();await pause(40);
   x.progress=progress;x.currentBytes=progress;x.stopped=false;x._notifyChange();await pause(450);
   const icon=d.getElementById('owned-progress-icon');
   icon.style.backgroundColor='white';
   await w.promiseDocumentFlushed(()=>true);
   const r=icon.getBoundingClientRect();const canvas=d.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=80;canvas.height=80;
   const ctx=canvas.getContext('2d');ctx.scale(2,2);ctx.drawWindow(w,r.x,r.y,40,40,'white');
   images.push({name:`actual-${index}-${progress}.png`,png:canvas.toDataURL().split(',')[1]});
   icon.style.removeProperty('background-color');
  }
  index++;
 }
 x.progress=50;x.currentBytes=50;x._notifyChange();await w.gZenWorkspaces.changeWorkspaceWithID(w.gZenWorkspaces.getWorkspaces()[0].uuid);
 return{rows:images,production_profile_used:false};
})().then(done,e=>done({error:String(e),stack:e.stack}));
