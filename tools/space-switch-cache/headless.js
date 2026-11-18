const [ownedProfile] = arguments;
const pause = ms => new Promise(r => w.setTimeout(r, ms));
await w.SessionStore.promiseAllWindowsRestored;
await w.gZenWorkspaces.promiseInitialized;
const manager = w.gZenWorkspaces, tabs = [], ids = [manager.activeWorkspace];
const names = new Map();
const add = () => {
  const tab = w.gBrowser.addTrustedTab('about:blank', {skipAnimation:true});
  names.set(tab, `tab-${tabs.length + 1}`); tabs.push(tab); return tab;
};
for (let i = 0; i < 4; i++) {
  if (i) ids.push((await manager.createAndSaveWorkspace(`Owned audit Space ${i}`)).uuid);
  for (let n = 0; n < 4; n++) add();
}
await pause(500);
const restore = [], phases = [], checks = [];
const check = (name, ok, details) => checks.push({name, ok:!!ok, ...(ok ? {} : {details})});
let current = null;
const stack = () => new Error().stack.split('\n').slice(2,9).join('\n');
function wrap(object, name, before) {
  const original = object[name], own = Object.getOwnPropertyDescriptor(object, name);
  object[name] = function(...args) { if (current) before.call(this, args); return original.apply(this,args); };
  restore.push(() => own ? Object.defineProperty(object,name,own) : delete object[name]);
}
let prototype = manager;
while (!Object.getOwnPropertyDescriptor(prototype,'allStoredTabs')) prototype = Object.getPrototypeOf(prototype);
const stored = Object.getOwnPropertyDescriptor(prototype,'allStoredTabs');
Object.defineProperty(manager,'allStoredTabs',{configurable:true,get(){
  const missing = !this._allStoredTabs;
  const result = stored.get.call(this);
  if (current && missing) current.rebuilds.push({tabs:result.length, stack:stack()});
  return result;
}});
restore.push(() => delete manager.allStoredTabs);
wrap(w.gBrowser.tabContainer,'_invalidateCachedTabs',function(){current.invalidations.push({populated:!!manager._allStoredTabs,stack:stack()});});
for (const method of ['_organizeWorkspaceStripLocations','makeSureEmptyTabIsFirst','updateTabsContainers']) {
  wrap(manager,method,()=>{current.calls[method]=(current.calls[method]||0)+1;});
}
wrap(w.gBrowser.tabContainer,'observe',()=>{current.calls.observe=(current.calls.observe||0)+1;});
for (const id of ids) {
  const element = manager.workspaceElement(id);
  for (const type of ['overflow','underflow']) {
    const listener = () => {if(current) current.overflow.push({space:ids.indexOf(id),type,active:element.active});};
    element.scrollbox.addEventListener(type,listener);
    restore.push(()=>element.scrollbox.removeEventListener(type,listener));
  }
}
function instrumentTabs() {
  for (const tab of tabs) {
    if (tab._ownedAuditObserved) continue;
    tab._ownedAuditObserved = true;
    wrap(tab,'querySelector',function(args){
      const selector=String(args[0]);
      current.selectors[selector]=(current.selectors[selector]||0)+1;
      if(selector==='tab[zen-glance-tab]') { const key=stack(); current.queryStacks[key]=(current.queryStacks[key]||0)+1; }
    });
  }
}
const snapshot = () => ({order:w.gBrowser.tabs.map(t=>names.get(t)||'empty'), visible:w.gBrowser.visibleTabs.map(t=>names.get(t)||'empty'), styles:ids.map(id=>({active:manager.workspaceElement(id).active,transform:w.getComputedStyle(manager.workspaceElement(id)).transform,separatorHidden:manager.workspaceElement(id).pinnedTabsContainer.hasAttribute('hide-separator')})),active:ids.indexOf(manager.activeWorkspace),selected:names.get(w.gBrowser.selectedTab)||'other',
  perSpace:ids.map(id=>[...manager.workspaceElement(id).querySelectorAll('tab')].filter(t=>names.has(t)).map(t=>names.get(t))),
  connected:tabs.filter(t=>t.isConnected).length,
  positions:tabs.map(t=>({name:names.get(t),index:t._index,pPos:t._pPos,workspace:ids.indexOf(t.getAttribute('zen-workspace-id'))}))});
async function phase(name, action) {
  current={name,tabCount:tabs.length,invalidations:[],rebuilds:[],calls:{},overflow:[],selectors:{},queryStacks:{}};
  await action(); await pause(200);
  const result=current; current=null; result.state=snapshot(); phases.push(result);
  await IOUtils.writeUTF8(PathUtils.join(ownedProfile,'audit-progress.json'),JSON.stringify(phases));
}
try {
  for (const count of [4,20]) {
    if (count===20) {
      for (const id of ids) {await manager.changeWorkspaceWithID(id);for(let n=4;n<count;n++)add();}
      await pause(500);
    }
    instrumentTabs();
    if (snapshot().perSpace.some(rows=>rows.length!==count)) throw Error("Incorrect tab distribution");
    await phase(`idle-${count}`,async()=>{await pause(200);});
    for (let i=0;i<4;i++) await phase(`switch-${count}-${i}`,async()=>{await manager.changeWorkspaceWithID(ids[i]);if(manager.activeWorkspace!==ids[i])throw Error("Destination did not become active");});
    await phase(`same-space-${count}`,()=>manager.changeWorkspaceWithID(ids[3]));
  }
  check('80 owned tabs remained connected during count phases', tabs.length===80&&tabs.every(t=>t.isConnected));
  const rows=ids.map(id=>tabs.filter(t=>t.getAttribute('zen-workspace-id')===id));
  for(let i=0;i<4;i++) for(let p=0;p<[0,1,2,0][i];p++) w.gBrowser.pinTab(rows[i][p]);
  const favorite=add(); names.set(favorite,'shared-favorite');
  await w.gZenPinnedTabManager.addToEssentials(favorite);
  const folder=w.gZenFolders.createFolder(rows[2].slice(0,2),{renameFolder:false,label:'Owned cache folder',collapsed:false,workspaceId:ids[2]});
  await pause(300);
  check('folder and Favorite connected',folder.isConnected&&favorite.hasAttribute('zen-essential'));
  function positionsCorrect() {
    let index=0,pPos=0;const seen=new Set();
    for(const tab of w.gBrowser.tabs) {
      const group=g=>{if(!g)return true;if(!group(g.group))return false;if(!seen.has(g)){seen.add(g);if(g._pPos!==pPos++)return false;}return true;};
      if(!group(tab.group)||tab.index!==index++||(!tab.hasAttribute('zen-empty-tab')&&tab._pPos!==pPos++))return false;
    }return true;
  }
  async function switchChecked(space,options={},name=`behavior-switch-${space}`) {
    await phase(name,()=>manager.changeWorkspaceWithID(ids[space],options));
    check(`${name}: destination references`,manager.activeWorkspace===ids[space]&&w.gBrowser.pinnedTabsContainer===manager.workspaceElement(ids[space]).pinnedTabsContainer&&w.gBrowser.tabContainer.pinnedTabsContainer===w.gBrowser.pinnedTabsContainer);
    check(`${name}: one active Space`,ids.filter(id=>manager.workspaceElement(id).active).length===1);
    check(`${name}: positions`,positionsCorrect());
  }
  w.gBrowser.selectedTab=favorite;
  for(const i of [0,1,2,3]) {await switchChecked(i);check(`favorite retained ${i}`,w.gBrowser.selectedTab===favorite);}
  await switchChecked(2,{selectTab:rows[2][3]},'explicit-folder-space');
  check('explicit tab selected',w.gBrowser.selectedTab===rows[2][3]);
  await switchChecked(2,{alwaysChange:true},'forced-same-space');
  await switchChecked(1,{whileScrolling:true,selectTab:rows[1][3]},'scrolling-space');
  const parent=rows[1][3],child=add();names.set(child,'owned-peek');
  w.gBrowser.selectedTab=parent;
  await w.gZenGlanceManager.openGlance({url:'about:blank',clientX:0,clientY:0,width:0,height:0},child,parent);
  await pause(150);
  check('real Peek opened under parent',parent.glanceTab===child&&child.hasAttribute('zen-glance-tab'));
  await switchChecked(0,{},'away-with-peek');
  await switchChecked(1,{selectTab:parent},'return-with-peek');
  check('Peek remains in destination membership',w.gBrowser.tabs.includes(child)&&parent.glanceTab===child);
  await w.gZenGlanceManager.fullyOpenGlance();await pause(200);
  check('Peek expansion keeps child as ordinary tab',child.isConnected&&!child.hasAttribute('zen-glance-tab')&&!parent.glanceTab&&w.gBrowser.tabs.includes(child));
  const closeChild=add();names.set(closeChild,'closed-peek');w.gBrowser.selectedTab=parent;
  await w.gZenGlanceManager.openGlance({url:'about:blank',clientX:0,clientY:0,width:0,height:0},closeChild,parent);
  const closing=w.gZenGlanceManager.closeGlance({onTabClose:true,skipPermitUnload:true});
  await switchChecked(0,{},'switch-during-peek-close');await closing;await pause(200);
  await switchChecked(1,{selectTab:parent},'return-after-peek-close');
  check('Peek close removes child and cached membership',!closeChild.isConnected&&!parent.glanceTab&&!w.gBrowser.tabs.includes(closeChild));
  const transient=add();names.set(transient,'transient');
  check('ordinary open appears in membership',w.gBrowser.tabs.includes(transient));
  w.gBrowser.moveTabBefore(transient,parent);await pause(100);
  check('ordinary move refreshes order',w.gBrowser.tabs.indexOf(transient)+1===w.gBrowser.tabs.indexOf(parent));
  w.gBrowser.removeTab(transient,{animate:false,skipPermitUnload:true});await pause(150);
  check('ordinary close refreshes membership',!transient.isConnected&&!w.gBrowser.tabs.includes(transient));
  await switchChecked(2,{selectTab:rows[2][3]},'final-folder-space');
  const beforeNoOp=JSON.stringify(snapshot());await manager.changeWorkspaceWithID(ids[2]);
  check('settled same-Space preserves state',JSON.stringify(snapshot())===beforeNoOp);
  return {ok:checks.every(c=>c.ok),checks,spaces:ids.length,phases,final:snapshot(),
    notes:['Actual packaged methods with observation wrappers; no implementation replacement.',
      'Headless deterministic work counts only; no timing or visual inference.']};
} finally {current=null;for (const undo of restore.reverse()) undo();}
