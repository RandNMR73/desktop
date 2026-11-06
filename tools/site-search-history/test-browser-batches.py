from pathlib import Path
import argparse,json,sys,tempfile,shutil
parser=argparse.ArgumentParser(description="Test scoped result batches and session cleanup in a fresh, network-isolated Zen profile.")
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
  inst.client.chrome(script_timeout_ms=120000)
  result=inst.client.run((source/'tools/site-search-history/browser-batches-validation.js').read_text())
  report.write_text(json.dumps(result,indent=2)+'\n')
  print(json.dumps({'pass':result.get('pass'),'checks':len(result.get('checks',[])),'error':result.get('error')}),flush=True)
raise SystemExit(0 if result.get('pass') else 1)
