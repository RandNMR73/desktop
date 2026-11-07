// Owned-bundle startup observation only. Product behavior is unchanged.
if (Services.dirsvc.get('ProfD', Ci.nsIFile).path.includes('zen-favorite-startup-')) {
  const audit = window.__favoriteStartupAudit = {
    start: window.performance.now(), samples: [], events: [],
  };
  const take = kind => {
    const tabs = [...(window.gBrowser?.tabs ?? [])].filter(tab => tab.hasAttribute('zen-essential'));
    const visible = tabs.filter(tab => tab.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}));
    audit.samples.push({kind, time:window.performance.now(),
      count:tabs.length, ready:tabs.filter(tab=>tab.hasAttribute('zen-favorite-outline-ready')).length,
      visible:visible.length, visibleReady:visible.filter(tab=>tab.hasAttribute('zen-favorite-outline-ready')).length,
      selected:tabs.indexOf(window.gBrowser?.selectedTab),
      selectedReady:window.gBrowser?.selectedTab?.hasAttribute('zen-favorite-outline-ready'),
      hidden:window.document.hidden, state:window.document.readyState,
      root:[...window.document.documentElement.attributes].filter(a=>/restor|load|ready|hidden/.test(a.name)).map(a=>[a.name,a.value]),
    });
  };
  const paint = event => { take('paint'); };
  window.addEventListener('MozAfterPaint',paint);
  for (const name of ['DOMContentLoaded','load','SSTabRestored','TabSelect']) {
    window.addEventListener(name,()=>audit.events.push({name,time:window.performance.now()}));
  }
  const frame = () => {
    take('frame');
    if (window.performance.now()-audit.start<8000) window.requestAnimationFrame(frame);
    else { window.removeEventListener('MozAfterPaint',paint);audit.complete=true; }
  };
  take('init');window.requestAnimationFrame(frame);
}
