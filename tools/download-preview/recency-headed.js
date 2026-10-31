const done=arguments[arguments.length-1];
(async()=>{
 const w=Services.wm.getMostRecentWindow('navigator:browser'), d=w.document;
 const button=d.getElementById('zen-library-button'), list=d.getElementById('zen-library-download-list'), foot=d.getElementById('zen-sidebar-foot-buttons');
 let checks=0;const failures=[],rows=[];
 const check=(ok,message)=>{checks++;if(!ok)failures.push(message)};
 const pause=ms=>new Promise(r=>w.setTimeout(r,ms));
 const enter=n=>{const r=n.getBoundingClientRect();n.dispatchEvent(new w.MouseEvent('mouseenter',{clientX:r.x+r.width/2,clientY:r.y+r.height/2}))};
 const leave=(n,into)=>{const r=into?.getBoundingClientRect();n.dispatchEvent(new w.MouseEvent('mouseleave',{clientX:r?r.x+r.width/2:350,clientY:r?r.y+r.height/2:400,relatedTarget:into||null}))};
 for(const space of w.gZenWorkspaces.getWorkspaces()){
  await w.gZenWorkspaces.changeWorkspaceWithID(space.uuid);enter(button);await pause(650);
  for(let i=0;i<50&&!foot.hasAttribute('zen-library-stack-open');i++)await pause(100);
  check(foot.hasAttribute('zen-library-stack-open'),space.name+': hover opens');
  await Promise.allSettled(list.getAnimations({subtree:true}).map(a=>a.finished));
  await w.promiseDocumentFlushed(()=>true);
  const visible=[...list.children].filter(n=>!n.hidden);check(visible.length===4,space.name+': four entries');
  check(visible.map(n=>n.querySelector('.zen-library-download-list-title').textContent).join('|')==='recency-3.json|recency-2.json|recency-1.json|recency-0.json',space.name+': newest modified files, newest at bottom');
  const shown=visible.map(n=>{const icon=n.querySelector('.zen-library-download-badge'),title=n.querySelector('.zen-library-download-list-title'),subtitle=n.querySelector('.zen-library-download-list-subtitle');return{rect:n.getBoundingClientRect().toJSON(),icon:icon.getBoundingClientRect().toJSON(),title:title.getBoundingClientRect().toJSON(),subtitle:subtitle.textContent,preview:icon.hasAttribute('preview'),font:w.getComputedStyle(title).font,color:w.getComputedStyle(list).color}});
  for(const [i,s]of shown.entries()){
   check(s.subtitle===`${4-i} day${4-i===1?'':'s'} ago`,space.name+': modification age label');
   check(s.icon.width===40&&s.icon.height===40,space.name+': 40pt thumbnail');
   check(s.icon.x===8&&s.title.x===60,space.name+': leading offsets');
   check(s.title.width===146,space.name+': title truncates at reference inset');
   if(i)check(s.rect.y-shown[i-1].rect.y===56,space.name+': 56pt pitch');
   check(!/localhost|bytes|KB|MB/.test(s.subtitle),space.name+': relative time only');
  }
  check(w.getComputedStyle(list).backgroundColor==='rgba(0, 0, 0, 0)',space.name+': transparent background');
  leave(button,list);await pause(80);enter(list);await pause(250);
  check(foot.hasAttribute('zen-library-stack-open'),space.name+': moving onto flyout retains it');
  leave(list);await pause(300);check(!foot.hasAttribute('zen-library-stack-open'),space.name+': leave closes');
  enter(button);await pause(100);leave(button);await pause(80);enter(button);await pause(250);
  check(foot.hasAttribute('zen-library-stack-open'),space.name+': re-entry cancels close');
  leave(button);await pause(300);rows.push({space:space.name,shown});
 }
 const {ZenDownloadPreview}=ChromeUtils.importESModule('moz-src:///zen/library/ZenDownloadPreview.sys.mjs');
 const native=new ZenDownloadPreview(w);const now=Date.now();
 check(native.date(now-5*86400000,now)==='5 days ago','native relative days');
 check(native.date(now-21*3600000,now)==='21 hours ago','native relative hours');
 const image=await native.thumbnail(list.children[3].download);
 check(image?.url.startsWith('data:image/png;base64,'),'native document thumbnail rendered');
 check(image?.preview===true,'document uses preview instead of generic icon');native.destroy();
 await w.gZenWorkspaces.changeWorkspaceWithID(w.gZenWorkspaces.getWorkspaces()[0].uuid);enter(button);await pause(500);
 return {checks,failures,rows,production_profile_used:false,hover_method:'DOM mouseenter/mouseleave in disposable profile'};
})().then(done,e=>done({error:String(e),stack:e.stack}));
