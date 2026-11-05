"""Check command-bar reverse focus and tab preservation in a disposable, network-isolated profile."""
from pathlib import Path
import argparse
import json
import shutil
import sys
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--app', type=Path, required=True)
parser.add_argument('--config-repo', type=Path, required=True)
parser.add_argument('--report', type=Path, required=True)
args = parser.parse_args()
source = Path(__file__).resolve().parents[2]
config = args.config_repo.resolve()
report = args.report.resolve()
report.parent.mkdir(parents=True, exist_ok=True)
sys.path[:0] = [str(config / 'tools/zen-bench'), str(config / 'scripts')]
from zen_bench.instance import Instance, free_port
from zen_bench.profile import harness_prefs, render_prefs
import zen_profile
import zen_mozlz4

checks = []


def check(name, condition, actual):
    checks.append({'name': name, 'pass': bool(condition), 'actual': actual})
    report.write_text(json.dumps({'passed': all(c['pass'] for c in checks),
                                 'checks': checks}, ensure_ascii=False, indent=2) + '\n')
    if not condition:
        raise AssertionError(name)


def utf16(text):
    return len(text.encode('utf-16-le')) // 2


with tempfile.TemporaryDirectory(prefix='zen-search-typed-') as tmp:
    profile = Path(tmp)
    conf = config / 'config/zen'
    app = args.app.resolve()
    shutil.copytree(conf / 'chrome', profile / 'chrome')
    (profile / 'chrome/arc-icons').symlink_to(conf / 'arc-icons')
    model = zen_profile.seed({}, json.loads((conf / 'workspaces.json').read_text()),
                             {'essentials': [], 'spaces': []})
    themes = json.loads((app / 'Contents/Resources/zen-native-theme/themes.json').read_text())
    model = json.loads(json.dumps(model).replace('{11a50d7f-602d-587c-a1a0-ffff662996b9}',
                                               themes['themes'][0]['id']))
    zen_mozlz4.write_json(profile / 'zen-sessions.jsonlz4', model)
    port = free_port()
    prefs = {**harness_prefs(port), 'browser.startup.page': 0, 'zen.welcome-screen.seen': True,
             'browser.startup.homepage_override.mstone': 'ignore',
             'browser.urlbar.closeOnWindowBlur': False, 'browser.search.suggest.enabled': False,
             'startup.homepage_welcome_url': '', 'startup.homepage_welcome_url.additional': ''}
    (profile / 'user.js').write_text((conf / 'user.js').read_text() + '\n' + render_prefs(prefs))
    with Instance(app, profile, port, env={'MOZ_PURGE_CACHES': '1'},
                  log=report.with_suffix('.log')) as inst:
        inst.client.chrome(script_timeout_ms=30000)
        fixture = (source / 'tools/site-search-history/browser-deletion-fixture.js').read_text()
        script = fixture.replace('    value: b.value,',
            '    mode: b.searchMode, focused: b.focused, open: b.view.isOpen, '
            'selected: b.view.selectedRowIndex, scoped: b.hasAttribute("zen-site-search"), value: b.value,')

        def state(operation='state', engine='YouTube', query=''):
            result = inst.client.run(script, [operation, engine, query])
            assert not result.get('error'), result
            return result

        def keys(text):
            actions = [a for value in text for a in
                       [{'type': 'keyDown', 'value': value}, {'type': 'keyUp', 'value': value}]]
            inst.client.call('WebDriver:PerformActions',
                             {'actions': [{'type': 'key', 'id': 'keyboard', 'actions': actions}]})
            return state()

        state('seed')

        def setup(engine, query):
            return inst.client.run("""
              const done=arguments[arguments.length-1],w=Services.wm.getMostRecentWindow('navigator:browser');
              (async()=>{
                w.gURLBar.view.close();
                await new Promise(r=>w.setTimeout(r,50));
                w.gURLBar.searchMode=null;
                w.gZenUIManager.handleNewTab(false,false,'tab',true);
                w.gURLBar.searchMode=arguments[0]?{engineName:arguments[0],entry:'shortcut',isPreview:false}:null;
                w.gURLBar.search(arguments[1]);await w.gURLBar.lastQueryContextPromise;
                done({tabs:w.gBrowser.tabs.length,tab:w.gBrowser.selectedTab.linkedPanel,
                      uri:w.gBrowser.selectedBrowser.currentURI.spec});
              })();
            """,[engine,query])

        def reverse(modifier=None):
            modifiers=['\ue008'] + ([modifier] if modifier else [])
            actions=[{'type':'keyDown','value':v} for v in modifiers]
            actions += [{'type':'keyDown','value':'\ue004'},{'type':'keyUp','value':'\ue004'}]
            actions += [{'type':'keyUp','value':v} for v in reversed(modifiers)]
            inst.client.call('WebDriver:PerformActions',{'actions':[{'type':'key','id':'keyboard','actions':actions}]})
            return inst.client.run("""
              const done=arguments[arguments.length-1],w=Services.wm.getMostRecentWindow('navigator:browser');
              w.setTimeout(()=>done({tabs:w.gBrowser.tabs.length,tab:w.gBrowser.selectedTab.linkedPanel,
                uri:w.gBrowser.selectedBrowser.currentURI.spec,scope:w.gURLBar.searchMode,
                inputFocused:w.gURLBar.focused,view:w.gURLBar.view.isOpen,
                session:w.gURLBar.hasAttribute('zen-newtab'),
                browserFocused:w.document.activeElement===w.gBrowser.selectedBrowser,
                popup:w.gNativeSidebar?.urlbarHost?.isOpen}),100);
            """)

        for page in ['empty','loaded']:
            if page=='loaded':
                inst.client.run("""
                  const done=arguments[arguments.length-1],w=Services.wm.getMostRecentWindow('navigator:browser');
                  const tab=w.gBrowser.addTab('data:text/html,<title>Reverse focus fixture</title><input value="unchanged">',
                    {triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});
                  w.gBrowser.selectedTab=tab;w.setTimeout(()=>done(true),500);
                """)
            for engine in ['YouTube','Amazon','Google',None]:
                for query in ['', 'lattice', 'LATTICE']:
                    label=f'{page} / {engine or "ordinary"} / {query!r}'
                    before=setup(engine,query)
                    after=reverse()
                    check(label+' closes the command bar and releases its session',
                          not after['view'] and not after['session'] and not after['inputFocused'],after)
                    check(label+' preserves the selected tab, tab count and URL',
                          all(after[k]==before[k] for k in ['tabs','tab','uri']),after)
                    check(label+' returns focus through the normal browser close path',
                          after['browserFocused'],after)
                    reopened=setup(engine,'')
                    check(label+' reopens without a stale close dismissing the new session',
                          state()['open'] and state()['focused'] and reopened==before,state())

        # A modified reverse-Tab shortcut must not be mistaken for plain Shift-Tab.
        for modifier in ['\ue009','\ue00a','\ue03d']:
            setup('YouTube','lattice')
            after=reverse(modifier)
            check('modified Shift-Tab is not consumed by reverse focus: '+repr(modifier),
                  after['view'] and after['session'],after)
        print(json.dumps({'passed': True, 'checks': len(checks)}))
