"""Check completion/arrow selection in a disposable, network-isolated profile."""
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
        script = fixture

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

        # Each boolean is the native reference's whole-character prefix result.
        scenarios = [('lattice', [('LATTICE', False), ('Lattice', False), ('lattice', True)]),
                     ('cafe\u0301', [('cafe', False), ('cafe\u0301', True), ('caf', True)]),
                     ('👩\u200d💻', [('👩', False), ('👩\u200d💻', True)]),
                     ('कि', [('क', False), ('कि', True)])]
        trusted_inputs = []
        for term, queries in scenarios:
            script = fixture.replace('lattice compiler', term + ' compiler').replace(
                'lattice models', term + ' models')
            state('seed')
            for engine in ['YouTube', 'Amazon', 'Google']:
                for query, matches in queries:
                    state('query', engine, '')
                    # ASCII follows trusted input; Unicode also checks real provider
                    # results and trusted arrows, without claiming to simulate an IME.
                    initial = keys(query) if query.isascii() else state('query', engine, query)
                    label = engine + ': ' + repr(query)
                    first = term + ' compiler'
                    second = term + ' models'
                    check(label + ' retains both eligible history terms',
                          first in initial['results'] and second in initial['results'], initial)
                    top = initial['results'][0]
                    expected = top if matches or top == query else query
                    check(label + ' default completion respects whole characters and case',
                          initial['value'] == expected and initial['start'] == utf16(query)
                          and initial['end'] == utf16(expected), initial)
                    selected = keys('\ue015')
                    title = initial['results'][1]
                    start = utf16(query) if matches or title == query else utf16(title)
                    check(label + ' arrow selection displays the full selected term',
                          selected['value'] == title and selected['start'] == start
                          and selected['end'] == utf16(title), selected)
                    returned = keys('\ue013')
                    check(label + ' returning to the default restores its completion policy',
                          returned['value'] == expected and returned['start'] == utf16(query)
                          and returned['end'] == utf16(expected), returned)
                    if query == 'LATTICE':
                        keys('\ue015')
                        edited = keys('\ue003')
                        check(label + ' Backspace edits the displayed selected term',
                              edited['value'] == title[:-1] and edited['query'] == title[:-1], edited)
                        state('query', engine, query)
                        selected = keys('\ue015')
                        destination = inst.client.run("""
                          const done=arguments[arguments.length-1];
                          const {SearchService:S}=ChromeUtils.importESModule(
                            'moz-src:///toolkit/components/search/SearchService.sys.mjs');
                          done(S.getEngineByName(arguments[0]).getSubmission(
                            arguments[1],null,'searchbar').uri.spec);
                        """, [engine, selected['value']])
                        keys('\ue007')
                        actual = inst.client.run("""
                          const done=arguments[arguments.length-1],expected=arguments[0];
                          const w=Services.wm.getMostRecentWindow('navigator:browser');
                          (async()=>{for(let i=0;i<100&&w.gBrowser.selectedBrowser.currentURI.spec!==expected;i++)
                            await new Promise(resolve=>w.setTimeout(resolve,25));
                            const result={url:w.gBrowser.selectedBrowser.currentURI.spec,scope:w.gURLBar.searchMode};
                            // Only the destination is under test. Stop the denied
                            // external load before its error page can take focus
                            // from the following trusted-keyboard case.
                            w.gBrowser.selectedBrowser.stop();
                            await new Promise(resolve=>w.requestAnimationFrame(()=>w.requestAnimationFrame(resolve)));
                            done(result);})();
                        """, [destination])
                        check(label + ' Enter submits the full arrow-selected term',
                              actual['url'] == destination and not actual['scope'], actual)
                state('query', engine, '')
                recent = keys('\ue015')
                check(engine + ': empty scope keeps its prompt for ' + term,
                      recent['value'] == '' and recent['start'] == recent['end'] == 0, recent)
            trusted_inputs.extend(recent['inputs'])

        check('input events are trusted', bool(trusted_inputs) and
              all(event['trusted'] for event in trusted_inputs), trusted_inputs)
        reference = json.loads((source / 'tools/site-search-history/completion-prefix-reference.json').read_text())
        native = inst.client.run("""
          const done=arguments[arguments.length-1];
          const {siteSearchCompletion:complete}=ChromeUtils.importESModule(
            'resource:///modules/zen/urlbar/ZenSiteSearchTerms.sys.mjs');
          const cases=arguments[0], failures=[];
          for(const row of cases) {
            const initial=complete(row.query,row.suggestion);
            const selected=complete(row.query,row.suggestion,1);
            const expected={value:row.suggestion,
              selectionStart:Math.min(row.selectionStart,row.suggestion.length),
              selectionEnd:row.selectionEnd};
            if(JSON.stringify(initial)!==JSON.stringify(row.hasPrefix?expected:null)||
               JSON.stringify(selected)!==JSON.stringify(expected)) failures.push(row);
          }
          done({count:cases.length,failures});
        """, [reference['cases']])
        check('packaged helper agrees with native character-prefix cases',
              native['count'] == len(reference['cases']) and not native['failures'], native)

print(json.dumps({'passed': True, 'checks': len(checks), 'report': str(report)}))
