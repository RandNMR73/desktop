const done=arguments[arguments.length-1];
(async()=>{
 const w=Services.wm.getMostRecentWindow('navigator:browser'),d=w.document;
 const button=d.getElementById('zen-library-button'),list=d.getElementById('zen-library-download-list'),foot=d.getElementById('zen-sidebar-foot-buttons');
 const pause=ms=>new Promise(r=>w.setTimeout(r,ms));
 const event=(type,x,y)=>button.dispatchEvent(new w.MouseEvent(type,{clientX:x,clientY:y}));
 event('mouseleave',400,400);await pause(450);
 const r=button.getBoundingClientRect();event('mouseenter',r.x+r.width/2,r.y+r.height/2);
 for(let i=0;i<100&&!foot.hasAttribute('zen-library-stack-open');i++)await pause(5);
 const rows=[...list.children].filter(n=>!n.hidden),failures=[],traces=[];let checks=0;
 const check=(ok,msg)=>{checks++;if(!ok)failures.push(msg)};
 for(const row of rows){
  const style=w.getComputedStyle(row);
  check(style.transitionDelay==='0.15s','row interaction uses native global 150ms delay');
  const transition=row.getAnimations().find(a=>a.transitionProperty==='pointer-events');
  check(!!transition,'row interaction is actually gated by a CSS transition');
  if(transition){
   transition.pause();transition.currentTime=100;
   check(w.getComputedStyle(row).pointerEvents==='none','row cannot be clicked at 100ms');
   transition.currentTime=151;
   check(w.getComputedStyle(row).pointerEvents==='auto','row becomes clickable after 150ms');
   transition.finish();
  }
 }
 const {ZenDownloadMotion}=ChromeUtils.importESModule('moz-src:///zen/library/ZenDownloadMotion.sys.mjs');
 const host=d.createElement('div');d.documentElement.appendChild(host);
 const row=d.createElement('div');host.appendChild(row);
 const controller=new ZenDownloadMotion({document:d,matchMedia:()=>({matches:true})},[row]);
 await controller.setExpanded(true);check(row.getAnimations().length===0,'reduced motion opens without animation');
 await controller.setExpanded(false);check(row.getAnimations().length===0,'reduced motion closes without animation');
 await controller.setExpanded(true,{row,width:212,iconX:22,iconY:26,dx:6,dy:30,distance:20});
 check(row.getAnimations().length===0,'reduced motion completed badge opens without animation');
 await controller.setExpanded(false);check(row.getAnimations().length===0,'reduced motion completed badge closes without animation');
 controller.destroy();host.remove();
 return{checks,failures,traces,production_profile_used:false,test_method:'headed CSS transition inspection; reduced-motion controller with explicit media-query stub'};
})().then(done,e=>done({error:String(e),stack:e.stack}));
