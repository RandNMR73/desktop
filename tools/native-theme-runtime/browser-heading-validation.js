const done=arguments[arguments.length-1];
(async()=>{
if(!Services.dirsvc.get('ProfD',Ci.nsIFile).path.includes('zen-search-recents-'))throw Error('Disposable profile required');
const w=Services.wm.getMostRecentWindow('navigator:browser'),d=w.document,m=w.gZenWorkspaces,root=d.documentElement;
const {nativeSpacePalette}=ChromeUtils.importESModule('resource:///modules/zen/ZenNativeTheme.sys.mjs');
const checks=[],rows=[];const check=(name,passed)=>checks.push({name,passed});
const wait=()=>new Promise(r=>w.setTimeout(r,250));
const initial=m.activeWorkspace,originalStyle=root.style.cssText,mode=root.getAttribute('zen-should-be-dark-mode');
try {
for(const space of m.getWorkspaces()) {
 await m.changeWorkspaceWithID(space.uuid);await wait();
 const icon=m.activeWorkspaceIndicator.querySelector('.zen-current-workspace-indicator-icon');
 const before=icon.getBoundingClientRect();
 for(const appearance of ['light','dark']) {
  icon.style.setProperty('color-scheme',appearance,'important');root.style.setProperty('--toolbar-color-scheme',appearance,'important');root.style.setProperty('color-scheme',appearance,'important');root.setAttribute('zen-should-be-dark-mode',appearance==='dark');await wait();
  const p=await nativeSpacePalette(space),rgba=p[appearance].maxContrastColor;
  const swatch=d.createElement('span');swatch.style.color=`color(srgb ${rgba.slice(0,3).join(' ')} / ${rgba[3]})`;d.documentElement.append(swatch);
  const expected=w.getComputedStyle(swatch).color,s=w.getComputedStyle(icon),r=icon.getBoundingClientRect();
  check(space.name+' '+appearance+' heading uses contrast color',s.color===expected);
  check(space.name+' '+appearance+' SVG fill uses contrast color',s.fill===expected);
  check(space.name+' '+appearance+' legacy shape uses contrast color',s.backgroundColor===expected);
  check(space.name+' '+appearance+' dimensions preserved',r.width===before.width&&r.height===before.height);
  rows.push({space:space.name,appearance,scheme:s.colorScheme,expected,color:s.color,fill:s.fill,background:s.backgroundColor,rect:{x:r.x,y:r.y,width:r.width,height:r.height}});swatch.remove();
 }
}
const space=m.getWorkspaces()[2],saved=structuredClone(space.theme);
try {
 await m.changeWorkspaceWithID(space.uuid);
 for(const rgb of [[.65,.05,.95],[.1,.8,.25]]) {
  space.theme={type:'gradient',gradientColors:[{c:rgb.map(c=>Math.round(c*255)),p3:rgb,isPrimary:true}],opacity:.72,texture:0};
  w.gZenThemePicker.onWorkspaceChange(space);w.dispatchEvent(new w.CustomEvent('ZenWorkspaceDataChanged'));await wait();
  const icon=m.activeWorkspaceIndicator.querySelector('.zen-current-workspace-indicator-icon'),palette=await nativeSpacePalette(space),rgba=palette.dark.maxContrastColor;
  icon.style.setProperty('color-scheme','dark','important');const swatch=d.createElement('span');swatch.style.color=`color(srgb ${rgba.slice(0,3).join(' ')} / ${rgba[3]})`;root.append(swatch);
  check('Live P3 recoloring '+rgb.join(','),w.getComputedStyle(icon).color===w.getComputedStyle(swatch).color);swatch.remove();
 }
}finally{space.theme=saved;w.gZenThemePicker.onWorkspaceChange(space);w.dispatchEvent(new w.CustomEvent('ZenWorkspaceDataChanged'));await wait();}
return {pass:checks.every(c=>c.passed),checks,rows};
}finally{for(const icon of d.querySelectorAll('.zen-current-workspace-indicator-icon'))icon.style.removeProperty('color-scheme');root.style.cssText=originalStyle;if(mode===null)root.removeAttribute('zen-should-be-dark-mode');else root.setAttribute('zen-should-be-dark-mode',mode);await m.changeWorkspaceWithID(initial);await wait();}
})().then(done,e=>done({error:String(e),stack:e.stack}));
