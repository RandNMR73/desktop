from pathlib import Path
import argparse,json,sys,tempfile,shutil
parser=argparse.ArgumentParser(description="Test site-search deletion in a fresh, network-isolated Zen profile.")
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
    a=state('query',engine)
    check(engine+': selected completion suffix',a['value']=='lattice compiler' and a['start']==7 and a['end']==16,a)
    a=keys('\ue003')
    check(engine+': deleting only completion dismisses history',a['query']=='lattice' and a['results']==['lattice'] and a['value']=='lattice',a)
    a=keys('x')
    check(engine+': unmatched typed suffix has literal only',a['results']==['latticex'],a)
    a=keys('\ue003')
    check(engine+': deleting typed character restores history',set(a['results'])=={'lattice','lattice compiler','lattice models'} and a['value']=='lattice' and a['start']==a['end']==7,a)
    a=keys('\ue003')
    check(engine+': repeated ordinary backspace keeps matching history',set(a['results'])=={'lattic','lattice compiler','lattice models'} and a['value']=='lattic',a)
    a=keys('e')
    check(engine+': typing after deletion restores inline completion',a['value']=='lattice compiler' and a['start']==7 and a['end']==16,a)
    a=keys('\ue017')
    check(engine+': forward delete also dismisses only completion',a['results']==['lattice'] and a['value']=='lattice',a)
    a=keys('x');a=keys('\ue012');a=keys('\ue017')
    check(engine+': forward deletion of typed character restores history',set(a['results'])=={'lattice','lattice compiler','lattice models'} and a['value']=='lattice',a)
    state('select-all');a=keys('\ue003')
    check(engine+': clearing input restores recent searches',not a['value'] and set(a['results'])=={'lattice compiler','lattice models'},a)
    state('query',engine);keys('\ue015');a=keys('\ue003')
    check(engine+': deleting an arrow-selected completion dismisses history',a['results']==['lattice'] and a['value']=='lattice',a)
   check('keyboard exercises use trusted input events',len(a['inputs'])==30 and all(e['trusted'] for e in a['inputs']),a['inputs'])
   for name in ['browser-typed-validation.js','browser-routing-validation.js']:
    result=inst.client.run((source/'tools/site-search-history'/name).read_text())
    (r/(report.stem+'-'+name.replace('.js','.json'))).write_text(json.dumps(result,indent=2)+'\n')
    check(name, bool(result.get('pass',result.get('passed',False))),result)
  except Exception as e:
   print(json.dumps({'passed':False,'error':str(e),'checks':len(checks),'report':str(report)}),flush=True)
  else: print(json.dumps({'passed':True,'checks':len(checks),'report':str(report)}),flush=True)

raise SystemExit(0 if checks and all(c["pass"] for c in checks) and len(checks)==33 else 1)
