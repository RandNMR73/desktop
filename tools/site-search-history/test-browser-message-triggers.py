from pathlib import Path
import argparse,json,sys,tempfile,shutil
parser=argparse.ArgumentParser(description="Compare message-command entry with ordinary site search using real keyboard events.")
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
  rows=[]
  for alias in ['chatgpt','chatgpt.com','chat.openai.com','youtube.com','amazon.com','reddit.com','x.com']:
   for trigger,value in [('Tab','\ue004'),('Space',' ')]:
    keys(['t'],command=True);time.sleep(.3)
    opened=state()
    assert opened['input']=='',opened
    keys(alias);time.sleep(.4)
    typed=state();keys([value]);time.sleep(.45);after=state()
    row={'alias':alias,'trigger':trigger,'typed':typed,'after':after}
    expected=alias not in ('chatgpt.com','chat.openai.com')
    row['matchesArcScopeEntry']=bool(after['engine'])==expected
    expected_input='' if expected else alias+(' ' if trigger=='Space' else '')
    expected_placeholder=('Send a Message…' if alias=='chatgpt' else 'Search…') if expected else 'Search or Enter URL…'
    row['matchesArcInput']=after['input']==expected_input and after['placeholder']==expected_placeholder
    rows.append(row)
    for n in range(3):keys(['\ue00c']);time.sleep(.15)
  result={'completed':True,'cases':rows,'passed':all(c['matchesArcScopeEntry'] and c['matchesArcInput'] for c in rows),'app':str(app),'profileIsDisposable':True,'querySubmitted':False,'input':'WebDriver keyboard actions through browser event handlers'}
  report.write_text(json.dumps(result,indent=2)+'\n')
  print(json.dumps({'passed':result['passed'],'cases':len(rows)}),flush=True)
  if not result['passed']: raise AssertionError('Message/site-search transitions differ from the reference')
