import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { downloadArrivalSpring, downloadArrivalFrames, DOWNLOAD_ARRIVAL_SETTLING,
  ZenDownloadBadgeMotion } from "../../src/zen/library/ZenDownloadMotion.sys.mjs";

const reference=JSON.parse(fs.readFileSync(new URL("../../tools/download-preview/arrival-spring-reference.json",import.meta.url)));
test("arrival spring follows independently sampled SwiftUI values",()=>{
  assert.equal(DOWNLOAD_ARRIVAL_SETTLING,reference.settlingDuration);
  for (const p of reference.samples) assert.ok(Math.abs(downloadArrivalSpring(p.time)-p.value)<1e-12);
});
test("arrival keyframes preserve the native drop, hold, and spring within 0.002pt",()=>{
  const f=downloadArrivalFrames(), frames=f.badge;
  assert.equal(frames[0].easing,"cubic-bezier(0.78, 0, 0.7, 1)");
  assert.equal(frames[0].transform,"translateY(-8px)");
  assert.equal(frames[0].opacity,0);
  assert.ok(Math.abs(frames[1].offset*f.duration-200)<1e-10);
  assert.ok(Math.abs(frames[2].offset*f.duration-220)<1e-10);
  assert.equal(frames[1].transform,"translateY(12px)");
  assert.equal(f.button[1].translate,"0 6px");
  const value=frame=>Number(frame.transform.match(/translateY\(([^p]+)/)[1]);
  let max=0;
  for (let i=3;i<frames.length;i++) {
    const a=frames[i-1],b=frames[i];
    for (const portion of [.25,.5,.75]) {
      const time=(a.offset+(b.offset-a.offset)*portion)*f.duration/1000-.22;
      const actual=value(a)+(value(b)-value(a))*portion;
      max=Math.max(max,Math.abs(actual-12*(1-downloadArrivalSpring(time))));
    }
  }
  assert.ok(max<.002,String(max));assert.ok(frames.length<300,frames.length);
});

function fixture() {
  const animations=[];
  const element=()=>({animate(frames,options) {
    let resolve,reject;
    const a={frames,options,cancelled:false,finished:new Promise((yes,no)=>{resolve=yes;reject=no;}),
      complete:()=>resolve(),cancel(){this.cancelled=true;reject(new Error("cancelled"));}};
    animations.push(a);return a;
  }});
  const badge=element();badge.parentElement=element();const sprite=element();
  const w={document:{timeline:{currentTime:100}},matchMedia:()=>({matches:false}),
    getComputedStyle:()=>({transform:"none",opacity:"1"})};
  let changes=0,now=0,nextTimer=0;const timers=new Map();
  const clock={setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,at:now+delay});return id;},
    clearTimeout(id){timers.delete(id);},advance(ms){now+=ms;for(const [id,t]of timers)if(t.at<=now){timers.delete(id);t.fn();}}};
  const motion=new ZenDownloadBadgeMotion(w,badge,sprite,()=>changes++,clock);
  return {w,badge,sprite,motion,animations,clock,timers,get changes(){return changes;}};
}
const tick=async()=>{await Promise.resolve();await Promise.resolve();};
test("new selections arrive once and status updates retain their animation",async()=>{
  const f=fixture(),item={succeeded:false};f.motion.update(item);
  assert.equal(f.animations.length,2);assert.equal(f.motion.displayed,item);
  assert.ok(f.animations.every(a=>a.startTime===100));
  item.succeeded=true;f.motion.update(item);assert.equal(f.animations.length,2);
  for (const a of f.animations)a.complete();await tick();
  assert.equal(f.motion.displayed,item);assert.ok(f.animations.every(a=>a.cancelled));
  f.motion.destroy();
});
test("dismissal retains artwork through the fade and both native button pulses",async()=>{
  for (const succeeded of [false,true]) {
    const f=fixture(),item={succeeded};f.motion.reset(item);f.motion.update(null);
    const [badge,button]=f.animations;
    assert.equal(badge.options.duration,140);assert.equal(button.options.duration,370);
    assert.equal(badge.frames[1].transform,"translate(10px, 22px) rotate(-45deg) scale(0.2) translate(-20px, -20px)");
    assert.equal(badge.frames[1].opacity,0);
    for (const [time,scale] of [[0,1],[160,1],[260,1.2],[270,1.2],[370,1]]) {
      const frame=button.frames.find(p=>Math.abs(p.offset*370-time)<1e-8);
      assert.equal(frame?.transform,`scale(${scale})`);
    }
    badge.complete();await tick();assert.equal(f.motion.displayed,item);assert.equal(f.changes,0);
    button.complete();await tick();assert.equal(f.motion.displayed,item);
    f.clock.advance(390);assert.equal(f.motion.displayed,null);assert.equal(f.changes,1);
    f.motion.destroy();
  }
});
test("a replacement cancels old dismissal cleanup without clearing the new badge",async()=>{
  const f=fixture(),old={succeeded:true},next={};f.motion.reset(old);f.motion.update(null);
  const outgoing=[...f.animations];f.motion.update(next);
  assert.ok(outgoing.every(a=>a.cancelled));for(const a of outgoing)a.complete();await tick();
  assert.equal(f.motion.displayed,next);assert.equal(f.changes,0);f.motion.destroy();
});
test("expansion, initialization, reduced motion and removed items avoid stale arrival or dismissal",async()=>{
  for (const mode of ["expanded","initial","reduced","removed"]) {
    const f=fixture(),old={succeeded:true},next={};f.motion.reset(old);
    if(mode==="expanded")f.motion.update(next,{expanded:true});
    if(mode==="initial")f.motion.update(next,{animate:false});
    if(mode==="reduced"){f.w.matchMedia=()=>({matches:true});f.motion.update(next);}
    if(mode==="removed")f.motion.update(null,{canDismiss:false});
    assert.equal(f.animations.length,0,mode);assert.equal(f.motion.displayed,mode==="removed"?null:next);
    f.motion.destroy();
  }
  const f=fixture();f.motion.update({});f.motion.update(null,{expanded:true});
  assert.ok(f.animations[0].cancelled);assert.equal(f.motion.displayed,null);
  assert.equal(f.animations.at(-1).cancelled,false,"icon interpolation survives expansion");
  f.motion.destroy();await tick();assert.ok(f.animations.every(a=>a.cancelled));
});
test("destroyed views release all retained artwork and ignore late completion",async()=>{
  const f=fixture();f.motion.reset({succeeded:true});f.motion.update(null);f.motion.destroy();
  for(const a of f.animations)a.complete();await tick();
  assert.equal(f.motion.displayed,null);assert.equal(f.changes,0);assert.equal(f.motion.update({}),null);
});

test("dismissal geometry agrees with independent opaque SwiftUI hosting at display-pixel precision",()=>{
  const samples=JSON.parse(fs.readFileSync(new URL("../../tools/download-preview/dismissal-layout-reference.json",import.meta.url)));
  for(const p of samples){
    // SwiftUI's static layout snaps its offset to the 2x display pixel grid.
    assert.ok(Math.abs(p.x-(34-14*p.progress))<.25);
    assert.ok(Math.abs(p.y-(284+20*p.progress))<.01);
    const size=40*(p.initialScale+(.2-p.initialScale)*p.progress);
    assert.ok(Math.abs(Math.sqrt(p.area)-size)<.15);
  }
});

test("a background view clears on the native clock even when its compositor never completes",async()=>{
  const f=fixture(),old={succeeded:true};f.motion.reset(old);f.motion.update(null);
  f.clock.advance(389);assert.equal(f.motion.displayed,old);
  f.clock.advance(1);assert.equal(f.motion.displayed,null);assert.equal(f.changes,1);
  assert.ok(f.animations.every(a=>a.cancelled));assert.equal(f.timers.size,0);
  for(const a of f.animations)a.complete();await tick();assert.equal(f.changes,1);
  f.motion.destroy();
});
test("replacement and expansion cancel scheduled dismissal cleanup",()=>{
  for(const expanded of [false,true]){
    const f=fixture(),next={};f.motion.reset({succeeded:true});f.motion.update(null);
    f.motion.update(next,{expanded});f.clock.advance(1000);
    assert.equal(f.motion.displayed,next);assert.equal(f.changes,0);assert.equal(f.timers.size,0);
    f.motion.destroy();
  }
});
