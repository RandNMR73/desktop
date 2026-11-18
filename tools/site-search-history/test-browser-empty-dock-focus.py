"""Check packaged reverse-focus behavior in an owned headless browser only."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--app', required=True, type=Path)
parser.add_argument('--bench-tools', required=True, type=Path)
parser.add_argument('--report', required=True, type=Path)
args = parser.parse_args()
app, report = args.app.resolve(), args.report.resolve()
if app.is_relative_to('/Applications') or (app / 'Contents/Resources/astral-update.json').exists():
    raise SystemExit('Use an owned, unenrolled diagnostic app')
if report.exists():
    raise SystemExit('Report already exists')
report.parent.mkdir(parents=True, exist_ok=True)
subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
sys.path.insert(0, str(args.bench_tools.resolve()))
from zen_bench.instance import Instance, free_port
from zen_bench.profile import harness_prefs, render_prefs


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


before = {str(p.relative_to(app)): sha(p) for p in app.rglob('*') if p.is_file()}
result = {'app': str(app), 'headless': True, 'profileKind': 'fresh owned empty',
          'moduleInjection': False, 'methodOverrides': False, 'checks': [],
          'helpers': {name: sha(args.bench_tools / 'zen_bench' / name)
                      for name in ['instance.py', 'marionette.py', 'profile.py']},
          'runnerSHA256': sha(Path(__file__)), 'filesBefore': before}


def save():
    report.write_text(json.dumps(result, indent=2) + '\n')


def check(name, passed, actual=None):
    result['checks'].append({'name': name, 'passed': bool(passed), 'actual': actual})
    save()


COMMON = """
const w=Services.wm.getMostRecentWindow('navigator:browser');
const pause=ms=>new Promise(r=>w.setTimeout(r,ms));
const state=()=>{
 const d=w.gZenWorkspaces.workspaceIcons,r=d?.getBoundingClientRect(),style=d&&w.getComputedStyle(d);
 return {open:w.gURLBar.view.isOpen,session:w.gURLBar.hasAttribute('zen-newtab'),inputFocused:w.gURLBar.focused,
  dockFocused:!!d&&w.document.activeElement===d,browserFocused:w.document.activeElement===w.gBrowser.selectedBrowser,
  activeTag:w.document.activeElement?.localName,activeId:w.document.activeElement?.id,
  tab:w.gBrowser.selectedTab.linkedPanel,tabOrder:w.gBrowser.tabs.map(t=>t.linkedPanel),
  uri:w.gBrowser.selectedBrowser.currentURI.spec,empty:w.gBrowser.selectedTab.hasAttribute('zen-empty-tab'),
  activeSpace:w.gZenWorkspaces.activeWorkspace,dockIndex:d?.activeIndex,dockTabindex:d?.getAttribute('tabindex'),
  compact:w.gZenCompactModeManager.preference,little:!!w._zenLittleWindow,littleInput:!!w._zenLittleWindowInput,
  dockVisible:!!d&&d.checkVisibility({checkVisibilityCSS:true,checkOpacity:true}),
  dockFocusVisible:!!d&&d.matches(':focus-visible'),
  dockAppearance:style&&Object.fromEntries(['outlineStyle','outlineWidth','outlineColor','outlineOffset','boxShadow','backgroundColor'].map(k=>[k,style[k]])),
  dockRect:r?.toJSON(),userShow:w.gNavToolbox.hasAttribute('zen-user-show')};
};
"""

with tempfile.TemporaryDirectory(prefix='owned-empty-dock-', dir=report.parent) as temporary:
    profile = Path(temporary)
    port = free_port()
    prefs = {**harness_prefs(port), 'zen.welcome-screen.seen': True,
             'browser.startup.page': 0, 'browser.startup.homepage_override.mstone': 'ignore',
             'zen.urlbar.open-on-startup': False, 'zen.view.compact.enable-at-startup': False,
             'browser.search.suggest.enabled': False, 'browser.urlbar.suggest.searches': False,
             'browser.warnOnQuit': False, 'dom.ipc.processPrelaunch.enabled': False}
    (profile / 'user.js').write_text(render_prefs(prefs))
    try:
        with Instance(app, profile, port,
                      env={'MOZ_HEADLESS': '1', 'MOZ_HEADLESS_WIDTH': '1400', 'MOZ_HEADLESS_HEIGHT': '1000'},
                      log=report.with_suffix('.browser.log')) as instance:
            process = instance.proc
            result['ownedPID'] = instance.pid
            c = instance.client
            c.sock.settimeout(30)
            c.chrome(script_timeout_ms=20000)

            def run(body, values=None):
                value = c.run('const done=arguments[arguments.length-1];(async()=>{' + COMMON + body +
                              '})().then(done,e=>done({error:String(e),stack:e.stack}));', values or [])
                if isinstance(value, dict) and value.get('error'):
                    raise RuntimeError(value)
                return value

            result['runtime'] = run("""
                const profile=Services.dirsvc.get('ProfD',Ci.nsIFile).path;
                const executable=Services.dirsvc.get('XREExeF',Ci.nsIFile).path;
                if(profile!==arguments[0]||executable!==arguments[1]||
                   !Cc['@mozilla.org/gfx/info;1'].getService(Ci.nsIGfxInfo).isHeadless)throw Error('Runtime ownership mismatch');
                await w.SessionStore.promiseAllWindowsRestored;await w.gZenWorkspaces.promiseInitialized;
                await w.gZenWorkspaces.createAndSaveWorkspace('Owned focus Space');
                w.gZenWorkspaces.selectEmptyTab();await pause(400);
                const {SearchService}=ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs');
                await SearchService.init();const engine=await SearchService.getDefault();
                return {profile,executable,engine:engine.name};
            """, [str(profile), str(app / 'Contents/MacOS/zen')])
            engine = result['runtime']['engine']

            def setup(scope=None, query=''):
                return run("""
                  w.gURLBar.view.close();await pause(100);w.gURLBar.searchMode=null;
                  w.gZenUIManager.handleNewTab(false,false,'tab',true);
                  w.gURLBar.searchMode=arguments[0]?{engineName:arguments[0],entry:'shortcut',isPreview:false}:null;
                  w.gURLBar.search(arguments[1]);await w.gURLBar.lastQueryContextPromise;
                  w.gURLBar.inputField.focus();await pause(100);return state();
                """, [scope, query])

            def reverse():
                c.call('WebDriver:PerformActions', {'actions': [{'type': 'key', 'id': 'keyboard', 'actions': [
                    {'type': 'keyDown', 'value': '\ue008'}, {'type': 'keyDown', 'value': '\ue004'},
                    {'type': 'keyUp', 'value': '\ue004'}, {'type': 'keyUp', 'value': '\ue008'}]}]})
                return run('await pause(400);return state();')

            def case(label, expected_dock, scope=None, query='', expected_body=False):
                original = setup(scope, query)
                check(label + ': input opens and owns focus', original['open'] and original['inputFocused'], original)
                after = reverse()
                check(label + ': closes without delayed reopening', not after['open'] and not after['session'] and not after['inputFocused'], after)
                focused = (after['littleInput'] and after['activeTag'] == 'body' and not after['dockFocused']) if expected_body else (
                    after['dockFocused'] if expected_dock else after['browserFocused'])
                check(label + ': correct focus destination', focused, after)
                if expected_dock:
                    check(label + ': collection adds no ordinary Tab stop', after['dockTabindex'] == '-1', after)
                keys = ['tab', 'tabOrder', 'uri', 'activeSpace', 'dockIndex']
                check(label + ': preserves tab order, page and Space selection', all(after[k] == original[k] for k in keys), after)
                return after

            for scope in [None, engine]:
                for query in ['', 'owned focus query']:
                    case(f'empty/{scope or "ordinary"}/{bool(query)}', True, scope, query)

            # Exercise real CSS hidden and disconnected destinations, without
            # changing a production method or substituting a focus implementation.
            run("w.gZenWorkspaces.workspaceIcons.hidden=true;return true;")
            case('hidden dock fallback', False)
            run("w.gZenWorkspaces.workspaceIcons.hidden=false;return true;")
            run("const d=w.gZenWorkspaces.workspaceIcons;w.__focusDockParent=d.parentNode;w.__focusDockNext=d.nextSibling;d.remove();return true;")
            case('disconnected dock fallback', False)
            run("w.__focusDockParent.insertBefore(w.gZenWorkspaces.workspaceIcons,w.__focusDockNext);delete w.__focusDockParent;delete w.__focusDockNext;return true;")

            # Empty tabs intentionally reveal the compact sidebar. Validate that
            # real state, then separately exercise an unavailable dock in it.
            compact = run("w.gZenCompactModeManager.preference=true;await pause(800);return state();")
            check('actual compact mode is enabled', compact['compact'], compact)
            check('empty tab keeps the actual compact dock visible', compact['dockVisible'] and
                  compact['dockRect']['right'] > 0 and compact['dockRect']['left'] < 1400, compact)
            case('compact empty visible dock', True)
            run("w.gZenWorkspaces.workspaceIcons.hidden=true;return true;")
            compact_after = case('compact unavailable dock fallback', False)
            check('reverse focus does not reveal compact sidebar', not compact_after['userShow'], compact_after)
            run("w.gZenWorkspaces.workspaceIcons.hidden=false;return true;")
            run("w.gZenCompactModeManager.preference=false;await pause(800);return state();")

            # Deliver this single scheduling case synchronously so both native
            # URL-bar close timers are still queued when the next session opens.
            setup()
            reopened = run("""
                w.gURLBar.inputField.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
                w.gZenUIManager.handleNewTab(false,false,'tab',true);
                w.gURLBar.search('owned reopened query');w.gURLBar.inputField.focus();
                await pause(500);return {...state(),value:w.gURLBar.value};
            """)
            check('pending close cannot steal focus or dismiss same-turn reopened input',
                  reopened['open'] and reopened['inputFocused'] and not reopened['dockFocused'] and
                  reopened['value'] == 'owned reopened query', reopened)
            result['sameTurnReopenInput'] = 'Synthetic DOM key event only for scheduling; all other reverse-focus cases use WebDriver key input.'
            loaded = run("w.gURLBar.view.close();await pause(200);const t=w.gBrowser.addTrustedTab('data:text/html,<title>Owned focus page</title><input value=unchanged>');w.gBrowser.selectedTab=t;await pause(600);return state();")
            check('real loaded page is selected', not loaded['empty'] and loaded['uri'].startswith('data:text/html,'), loaded)
            for scope in [None, engine]:
                for query in ['', 'owned focus query']:
                    case(f'loaded/{scope or "ordinary"}/{bool(query)}', False, scope, query)

            # A real second Little window remains part of this owned headless
            # process/profile; it must continue returning focus to its browser.
            handles = c.call('WebDriver:GetWindowHandles')
            handles = handles.get('value', handles) if isinstance(handles, dict) else handles
            run("const {ZenLittleWindow}=ChromeUtils.importESModule('resource:///modules/zen/ZenLittleWindow.sys.mjs');const little=ZenLittleWindow.open(w);if(!little)throw Error('Little window unavailable');await pause(1200);return true;")
            updated = c.call('WebDriver:GetWindowHandles')
            updated = updated.get('value', updated) if isinstance(updated, dict) else updated
            new_handle = next(handle for handle in updated if handle not in handles)
            c.call('WebDriver:SwitchToWindow', {'handle': new_handle})
            c.chrome(script_timeout_ms=20000)
            little = run("await w.gZenWorkspaces.promiseInitialized;return state();")
            check('real owned Little window is active', little['little'], little)
            # Its initial input-only layout hides the browser, so the existing
            # browser.focus() fallback leaves the chrome body active. A loaded
            # Little window must still focus its actual browser.
            case('Little input window existing fallback', False, expected_body=True)
            loaded_little = run("w.gBrowser.selectedBrowser.loadURI(Services.io.newURI('data:text/html,<title>Owned Little page</title><input value=unchanged>'),{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});await pause(700);return state();")
            check('real Little window has expanded after navigation', not loaded_little['littleInput'] and
                  loaded_little['uri'].startswith('data:text/html,'), loaded_little)
            case('Little loaded window browser fallback', False)
            run('w.close();return true;')
            c.call('WebDriver:SwitchToWindow', {'handle': handles[0]})
            c.chrome(script_timeout_ms=20000)
        result['ownedProcessExitCode'] = process.returncode
    except BaseException as error:
        result['error'] = str(error)
        save()
result['profileRemoved'] = not profile.exists()
result['filesAfterMatch'] = before == {str(p.relative_to(app)): sha(p) for p in app.rglob('*') if p.is_file()}
result['passed'] = not result.get('error') and all(check['passed'] for check in result['checks']) and result['profileRemoved'] and result['filesAfterMatch']
result['limitations'] = ['Headless DOM/keyboard correctness; no native accessibility role, appearance, or next-key parity claim.',
                         'No normal profile, network queries, or installed app mutation.']
save()
print(json.dumps({'passed': result['passed'], 'checks': len(result['checks']),
                  'failed': [check['name'] for check in result['checks'] if not check['passed']], 'error': result.get('error')}))
raise SystemExit(0 if result['passed'] else 1)
