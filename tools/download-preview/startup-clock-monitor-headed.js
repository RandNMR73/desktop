const done=arguments[arguments.length-1];
(async()=>{
 const profile=Services.dirsvc.get('ProfD',Ci.nsIFile).path;if(!profile.includes('zen-region-colors-native-'))throw Error('Owned profile required');
 const w=Services.wm.getMostRecentWindow('navigator:browser'),d=w.document;
 const {ZenDownloadThumbnails}=ChromeUtils.importESModule('moz-src:///zen/library/ZenDownloadThumbnailMotion.sys.mjs');
 if(w.__thumbnailClockMonitor)throw Error('Monitor already installed');
 const records=[];const stamp=type=>({type,now:w.performance.now(),timeline:d.timeline.currentTime,visibility:d.visibilityState,focus:d.hasFocus()});
 const request=w.requestAnimationFrame,prototype=ZenDownloadThumbnails.prototype,sync=prototype.sync,expand=prototype.setExpanded;
 w.requestAnimationFrame=function(callback){
  if(!new Error().stack.includes('ZenDownloadThumbnailMotion.sys.mjs'))return request.call(w,callback);
  const requested=w.performance.now();
  return request.call(w,time=>{records.push({...stamp('frame'),requested,timestamp:time,lag:w.performance.now()-time});callback(time);});
 };
 prototype.sync=function(...args){records.push({...stamp('sync'),count:args[0].length});return sync.apply(this,args);};
 prototype.setExpanded=function(expanded){records.push({...stamp('expand'),expanded});return expand.call(this,expanded);};
 w.__thumbnailClockMonitor={records,stop(){w.requestAnimationFrame=request;prototype.sync=sync;prototype.setExpanded=expand;}};
 records.push(stamp('installed'));return{monitor:true,...records[0]};
})().then(done,e=>done({error:String(e),stack:e.stack}));
