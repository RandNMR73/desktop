const done=arguments[arguments.length-1];
(async()=>{
 const profile=Services.dirsvc.get('ProfD',Ci.nsIFile).path;
 if(!profile.includes('zen-region-colors-native-'))throw Error('Owned disposable profile required');
 const w=Services.wm.getMostRecentWindow('navigator:browser'),d=w.document;
 const button=d.getElementById('zen-library-button'),list=d.getElementById('zen-library-download-list'),foot=d.getElementById('zen-sidebar-foot-buttons');
 for(const popup of d.querySelectorAll('.zen-library-download-menu'))if(popup.state==='open')popup.hidePopup();
 const pause=ms=>new Promise(r=>w.setTimeout(r,ms));
 const event=(type,x,y)=>button.dispatchEvent(new w.MouseEvent(type,{clientX:x,clientY:y}));
 event('mouseleave',400,400);await pause(450);
 const r=button.getBoundingClientRect();event('mouseenter',r.x+r.width/2,r.y+r.height/2);
 for(let i=0;i<100&&!foot.hasAttribute('zen-library-stack-open');i++)await pause(5);
 const rows=[...list.children].filter(n=>!n.hidden),failures=[],traces=[];let checks=0;
 const check=(ok,msg)=>{checks++;if(!ok)failures.push(msg)};
 for(const row of rows){
  const target=row.querySelector('.zen-library-download-hit-target');
  const style=w.getComputedStyle(target);
  check(style.transitionDelay==='0.15s','row interaction uses native global 150ms delay');
  const transition=target.getAnimations().find(a=>a.transitionProperty==='pointer-events');
  check(!!transition,'row interaction is actually gated by a CSS transition');
  if(transition){
   transition.pause();transition.currentTime=100;
   check(w.getComputedStyle(target).pointerEvents==='none','row cannot be clicked at 100ms');
   transition.currentTime=151;
   check(w.getComputedStyle(target).pointerEvents==='auto','row becomes clickable after 150ms');
   transition.finish();
  }
 }
 const {ZenDownloadThumbnails}=ChromeUtils.importESModule('moz-src:///zen/library/ZenDownloadThumbnailMotion.sys.mjs');
 const host=d.createElement('div');d.documentElement.appendChild(host);
 const row=rows[0].cloneNode(true);row.download={target:{path:'owned-reduced-motion'},succeeded:false};host.appendChild(row);
 let frames=0;
 const controller=new ZenDownloadThumbnails({document:d,performance:w.performance,matchMedia:()=>({matches:true}),
  requestAnimationFrame(){frames++;return frames;},cancelAnimationFrame(){}},d.createElement('div'),()=>{},
  {setTimeout(){throw Error('Reduced motion must not schedule a timer');},clearTimeout(){}});
 controller.sync([row],row.download);
 await controller.setExpanded(true);check(frames===0&&row.style.opacity==='1','reduced motion opens without animation');
 await controller.setExpanded(false);check(frames===0&&row.style.transform.includes('scale(0.8)'),'reduced motion closes at the active size');
 row.download.succeeded=true;controller.sync([row],row.download);
 await controller.setExpanded(true);check(frames===0&&row.style.opacity==='1','reduced motion completed badge opens without animation');
 await controller.setExpanded(false);check(frames===0&&row.style.opacity==='0','reduced motion consumes the completed badge');
 controller.destroy();host.remove();
 return{checks,failures,traces,production_profile_used:false,test_method:'headed CSS transition inspection; reduced-motion controller with explicit media-query stub'};
})().then(done,e=>done({error:String(e),stack:e.stack}));
