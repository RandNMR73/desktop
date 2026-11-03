const done=arguments[arguments.length-1];
const w=Services.wm.getMostRecentWindow('navigator:browser'),b=w.gURLBar,f=w.__typedTabs;
if(!f)throw Error('Missing owned fixture');
const rows=[...w.document.querySelectorAll('.urlbarView-row')].filter(r=>r.result&&!r.hasAttribute('stale'));
done({selectedTab:w.gBrowser.selectedTab.id,splitActivated:w.gZenViewSplitter.splitViewActive,
 selectedTabExpected:w.gBrowser.selectedTab===f.left,tabCount:w.gBrowser.tabs.length,
 panel:b.view.isOpen,inputValue:b.value,inputIcon:b.style.getPropertyValue('--zen-selected-site-icon'),
 rows:rows.map(r=>({title:r.querySelector('.urlbarView-title')?.textContent,selected:r.hasAttribute('selected'),
   iconCount:r.querySelectorAll('.zen-split-result-icons img').length,
   iconRect:r.querySelector('.zen-split-result-icons')?.getBoundingClientRect().toJSON(),
   row:r.getBoundingClientRect().toJSON()}))});
