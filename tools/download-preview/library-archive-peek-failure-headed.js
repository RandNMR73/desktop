const done=arguments[arguments.length-1];
(async()=>{
if (!Services.dirsvc.get('ProfD', Ci.nsIFile).path.includes('zen-region-colors-native-')) throw new Error('Owned visual-test profile required');
const w=Services.wm.getMostRecentWindow('navigator:browser'),url=arguments[0]+'/home';
const delay=ms=>new Promise(r=>w.setTimeout(r,ms));
const until=async(f,n)=>{for(let i=0;i<1000;i++){if(f())return;await delay(20);}throw new Error(n);};
const checks=[];const check=(name,value)=>{checks.push({name,ok:!!value});if(!value)throw new Error(name);};
const mgr=w.gZenGlanceManager;
try{
const boosts=await mgr.openDetachedGlance({url,clientX:100,clientY:100,triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});
check('Boosts preview has no Expand',!w.document.querySelector('#zen-glance-detached .zen-glance-sidebar-open'));
await mgr.closeDetachedGlance();check('Boosts close resolves',await boosts.closed==='dismissed');
const tab=w.gBrowser.addTrustedTab(url,{skipAnimation:true});w.gBrowser.selectedTab=tab;await until(()=>tab.linkedBrowser.currentURI.spec===url&&!tab.linkedBrowser.webProgress.isLoadingDocument,'load');await w.gBrowser.TabStateFlusher.flush(tab.linkedBrowser);w.gBrowser.removeTab(tab,{animate:false});
await until(()=>w.SessionStore.getClosedTabData(w).some(r=>r.state.entries.some(e=>e.url===url)),'record');
const record=w.SessionStore.getClosedTabData(w).find(r=>r.state.entries.some(e=>e.url===url));
const lib=w.document.querySelector('zen-library');lib.activeTab='history';await lib.constructor.animateProgress(1);await until(()=>lib.openProgress===1&&!lib.hasAttribute('transitioning'),'Library');
const section=lib.querySelector('zen-library-history-section');section.searchQuery=url;section.onSearchChanged();await section.updateComplete;
section.querySelector('input').focus();section.querySelector('.zen-library-row').click();
await until(()=>mgr.detachedBrowser?.currentURI.spec===url&&w.document.querySelector('#zen-glance-detached .browserContainer[has-finished-animation]'),'Peek');
const browser=mgr.detachedBrowser,count=w.gBrowser.tabs.length,adopt=w.gBrowser.zenAdoptDetachedBrowser;
w.gBrowser.zenAdoptDetachedBrowser=()=>{throw new Error('Owned fixture: reject adoption');};
try{await mgr.expandDetachedGlance();}finally{w.gBrowser.zenAdoptDetachedBrowser=adopt;}
check('failed adoption keeps live preview',mgr.detachedBrowser===browser&&browser.currentURI.spec===url);
check('failed adoption keeps Library open',lib.openProgress===1);
check('failed adoption removes only staging tab',w.gBrowser.tabs.length===count);
check('failed adoption preserves Archive',w.SessionStore.getClosedTabData(w).some(r=>r.closedId===record.closedId));
await mgr.closeDetachedGlance();
section.querySelector('.zen-library-row').click();section.querySelector('.zen-library-row').click();
await until(()=>mgr.detachedBrowser?.currentURI.spec===url,'reopen');
check('repeated row click creates only one host',w.document.querySelectorAll('#zen-glance-detached').length===1);
await mgr.closeDetachedGlance();await delay(400);
check('closing while opening removes host',!mgr.detachedBrowser&&!w.document.querySelector('#zen-glance-detached'));
const invalid=await mgr.openDetachedGlance({url:'',triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});check('invalid preview leaves no host',invalid===null&&!mgr.detachedBrowser);
section.querySelector('input').focus();section.querySelector('.zen-library-row').click();await until(()=>mgr.detachedBrowser?.currentURI.spec===url,'review ready');
return {checks,readyForVisualReview:true,record:record.closedId,errors:Services.console.getMessageArray().map(x=>x.message).filter(x=>/XML Parsing|SyntaxError|Detached Peek/.test(x)).slice(-15)};
}catch(e){return {checks,error:String(e),stack:e.stack};}
})().then(done,e=>done({error:String(e)}));
