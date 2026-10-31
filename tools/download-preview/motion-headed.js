const done=arguments[arguments.length-1];
(async()=>{
 const w=Services.wm.getMostRecentWindow('navigator:browser'),d=w.document;
 const button=d.getElementById('zen-library-button'),list=d.getElementById('zen-library-download-list'),foot=d.getElementById('zen-sidebar-foot-buttons');
 const pause=ms=>new Promise(r=>w.setTimeout(r,ms)),open=()=>foot.hasAttribute('zen-library-stack-open');
 const center=n=>{const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}},outside={x:400,y:400};
 const event=(n,type,p)=>n.dispatchEvent(new w.MouseEvent(type,{clientX:p.x,clientY:p.y}));
 const enter=()=>event(button,'mouseenter',center(button)),leave=()=>event(button,'mouseleave',outside);
 const rows=()=>[...list.children].filter(n=>!n.hidden);
 const motion=n=>n.getAnimations().find(a=>a.effect.getKeyframes().some(k=>k.transform));
 const until=async fn=>{for(let i=0;i<100&&!fn();i++)await pause(10)};
 let checks=0;const failures=[],traces=[];const check=(ok,msg)=>{checks++;if(!ok)failures.push(msg)};
 enter();await until(open);await pause(600);leave();await pause(400);
 enter();await until(open);const visible=rows(),animations=visible.map(motion);
 check(animations.every(Boolean),'every row uses compositor animation');
 check(animations.every(a=>a.startTime===animations[0].startTime),'row animations share one timeline origin');
 for(const [i,a]of animations.entries()){
  const index=3-i;check(Math.abs(a.effect.getTiming().duration-(292.0116798274432+index*12.5))<.001,'native duration plus 12.5ms stagger');
  a.pause();a.currentTime=0;
 }
 await w.promiseDocumentFlushed(()=>true);
 for(const [i,n]of visible.entries()){
  check(Math.abs(new w.DOMMatrix(w.getComputedStyle(n).transform).f-(i===3?20:56))<.01,'native 20/56pt starting offset');
  check(Number(w.getComputedStyle(n).opacity)===0,'collapsed opacity is zero');
 }
 for(const a of animations)a.currentTime=50;
 await w.promiseDocumentFlushed(()=>true);
 const native=(t)=>{const o=2*Math.PI/.15,a=o*.86,b=o*Math.sqrt(1-.86*.86);return 1-Math.exp(-a*t)*(Math.cos(b*t)+a/b*Math.sin(b*t))};
 for(const [i,n]of visible.entries()){
  const t=(50-(3-i)*12.5)/1000,v=native(t),distance=i===3?20:56;
  check(Math.abs(new w.DOMMatrix(w.getComputedStyle(n).transform).f-distance*(1-v))<.02,'rendered 50ms sample matches native spring');
  check(Math.abs(Number(w.getComputedStyle(n).opacity)-v)<.001,'rendered fade follows native spring');
 }
 for(const a of animations)a.finish();await pause(30);leave();await pause(400);
 enter();await until(open);await pause(50);
 const bottom=rows().at(-1),before=motion(bottom),t=d.timeline.currentTime-before.startTime;
 const oldFrames=before.effect.getKeyframes(),lerp=(frames,f)=>{
  let b=frames.findIndex(k=>k.offset>=f);if(b<=0)return frames[0];const a=frames[b-1];b=frames[b];const alpha=(f-a.offset)/(b.offset-a.offset);return{y:new w.DOMMatrix(a.transform).f*(1-alpha)+new w.DOMMatrix(b.transform).f*alpha};
 };
 const expected=lerp(oldFrames,t/before.effect.getTiming().duration).y;leave();
 const closing=motion(bottom),frames=closing.effect.getKeyframes();
 check(Math.abs(new w.DOMMatrix(frames[0].transform).f-expected)<.03,'reversal starts at current rendered trajectory');
 const omega=2*Math.PI/.15,alpha=omega*.86,beta=omega*Math.sqrt(1-.86*.86),seconds=t/1000;
 const incomingValue=native(seconds),incomingVelocity=Math.exp(-alpha*seconds)*omega*omega/beta*Math.sin(beta*seconds);
 const next=frames[1].offset*closing.effect.getTiming().duration/1000;
 const expectedValue=Math.exp(-alpha*next)*(incomingValue*Math.cos(beta*next)+(incomingVelocity+alpha*incomingValue)/beta*Math.sin(beta*next));
 check(Math.abs(new w.DOMMatrix(frames[1].transform).f-20*(1-expectedValue))<.02,'closing retains native incoming position and velocity at the actual sampled age');
 traces.push({reversalAfterMs:t,incomingVelocity,initialY:new w.DOMMatrix(frames[0].transform).f,nextY:new w.DOMMatrix(frames[1].transform).f});
 enter();await until(open);leave();await pause(100);
 check(foot.hasAttribute('zen-library-stack-closing'),'old completion cannot hide a newer close');
 await pause(300);check(!foot.hasAttribute('zen-library-stack-closing'),'latest close releases its lifecycle flag');
 check(w.getComputedStyle(list).visibility==='hidden','closed preview leaves no visible hit surface');
 const elapsed=[];
 // Use the exported controller on detached test rows to measure scheduling
 // overhead without repeating directory scans or touching production data.
 const {ZenDownloadMotion}=ChromeUtils.importESModule('moz-src:///zen/library/ZenDownloadMotion.sys.mjs');
 const host=d.createElement('div');d.documentElement.appendChild(host);
 const testRows=Array.from({length:4},()=>{const n=d.createElement('div');host.appendChild(n);return n});
 const controller=new ZenDownloadMotion(w,testRows);
 for(let i=0;i<20;i++){const start=w.performance.now();controller.setExpanded(i%2===0);elapsed.push(w.performance.now()-start)}
 controller.destroy();host.remove();elapsed.sort((a,b)=>a-b);
 traces.push({fourRowScheduleMedianMs:elapsed[10],fourRowScheduleMaxMs:elapsed.at(-1),perFrameJavaScript:false});
 return{checks,failures,traces,production_profile_used:false,reference:'Arc read-only spring/offset/delay trace + native SwiftUI.Spring samples',test_method:'headed animation inspection and coordinate-bearing DOM hover events'};
})().then(done,e=>done({error:String(e),stack:e.stack}));
