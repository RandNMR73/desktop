from pathlib import Path
import argparse,json,sys,tempfile,shutil
parser=argparse.ArgumentParser(description="Check scope deletion and dismissal against native Arc observations with settled history.")
parser.add_argument('--app',type=Path,required=True)
parser.add_argument('--config-repo',type=Path,required=True)
parser.add_argument('--report',type=Path,required=True)
parser.add_argument('--expected-update-state',type=Path,required=True)
args=parser.parse_args()
config=args.config_repo.resolve()
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
 assert json.loads((app/'Contents/Resources/astral-update.json').read_text())['stateFile']==str(args.expected_update_state.resolve())
 with Instance(app,profile,port,env={'MOZ_PURGE_CACHES':'1'},log=r/(report.stem+'.log')) as inst:
  import time
  inst.client.chrome(script_timeout_ms=15000)
  inst.client.run("(async()=>{ const {SearchService:S}=ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs'); await S.init(); arguments[arguments.length-1](true); })();")
  def keys(values, command=False):
   actions=([{'type':'keyDown','value':'\ue03d'}] if command else [])
   for value in values: actions.extend([{'type':'keyDown','value':value},{'type':'keyUp','value':value}])
   if command: actions.append({'type':'keyUp','value':'\ue03d'})
   inst.client.call('WebDriver:PerformActions',{'actions':[{'type':'key','id':'keyboard','actions':actions}]})
  def state():
   return inst.client.run("const b=gURLBar;arguments[arguments.length-1]({input:b.value,placeholder:b.inputField.getAttribute('placeholder'),selection:[b.inputField.selectionStart,b.inputField.selectionEnd-b.inputField.selectionStart],engine:b.searchMode?.engineName??null,preview:b.searchMode?.isPreview??false,focused:document.activeElement===b.inputField,open:b.view.isOpen,offered:b.hasAttribute('zen-site-search-offered')});")
  inst.client.run("(async()=>{ const {PlacesUtils}=ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs'); for(const [host,title] of [['chatgpt.com','ChatGPT'],['youtube.com','YouTube']]) await PlacesUtils.history.insert({url:'https://'+host+'/',title,visits:[{date:new Date(),transition:PlacesUtils.history.TRANSITIONS.TYPED}]}); arguments[arguments.length-1](true); })();")
  inst.client.run("(async()=>{ await Cc['@mozilla.org/places/frecency-recalculator;1'].getService(Ci.nsIObserver).wrappedJSObject.recalculateAnyOutdatedFrecencies(); arguments[arguments.length-1](true); })();")
  rows=[]
  for alias in ['chatgpt','youtube.com','you']:
   for trigger,value in [('Tab','\ue004'),('Space',' ')]:
    for exit in ['Backspace','Tab','Escape','EscapeWithQuery']:
     keys(['t'],command=True);time.sleep(.3)
     opened=state();assert opened['input']=='',opened
     keys(alias);time.sleep(.45)
     typed=state();keys([value]);time.sleep(.45);entered=state()
     assert entered['engine'] and entered['input']=='',entered
     if exit=='EscapeWithQuery':keys('codex scope exit fixture');time.sleep(.35)
     keys([{'Backspace':'\ue003','Tab':'\ue004','Escape':'\ue00c','EscapeWithQuery':'\ue00c'}[exit]])
     time.sleep(.45);after=state()
     rows.append({'alias':alias,'trigger':trigger,'exit':exit,'typed':typed,'entered':entered,'after':after})
     for n in range(3):keys(['\ue00c']);time.sleep(.15)
  reference=json.loads(Path(__file__).with_name('scope-exit-reference.json').read_text())
  for row, expected in zip(rows,reference['cases'],strict=True):
   assert all(row[k]==expected[k] for k in ['alias','trigger','exit'])
   row['matchesArc']=all(row[phase][k]==expected[phase][k] for phase in ['entered','after'] for k in ['input','placeholder','selection']) and row['after']['engine'] is None and row['after']['focused'] and row['after']['open']
   if row['alias'] in ['chatgpt','you']:
    typed=row['typed'];row['completionExercised']=typed['input'].startswith(row['alias']) and typed['selection']==[len(row['alias']),len(typed['input'])-len(row['alias'])] and typed['selection'][1]>0
   else: row['completionExercised']=True
  result={'completed':True,'passed':all(row['matchesArc'] and row['completionExercised'] for row in rows),'cases':rows,'app':str(app),'profileIsDisposable':True,'querySubmitted':False,'input':'WebDriver keyboard actions through browser event handlers','seed':'Typed domain visits in disposable profile only'}
  report.write_text(json.dumps(result,indent=2)+'\n')
  print(json.dumps({'passed':result['passed'],'cases':len(rows)}),flush=True)
  if not result['passed']:raise AssertionError('Scope restoration differs from the native reference')
