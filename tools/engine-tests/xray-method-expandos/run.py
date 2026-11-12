"""Measure native DOM method lookup with unrelated extension prototype fields."""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import argparse
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import traceback
import zipfile

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--bench-root', type=Path, required=True,
                    help='Astralforge tools/zen-bench directory')
parser.add_argument('--output', type=Path, required=True,
                    help='New directory for results and the disposable profile')
parser.add_argument('--manifest', type=Path, required=True,
                    help='Owned app manifest with app, files and installedFiles hashes')
parser.add_argument('--scenario', choices=['expandos', 'proxy-transition'], default='expandos',
                    help='Semantic expando coverage or mixed DOM proxy transition diagnostic')
args = parser.parse_args()
sys.path.insert(0, str(args.bench_root.resolve()))
from zen_bench.instance import Instance, free_port
from zen_bench.profile import harness_prefs, render_prefs
OUT = args.output.resolve()
assert not OUT.exists()
assert OUT.parent.is_dir()
assert shutil.disk_usage(OUT.parent).free > 256 * 1024**2
OUT.mkdir()
profile = OUT / 'profile'; profile.mkdir()
port = free_port()
(profile / 'user.js').write_text(render_prefs({**harness_prefs(port), 'browser.startup.page': 0,
    'browser.startup.homepage': 'about:blank', 'browser.warnOnQuit': False}))
manifest = json.loads(args.manifest.read_text()); app = Path(manifest['app']).resolve()
assert app.parent != Path('/Applications'), 'Use an owned diagnostic app copy'
assert app.is_dir()
def sha(p):
    with p.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()
assert all(sha(app/n) == h for n,h in manifest['files'].items())
FIXTURE = ROOT
fixture_html, content_script, expected_checks, expected_rows = {
    'expandos': ('fixture.html', 'content-script.js', 98, 11),
    'proxy-transition': ('proxy-transition.html', 'proxy-transition.js', 50, 39),
}[args.scenario]
(OUT / 'index.html').write_bytes((FIXTURE / fixture_html).read_bytes())
fixture_hashes = {name: sha(FIXTURE/name) for name in [fixture_html,'manifest.json',content_script]}
addon = OUT / 'probe.xpi'
with zipfile.ZipFile(addon, 'w', zipfile.ZIP_DEFLATED) as z:
    z.write(FIXTURE/'manifest.json', 'manifest.json')
    z.write(FIXTURE/content_script, 'content-script.js')
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(OUT),**kw)
    def log_message(self,*args):pass
server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
report = {'startedAt':time.time(),'complete':False,'headless':True,'diagnosticOnly':True,'scenario':args.scenario,'fixtureHashes':fixture_hashes,'installedFiles':manifest['installedFiles']}
finished = threading.Event()
guard_thread = None
try:
    with Instance(app, profile, port, env={'MOZ_HEADLESS':'1','MOZ_HEADLESS_WIDTH':'1400','MOZ_HEADLESS_HEIGHT':'900'},log=OUT/'browser.log') as inst:
        def guard():
            while not finished.wait(1):
                used = 0
                for p in profile.rglob('*'):
                    try:
                        if p.is_file() and not p.is_symlink():used += p.stat().st_blocks * 512
                    except FileNotFoundError:pass
                if used > 64 * 1024**2 or shutil.disk_usage(OUT).free < 128 * 1024**2:
                    report['diskGuard'] = {'profileBytes':used,'freeBytes':shutil.disk_usage(OUT).free}
                    if inst.pid:
                        try:os.killpg(inst.pid,signal.SIGTERM)
                        except ProcessLookupError:pass
                    return
        guard_thread=threading.Thread(target=guard,daemon=True);guard_thread.start()
        c=inst.client;c.chrome(script_timeout_ms=120000)
        identity=c.run("arguments[arguments.length-1]({profile:Services.dirsvc.get('ProfD',Ci.nsIFile).path,headless:Cc['@mozilla.org/gfx/info;1'].getService(Ci.nsIGfxInfo).isHeadless})")
        assert identity=={'profile':str(profile),'headless':True}
        mapped=subprocess.check_output(['lsof','-p',str(inst.pid),'-Fn'],text=True)
        assert '\nn'+str(app/'Contents/MacOS/XUL')+'\n' in mapped
        installed=c.run('''
const [path,done]=arguments;
const file=Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);file.initWithPath(path);
const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
AddonManager.installTemporaryAddon(file).then(a=>done({id:a.id,active:a.isActive}),e=>done({error:String(e)}));
''',[str(addon)])
        assert installed=={'id':'xray-native-method-fixture@astralforge.test','active':True},installed
        c.call('Marionette:SetContext',{'value':'content'})
        c.call('WebDriver:Navigate',{'url':f'http://127.0.0.1:{server.server_port}/index.html'})
        data=c.run('''
const done=arguments[arguments.length-1];
function check(){const text=document.documentElement.getAttribute('data-xray-method-results');if(text){done(JSON.parse(text));return true;}return false;}
if(!check()){const observer=new MutationObserver(()=>{if(check())observer.disconnect()});observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-xray-method-results']});}
''')
        report['result'] = data
        assert 'error' not in data,data
        assert data.get('passed') and len(data['checks']) == expected_checks,data
        assert all(check['passed'] for check in data['checks']),data
        assert len(data['timings']) == expected_rows and all(row['count']==48000 for row in data['timings']),data
        report.update(complete=True,result=data,loadedEngineConfirmed=True)
except BaseException as error:
    report['error'] = str(error)
    report['traceback'] = traceback.format_exc()
    raise
finally:
    finished.set()
    if guard_thread:guard_thread.join(timeout=3)
    server.shutdown();server.server_close()
    assert subprocess.run(['pgrep','-f',str(profile)],stdout=subprocess.DEVNULL).returncode==1
    shutil.rmtree(profile)
    report['installedUnchanged']=all(sha(Path('/Applications/Zen.app')/n)==h for n,h in manifest['installedFiles'].items())
    report.update(endedAt=time.time(),ownedProfileRemoved=True)
    (OUT/'result.json').write_text(json.dumps(report,indent=2)+'\n')
    assert report['installedUnchanged']
print(json.dumps({'complete':report['complete'],'checks':len(report.get('result',{}).get('checks',[])),'resultFile':str(OUT/'result.json')}))
