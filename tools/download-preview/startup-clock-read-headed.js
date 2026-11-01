const done=arguments[arguments.length-1];
const profile=Services.dirsvc.get('ProfD',Ci.nsIFile).path;if(!profile.includes('zen-region-colors-native-'))throw Error('Owned disposable profile required');
const w=Services.wm.getMostRecentWindow('navigator:browser'),m=w.__thumbnailClockMonitor;
if(!m)done({error:'No monitor'});else{m.stop();const frames=m.records.filter(r=>r.type==='frame');done({records:m.records,frames:frames.length,maxLag:Math.max(...frames.map(f=>f.lag)),maxQueueDelay:Math.max(...frames.map(f=>f.now-f.requested))});delete w.__thumbnailClockMonitor;}
