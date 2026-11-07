from pathlib import Path
import argparse,json,sys,tempfile,shutil
parser=argparse.ArgumentParser(description="Test case-sensitive site-search completion in a fresh, network-isolated Zen profile.")
parser.add_argument('--app',type=Path,required=True)
parser.add_argument('--config-repo',type=Path,required=True)
parser.add_argument('--report',type=Path,required=True)
args=parser.parse_args()
source=Path(__file__).resolve().parents[2];config=args.config_repo.resolve()
report=args.report.resolve();r=report.parent;r.mkdir(parents=True,exist_ok=True)
sys.path[:0]=[str(config/'tools/zen-bench'),str(config/'scripts')]
from zen_bench.instance import Instance,free_port
from zen_bench.profile import harness_prefs,render_prefs
import zen_profile,zen_mozlz4
app=args.app.resolve();checks=[]
with tempfile.TemporaryDirectory(prefix='zen-search-typed-') as tmp:
 profile=Path(tmp);conf=config/'config/zen'
 shutil.copytree(conf/'chrome',profile/'chrome');(profile/'chrome/arc-icons').symlink_to(conf/'arc-icons')
 model=zen_profile.seed({},json.loads((conf/'workspaces.json').read_text()),{'essentials':[],'spaces':[]})
 themes=json.loads((app/'Contents/Resources/zen-native-theme/themes.json').read_text())
 model=json.loads(json.dumps(model).replace('{11a50d7f-602d-587c-a1a0-ffff662996b9}',themes['themes'][0]['id']))
 zen_mozlz4.write_json(profile/'zen-sessions.jsonlz4',model)
 port=free_port();prefs={**harness_prefs(port),'browser.startup.page':0,'zen.welcome-screen.seen':True,'browser.startup.homepage_override.mstone':'ignore','browser.urlbar.closeOnWindowBlur':False,'browser.search.suggest.enabled':False,'startup.homepage_welcome_url':'','startup.homepage_welcome_url.additional':''}
 (profile/'user.js').write_text((conf/'user.js').read_text()+'\n'+render_prefs(prefs))
 with Instance(app,profile,port,env={'MOZ_PURGE_CACHES':'1'},log=r/(report.stem+'.log')) as inst:
  inst.client.chrome(script_timeout_ms=30000)
  script=(source/'tools/site-search-history/browser-deletion-fixture.js').read_text()
  def state(op='state',engine='YouTube',query='lattice'):
   result=inst.client.run(script,[op,engine,query]);assert not result.get('error'),result;return result
  def keys(text):
   actions=[a for value in text for a in [{'type':'keyDown','value':value},{'type':'keyUp','value':value}]]
   inst.client.call('WebDriver:PerformActions',{'actions':[{'type':'key','id':'keyboard','actions':actions}]})
   return state()
  def check(name,condition,actual):
   checks.append({'name':name,'pass':bool(condition),'actual':actual})
   report.write_text(json.dumps({'passed':all(c['pass'] for c in checks),'checks':checks},indent=2)+'\n')
   if not condition:raise AssertionError(name)
  try:
   state('seed')
   for engine in ['YouTube','Amazon','Google']:
    for query in ['LATTICE','Lattice','lattice']:
     state('query',engine,'')
     a=keys(query)
     expected=query if query != 'lattice' else 'lattice compiler'
     selectionEnd=len(query) if query != 'lattice' else len(expected)
     check(engine+': '+query+' completion respects case',
       a['value']==expected and a['start']==len(query) and a['end']==selectionEnd,a)
     check(engine+': '+query+' keeps history suggestions',
       set(a['results'])=={query,'lattice compiler','lattice models'},a)
     keys('\ue015');a=keys('\ue013')
     check(engine+': '+query+' arrow selection respects case',
       a['value']==expected and a['start']==len(query) and a['end']==selectionEnd,a)
    state('query',engine,'LATTICE')
    keys('\ue015');keys('\ue013')
    expected=inst.client.run("""
      const done=arguments[arguments.length-1];
      const b=Services.wm.getMostRecentWindow('navigator:browser').gURLBar;
      const {SearchService:S}=ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs');
      const term=b.view.visibleResults[0].payload.suggestion;
      done({term,url:S.getEngineByName(b.searchMode.engineName).getSubmission(term,null,'searchbar').uri.spec});
    """)
    a=keys('\ue007')
    actual=inst.client.run("""
      const done=arguments[arguments.length-1];const expected=arguments[0];
      const w=Services.wm.getMostRecentWindow('navigator:browser');
      (async()=>{for(let i=0;i<100&&w.gBrowser.selectedBrowser.currentURI.spec!==expected;i++)
        await new Promise(resolve=>w.setTimeout(resolve,25));
        done({url:w.gBrowser.selectedBrowser.currentURI.spec,scope:w.gURLBar.searchMode});})();
    """,[expected['url']])
    check(engine+': Enter submits the selected full search without inline completion',
      expected['term']=='lattice compiler' and actual['url']==expected['url'] and not actual['scope'],actual)
   check('input events are trusted',len(a['inputs'])>=63 and all(e['trusted'] for e in a['inputs']),a['inputs'])
  except Exception as e:
   print(json.dumps({'passed':False,'error':str(e),'checks':len(checks),'report':str(report)}),flush=True)
  else: print(json.dumps({'passed':True,'checks':len(checks),'report':str(report)}),flush=True)

raise SystemExit(0 if checks and all(c['pass'] for c in checks) and len(checks)==31 else 1)
