const w=Services.wm.getMostRecentWindow('navigator:browser');
const {downloadBadgeFrames,retargetDownloadMotion}=ChromeUtils.importESModule('moz-src:///zen/library/ZenDownloadMotion.sys.mjs');
const rest=value=>({value,target:value,velocity:0,start:0,end:0,previous:null});
const times=[];let frames;
for(let i=0;i<20;i++){const start=w.performance.now();frames=downloadBadgeFrames(retargetDownloadMotion(rest(0),1,0),retargetDownloadMotion(rest(1),1,0),0,{width:214,iconX:22,iconY:26,dx:6,dy:30,distance:20});times.push(w.performance.now()-start)}
times.sort((a,b)=>a-b);arguments[arguments.length-1]({medianMs:times[10],maxMs:times.at(-1),keyframes:frames.row.length});
