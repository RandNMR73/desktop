"""Compare scoped Tab acceptance and exit in a disposable, network-isolated profile."""
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
        for engine in ['YouTube', 'Amazon', 'Google']:
            for query in ['lattice', 'LATTICE', 'unmatchedfixture']:
                state('query', engine, '')
                before = keys(query)
                label = engine + ': ' + query
                after = keys('\ue004')
                check(label + ' Tab accepts the visible text without changing rows',
                      after['value'] == before['value'] and
                      after['selected'] == before['selected'] and
                      after['results'] == before['results'], after)
                check(label + ' Tab collapses completion at the end and retains scope',
                      after['start'] == after['end'] == utf16(before['value']) and
                      after['mode']['engineName'] == engine and after['focused'] and after['open'], after)
                check(label + ' accepting a completion preserves the original query',
                      after['query'] == before['query'], after)
                repeat = keys('\ue004')
                check(label + ' repeated Tab keeps the same query, value and result',
                      all(repeat[k] == after[k] for k in ['query','value','start','end','selected','results']), repeat)
                edited = keys('x')
                check(label + ' typing continues after the accepted completion',
                      edited['value'] == before['value'] + 'x' and
                      edited['query'] == before['value'] + 'x', edited)
                state('query', engine, query)
                keys('\ue004')
                edited = keys('\ue003')
                check(label + ' Backspace deletes one character after acceptance',
                      edited['value'] == before['value'][:-1] and
                      edited['query'] == before['value'][:-1], edited)

            before = state('query', engine, 'lattice')
            selected = keys('\ue015')
            after = keys('\ue004')
            check(engine + ': Tab accepts an arrow-selected term in place',
                  after['value'] == selected['value'] and after['selected'] == selected['selected'] and
                  after['results'] == selected['results'] and after['start'] == after['end'] ==
                  utf16(selected['value']), after)
            destination = inst.client.run("""
              const done=arguments[arguments.length-1];
              const {SearchService:S}=ChromeUtils.importESModule(
                'moz-src:///toolkit/components/search/SearchService.sys.mjs');
              done(S.getEngineByName(arguments[0]).getSubmission(arguments[1],null,'searchbar').uri.spec);
            """, [engine, after['value']])
            keys('\ue007')
            actual = inst.client.run("""
              const done=arguments[arguments.length-1],expected=arguments[0];
              const w=Services.wm.getMostRecentWindow('navigator:browser');
              (async()=>{for(let i=0;i<100&&w.gBrowser.selectedBrowser.currentURI.spec!==expected;i++)
                await new Promise(resolve=>w.setTimeout(resolve,25));
                const result={url:w.gBrowser.selectedBrowser.currentURI.spec,scope:w.gURLBar.searchMode};
                w.gBrowser.selectedBrowser.stop();
                await new Promise(resolve=>w.requestAnimationFrame(()=>w.requestAnimationFrame(resolve)));
                done(result);})();
            """, [destination])
            check(engine + ': Enter submits the accepted selection',
                  actual['url'] == destination and not actual['scope'], actual)

            for select_recent in [False, True]:
                state('query', engine, '')
                if select_recent: keys('\ue015')
                after = keys('\ue004')
                check(engine + ': empty Tab exits scope after selecting recent=' + str(select_recent),
                      not (after['mode'] or {}).get('engineName') and not after['scoped'] and after['value'] == '' and after['start'] == after['end'] == 0
                      and after['focused'] and after['open'], after)

        # Real alias entry also creates the restoration state used by Backspace.
        for suffix in ['\ue004', '\ue003', '\ue00c']:
            inst.client.run("""
              const done=arguments[arguments.length-1],w=Services.wm.getMostRecentWindow('navigator:browser');
              w.gURLBar.searchMode=null;w.gURLBar.focus();w.gURLBar.search('youtube.com');
              w.gURLBar.lastQueryContextPromise.then(()=>done(true));
            """)
            entered = keys('\ue004')
            check('alias Tab enters YouTube before ' + repr(suffix),
                  entered['mode']['engineName'] == 'YouTube' and entered['value'] == '', entered)
            after = keys(suffix)
            expected = 'youtube.com' if suffix == '\ue003' else ''
            check('scope exit preserves the expected restoration for ' + repr(suffix),
                  not (after['mode'] or {}).get('engineName') and not after['scoped'] and after['value'] == expected and after['focused'], after)
        events = state()['inputs']
        check('typed input events are trusted', bool(events) and all(e['trusted'] for e in events), events)
        print(json.dumps({'passed': True, 'checks': len(checks)}))
