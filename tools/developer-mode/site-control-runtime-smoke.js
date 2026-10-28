// Async chrome-context body; w must be a disposable candidate window.
// Start site-control-fixture.py, then set w.siteCaptureFixtureBase to its
// loopback URL. Optionally set w.captureEvidenceDir to a private directory.
if (!Services.prefs.getBoolPref("zen.developer-mode.fixture-tests", false))
  throw new Error("Use a disposable fixture profile");
const base = new URL(w.siteCaptureFixtureBase);
if (base.protocol !== "http:" || base.hostname !== "127.0.0.1")
  throw new Error("Use the local synthetic fixture");
const {ZenWindowCapture}=ChromeUtils.importESModule('resource:///modules/ZenWindowCapture.sys.mjs');
const originalSpace=w.gZenWorkspaces.activeWorkspace,old=w.gBrowser.selectedTab;
const results=[];
const pixel=(ctx,x,y)=>Array.from(ctx.getImageData(x,y,1,1).data).slice(0,3);
const check=(ok,reason)=>{if(!ok)throw Error(reason);};
try {
for(const [index,space] of w.gZenWorkspaces.getWorkspaces().entries()){
 await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid);
 for(const mode of ['normal','rtl','zoom']){
  const url=base.origin+'/full?'+(mode==='rtl'?'rtl=1&wide=1':'');
  const tab=w.gBrowser.addTrustedTab(url);w.gBrowser.selectedTab=tab;
  const browser=tab.linkedBrowser;
  const capture=new ZenWindowCapture(w);
  try{
   const deadline=Date.now()+10000;
   while(browser.currentURI.spec!==url||browser.webProgress.isLoadingDocument){if(Date.now()>deadline)throw Error('load timeout');await new Promise(r=>w.setTimeout(r,25));}
   if(mode==='zoom')browser.fullZoom=1.25;
   await new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)));
   const start=w.performance.now();
   const shot=await capture.capture(browser,{fullPage:true});
   const blob=await shot.png();
   const image=await w.createImageBitmap(blob);
   const canvas=new w.OffscreenCanvas(image.width,image.height);
   const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);image.close();
   const points=[[8,8],[canvas.width-8,8],[8,canvas.height-8],[canvas.width-8,canvas.height-8]];
   const samples=points.map(([x,y])=>pixel(ctx,x,y));
   const expected=[[255,0,0],[0,255,0],[0,0,255],[255,0,255]];
   check(JSON.stringify(samples)===JSON.stringify(expected),`corner colors space ${index+1}/${mode}: ${JSON.stringify(samples)}`);
   const scale=mode==='zoom'?2.5:2;
   check(canvas.height===2400*scale,'full height '+canvas.height);
   if(mode==='rtl')check(canvas.width===4400,'RTL full width '+canvas.width);
   const gradientSample=pixel(ctx,Math.round(140*scale),Math.round(140*scale));
   const copied=await shot.copy();check(copied,'clipboard failed');
   const entry={space:index+1,mode,width:canvas.width,height:canvas.height,cornerColors:samples,copied,elapsedMs:w.performance.now()-start,gradientSample};
   results.push(entry);
   canvas.width=canvas.height=0;
  }finally{capture.destroy();if(tab.isConnected)w.gBrowser.removeTab(tab,{animate:false});}
 }
}
if (w.captureEvidenceDir) await IOUtils.writeJSON(w.captureEvidenceDir+'/capture-spaces.json',results);
return results;
}finally{await w.gZenWorkspaces.changeWorkspaceWithID(originalSpace);if(old.isConnected)w.gBrowser.selectedTab=old;}
