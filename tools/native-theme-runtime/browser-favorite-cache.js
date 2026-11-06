const done=arguments[arguments.length-1];(async()=>{
const w=Services.wm.getMostRecentWindow('navigator:browser');
const {ZenFavoriteOutline}=ChromeUtils.importESModule('resource:///modules/zen/ZenFavoriteOutline.sys.mjs');
const pause=ms=>new Promise(r=>w.setTimeout(r,ms));
const cases=[], controllers=[], nodes=[];
const svg=color=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="13" fill="${color}"/></svg>`);
function harness(){
 const assignments=[];
 const facade={document:w.document,MutationObserver:w.MutationObserver,devicePixelRatio:w.devicePixelRatio,
  performance:w.performance,atob:w.atob.bind(w),getComputedStyle:w.getComputedStyle.bind(w),
  matchMedia:w.matchMedia.bind(w),setTimeout:w.setTimeout.bind(w),clearTimeout:w.clearTimeout.bind(w),
  addEventListener:w.addEventListener.bind(w),removeEventListener:w.removeEventListener.bind(w),
  gBrowser:{selectedTab:null,tabs:[],tabContainer:new w.EventTarget()},
  Image:function(){const image=new w.Image();const prop=Object.getOwnPropertyDescriptor(w.HTMLImageElement.prototype,'src');
   Object.defineProperty(image,'src',{get(){return prop.get.call(image)},set(value){if(value)assignments.push({kind:value.startsWith('data:image/png;')?'border':'source',time:w.performance.now()});prop.set.call(image,value)}});return image;}
 };
 const outline=new ZenFavoriteOutline(facade);controllers.push(outline);
 function tab(source){const t=w.document.createXULElement('hbox'),i=w.document.createElementNS('http://www.w3.org/1999/xhtml','img');
  t.setAttribute('zen-essential','true');t.setAttribute('image',source);i.className='tab-icon-image';i.style.cssText='width:16px;height:16px;filter:none;content:normal';t.append(i);
  t.style.cssText='position:fixed;left:500px;top:300px;width:47px;height:47px;pointer-events:none';w.document.documentElement.append(t);nodes.push(t);facade.gBrowser.tabs.push(t);return t;
 }
 return {outline,facade,tab,assignments};
}
async function ready(h,t){const start=w.performance.now();h.outline.invalidate(t);while(!t.hasAttribute('zen-favorite-outline-ready')&&w.performance.now()-start<7000)await pause(1);return {ready:t.hasAttribute('zen-favorite-outline-ready'),elapsed:w.performance.now()-start,loads:h.assignments.slice(),image:t.style.getPropertyValue('--zen-favorite-outline-image')}};
try{
 const a=harness();const colors=['#ff1c12','#136bfa','#08b947','#fb9420','#be37c2','#f3d520'];const images=[];
 for(const color of colors){const first=await ready(a,a.tab(svg(color)));images.push(first.image);cases.push({phase:'cold',color,...first,image:undefined});}
 a.outline.destroy();
 const b=harness();
 for(let n=0;n<colors.length;n++){const start=b.assignments.length;const second=await ready(b,b.tab(svg(colors[n])));cases.push({phase:'cached',color:colors[n],...second,image:undefined,loads:b.assignments.slice(start),samePixels:second.image===images[n]});}
 return {pass:cases.every(c=>c.ready&&(c.phase!=='cached'||(c.samePixels&&c.loads.every(l=>l.kind==='border')))),cases};
}finally{for(const c of controllers)c.destroy();for(const n of nodes)n.remove();}
})().then(done,e=>done({error:String(e),stack:e.stack}));
