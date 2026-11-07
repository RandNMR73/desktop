"""Measure restored Favorite border readiness in two isolated browser launches.

The supplied app is copied with APFS cloning. Only the owned copy gains the
startup observer; installed apps and normal browser profiles are never changed.
"""
from pathlib import Path
import argparse,base64,hashlib,json,os,plistlib,shutil,subprocess,sys,tempfile
parser=argparse.ArgumentParser()
parser.add_argument('--app',type=Path,required=True)
parser.add_argument('--config-repo',type=Path,required=True)
parser.add_argument('--output-dir',type=Path,required=True)
parser.add_argument('--case',choices=['unchanged','artwork','stale'],default='unchanged')
args=parser.parse_args()
assert sys.platform=='darwin'
ROOT=args.output_dir.resolve();ROOT.mkdir(parents=True,exist_ok=True)
CONFIG=args.config_repo.resolve()
APP=ROOT/'Zen Favorite Startup.app'
LABEL=args.case
assert not APP.exists(), 'Use a fresh output directory'
sys.path[:0]=[str(CONFIG/'tools/zen-bench'),str(CONFIG/'scripts')]
from zen_jar import Archive,rebuild
subprocess.run(['/bin/cp','-cR',str(args.app.resolve()),str(APP)],check=True)
plist=APP/'Contents/Info.plist';data=plistlib.loads(plist.read_bytes())
data['CFBundleIdentifier']='org.astral.zen.favorite-startup'
data['CFBundleName']='Zen Favorite Startup';plist.write_bytes(plistlib.dumps(data))
archive=APP/'Contents/Resources/browser/omni.ja'
with Archive(archive) as jar:
 entry=next(n for n in jar.zip.namelist() if n.endswith('/ZenPinnedTabManager.mjs'))
 original=jar.zip.read(entry).decode()
 needle='class nsZenPinnedTabManager extends nsZenDOMOperatedFeature {\n  init() {'
 assert original.count(needle)==1 and '__favoriteStartupAudit' not in original
 instrumented=original.replace(needle,needle+'\n'+Path(__file__).with_name('observe.js').read_text())
stage=ROOT/'observed.ja';rebuild(archive,stage,{entry:instrumented.encode()});os.replace(stage,archive)
subprocess.run(['codesign','--force','--sign','-',str(APP)],check=True)
subprocess.run(['codesign','--verify','--deep','--strict',str(APP)],check=True)
(ROOT/'bundle.json').write_text(json.dumps({'input':str(args.app.resolve()),'app':str(APP),
 'entry':entry,'originalSHA256':hashlib.sha256(original.encode()).hexdigest(),
 'instrumentedSHA256':hashlib.sha256(instrumented.encode()).hexdigest()},indent=2)+'\n')
from zen_bench.instance import Instance,free_port
from zen_bench.profile import harness_prefs,render_prefs
import zen_profile,zen_mozlz4
reports=[]
with tempfile.TemporaryDirectory(prefix='zen-favorite-startup-') as temporary:
 profile=Path(temporary)/'profile';profile.mkdir()
 shutil.copytree(CONFIG/'config/zen/chrome',profile/'chrome')
 (profile/'chrome/arc-icons').symlink_to(CONFIG/'config/zen/arc-icons')
 spaces=json.loads((CONFIG/'config/zen/workspaces.json').read_text())
 native=json.loads((APP/'Contents/Resources/zen-native-theme/themes.json').read_text())
 for space,theme in zip(spaces,native['themes']):space['uuid']=theme['id']
 pins=json.loads((CONFIG/'config/zen/pins.json').read_text())
 model=zen_profile.seed({},spaces,{'essentials':pins['essentials'],'spaces':[]})
 assert len(model['tabs'])==12 and all(t['image'].startswith('data:') for t in model['tabs'])
 zen_mozlz4.write_json(profile/'zen-sessions.jsonlz4',model)
 width=json.loads((CONFIG/'config/zen/arc/arc-sidebar.json').read_text())['sidebar_width']
 (profile/'xulstore.json').write_text(json.dumps(zen_profile.set_sidebar_width({},width)))
 port=free_port()
 prefs={**harness_prefs(port),'zen.welcome-screen.seen':True,
 'browser.startup.homepage_override.mstone':'ignore','startup.homepage_welcome_url':'',
 'startup.homepage_welcome_url.additional':'','zen.library.preview.sources.documents':False,
 'zen.library.preview.sources.desktop':False,'zen.library.preview.sources.screenshot':False}
 (profile/'user.js').write_text((CONFIG/'config/zen/user.js').read_text()+'\n'+render_prefs(prefs))
 for iteration in range(2):
  label=LABEL+'-'+str(iteration)
  with Instance(APP,profile,port,env={'MOZ_PURGE_CACHES':'1'},log=ROOT/'run.log') as inst:
   print(json.dumps({'ready':True,'pid':inst.pid,'profile':str(profile)}),flush=True)
   inst.client.chrome(script_timeout_ms=20000)
   report=inst.client.run('''
 const done=arguments[arguments.length-1];
 const w=Services.wm.getMostRecentWindow('navigator:browser');
 const start=Date.now();
 const poll=()=>{
  const a=w.__favoriteStartupAudit;
  if(a?.complete){
   a.final={favorites:[...w.gBrowser.tabs].filter(t=>t.hasAttribute('zen-essential')).map(t=>({ready:t.hasAttribute('zen-favorite-outline-ready'),pending:t.hasAttribute('pending'),app:t.getAttribute('zen-favorite-app-icon')})),commandOpen:w.gURLBar.view.isOpen};
   a.cachePath=PathUtils.join(Services.dirsvc.get('ProfLD',Ci.nsIFile).path,'zen-favorite-outlines.json');
  a.borders=[...w.gBrowser.tabs].filter(t=>t.hasAttribute('zen-essential')).map(t=>t.style.getPropertyValue('--zen-favorite-outline-image'));
  done(a);
  }else if(Date.now()-start>15000)done({error:'Observer not complete',audit:a??null});
  else w.setTimeout(poll,100);
 };poll();
 ''')
   (ROOT/(label+'.json')).write_text(json.dumps(report,indent=2)+'\n')
   if 'error' in report:raise RuntimeError(report['error'])
   reports.append(report)
   samples=report['samples']
   first=next((s for s in samples if s['visible']),None)
   paint=next((s for s in samples if s['kind']=='paint' and s['visible']),None)
   ready=next((s for s in samples if s['count']==12 and s['ready']==12),None)
   summary={'samples':len(samples),'firstVisible':first,'firstPaintWithFavorites':paint,'allReady':ready,'final':report['final']}
   (ROOT/(label+'-summary.json')).write_text(json.dumps(summary,indent=2)+'\n')
   print(json.dumps(summary),flush=True)
  if iteration == 0 and args.case != 'unchanged':
   mutation=args.case
   cache=Path(report['cachePath'])
   assert 'zen-favorite-startup-' in str(cache)
   if mutation=='stale':
    data=json.loads(cache.read_text());data['version']+='-obsolete';cache.write_text(json.dumps(data))
   elif mutation=='artwork':
    state=zen_mozlz4.read_json(profile/'zen-sessions.jsonlz4')
    tab=[t for t in state['tabs'] if t.get('zenEssential')][7]
    svg='<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="#ed2275" d="M0 0h32v32H0z"/><circle cx="16" cy="16" r="8" fill="#39ff22"/></svg>'
    image='data:image/svg+xml;base64,'+base64.b64encode(svg.encode()).decode()
    tab['image']=image;tab['_zenPinnedInitialState']['image']=image
    zen_mozlz4.write_json(profile/'zen-sessions.jsonlz4',state)
   else:raise RuntimeError(mutation)
before,after=reports
assert all(row['ready'] for row in after['final']['favorites'])
changed=[i for i,(old,new) in enumerate(zip(before['borders'],after['borders'])) if old!=new]
assert changed == ([7] if args.case=='artwork' else []),changed
paint=next(s for s in after['samples'] if s['kind']=='paint' and s['visible'])
if args.case=='unchanged':assert paint['ready']==12,paint
result={'passed':True,'case':args.case,'firstPaintReady':paint['ready'],'changedBorderIndices':changed}
(ROOT/'validation.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result),flush=True)
print('Owned fixture stopped',flush=True)
