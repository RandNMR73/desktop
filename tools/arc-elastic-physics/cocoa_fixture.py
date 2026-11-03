from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import argparse
import hashlib
import json
import shutil
import sys
import tempfile
import threading
import time

support = Path(__file__).parent


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        short = self.path.startswith('/short')
        nested = self.path.startswith('/nested')
        behavior = 'none' if self.path.startswith('/nested-none') else 'contain'
        snap = self.path.startswith('/nested-snap')
        transform = ('scale(0.75)' if self.path.startswith('/nested-scale') else
                     'rotate(5deg)' if self.path.startswith('/nested-rotate') else 'none')
        title = 'Cocoa bounce: ' + ('short page' if short else 'nested ' + behavior if nested else 'long page')
        data = ('''<!doctype html><meta charset="utf-8"><title>''' + title + '''</title>
<style>html{background:#dbdfeb}body{margin:0;background:#f1f3f8;color:#14243b;font:24px system-ui}
header{height:100px;box-sizing:border-box;padding:24px;background:#153f73;color:white;border-top:8px solid #e63e63}
main{padding:30px 60px;box-sizing:border-box;''' + ('' if short or nested else 'height:3000px;') + '''}
#nested{height:350px;overflow:auto;border:8px solid #7247af;overscroll-behavior:''' + behavior +
                ';transform:' + transform + ';transform-origin:top left;' + ('scroll-snap-type:y mandatory;' if snap else '') + '''}
#nested-content{height:''' + ('1400' if snap else '1600') + 'px;border-top:' + ('0' if snap else '8px solid #e63e63') + ''';box-sizing:border-box;background:repeating-linear-gradient(#dce9fb 0 99px,#5276a5 99px 100px)}
.snap-section{height:350px;scroll-snap-align:start;box-sizing:border-box;border-top:8px solid #e63e63}
footer{height:100px;background:#153f73;color:white;border-bottom:8px solid #e63e63;box-sizing:border-box;padding:24px}
</style><header>''' + title + ''' — top marker</header><main>
<p>Visible Mac input test</p>''' + ('<div id="nested"><div id="nested-content">' +
                (''.join(f'<section class="snap-section">Section {i + 1}</section>' for i in range(4)) if snap else 'Nested top marker') +
                '</div></div>' if nested else '') + '''</main><footer>Bottom marker</footer>
<script>window.fixtureEvents=[];addEventListener('wheel',event=>{const row={trusted:event.isTrusted,dy:event.deltaY,mode:event.deltaMode,time:performance.now(),target:event.target.id||event.target.localName};fixtureEvents.push(row);setTimeout(()=>row.prevented=event.defaultPrevented,0)},{capture:true,passive:true});</script>''').encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--config-repo', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--physics', action='store_true')
    parser.add_argument('--sidebar-tabs', type=int, default=2)
    parser.add_argument('--label', default='')
    parser.add_argument('--native-helper', type=Path)
    args = parser.parse_args()
    if args.native_helper:
        args.native_helper = args.native_helper.resolve(strict=True)
    assert sys.platform == 'darwin', 'Cocoa tests require macOS'
    work = args.output_dir.resolve()
    work.mkdir(parents=True, exist_ok=True)
    config = args.config_repo.resolve()
    assert (config / 'tools/zen-bench/zen_bench/instance.py').is_file()
    sys.path[:0] = [str(config / 'tools/zen-bench'), str(config / 'scripts')]
    from zen_bench.instance import Instance, free_port
    from zen_bench.profile import harness_prefs, render_prefs
    import zen_profile
    import zen_mozlz4
    assert 0 <= args.sidebar_tabs <= 40
    app = args.app.resolve()
    assert app.is_dir(), app
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    label = 'arc' if args.physics else 'gecko'
    if args.label:
        assert args.label.isalnum()
        label += '-' + args.label
    with tempfile.TemporaryDirectory(prefix='zen-cocoa-physics-') as tmp:
        profile = Path(tmp) / 'profile'
        profile.mkdir()
        shutil.copytree(config / 'config/zen/chrome', profile / 'chrome', symlinks=True)
        (profile / 'chrome/arc-icons').symlink_to(config / 'config/zen/arc-icons')
        port = free_port()
        prefs = {**harness_prefs(port), 'apz.overscroll.arc_physics': args.physics,
                 'apz.test.logging_enabled': True, 'gfx.color_management.native_p3': False,
                 'browser.startup.page': 3, 'browser.startup.homepage_override.mstone': 'ignore',
                 'startup.homepage_welcome_url': '', 'startup.homepage_welcome_url.additional': '',
                 'zen.welcome-screen.seen': True, 'zen.library.preview.sources.documents': False,
                 'zen.library.preview.sources.desktop': False, 'zen.library.preview.sources.screenshot': False,
                 'browser.topsites.useRemoteSetting': False, 'browser.newtabpage.activity-stream.default.sites': ''}
        (profile / 'user.js').write_text((config / 'config/zen/user.js').read_text() + '\n' + render_prefs(prefs))
        width = json.loads((config / 'config/zen/arc/arc-sidebar.json').read_text())['sidebar_width']
        (profile / 'xulstore.json').write_text(json.dumps(zen_profile.set_sidebar_width({}, width)))
        spaces = json.loads((config / 'config/zen/workspaces.json').read_text())
        model = zen_profile.seed({}, spaces, {
            'essentials': [{'id': 'cocoa-favorite', 'title': 'Cocoa fixture', 'url': base + '/long'}],
            'spaces': [{'space': s['uuid'], 'items': [
                {'id': f'cocoa-{i}-{j}', 'title': f'Sidebar item {j + 1:02d}', 'url': base + f'/item-{i}-{j}'}
                for j in range(args.sidebar_tabs)]} for i, s in enumerate(spaces)],
        })
        themes = json.loads((app / 'Contents/Resources/zen-native-theme/themes.json').read_text())
        serialized = json.dumps(model).replace('{11a50d7f-602d-587c-a1a0-ffff662996b9}', themes['themes'][0]['id'])
        zen_mozlz4.write_json(profile / 'zen-sessions.jsonlz4', json.loads(serialized))
        with Instance(app, profile, port, env={'MOZ_PURGE_CACHES': '1'},
                      log=work / f'cocoa-{label}.log') as inst:
            inst.client.chrome(script_timeout_ms=30000)
            inst.client.run('''
const done = arguments[arguments.length - 1];
const tab = gBrowser.addTab('about:blank', {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()});
gBrowser.selectedTab = tab;
requestAnimationFrame(() => requestAnimationFrame(() => done(true)));
''')
            handles = inst.client.call('WebDriver:GetWindowHandles')
            if isinstance(handles, dict):
                handles = handles['value']
            inst.client.call('WebDriver:SwitchToWindow', {'handle': handles[-1], 'focus': True})
            state = {'pid': inst.pid, 'app': str(app), 'base': base, 'mode': label,
                     'nativeInput': 'Cocoa scrollWheel via owned window test API',
                     'nativeHelperSHA256': hashlib.sha256(args.native_helper.read_bytes()).hexdigest() if args.native_helper else None,
                     'physicalTrackpadVerified': False, 'startedAt': time.time()}
            (work / f'cocoa-{label}-state.json').write_text(json.dumps(state, indent=2) + '\n')
            print(json.dumps({'ready': True, **state}), flush=True)
            for line in sys.stdin:
                if line.strip() == 'stop':
                    break
                request = json.loads(line)
                try:
                    operation = request['operation']
                    if operation == 'navigate':
                        page = request.get('page', 'long')
                        assert page in ('long', 'short', 'nested-contain', 'nested-none',
                                        'nested-snap', 'nested-scale', 'nested-rotate')
                        inst.client.call('Marionette:SetContext', {'value': 'content'})
                        inst.client.call('WebDriver:Navigate', {'url': base + '/' + page})
                        result = inst.client.run((support / 'cocoa-content-state.js').read_text(), [request])
                    elif operation in ('snapshot', 'reset', 'mutate') and request.get('target', 'page') != 'sidebar':
                        inst.client.call('Marionette:SetContext', {'value': 'content'})
                        result = inst.client.run((support / 'cocoa-content-state.js').read_text(), [request])
                    else:
                        assert operation in ('pan', 'snapshot', 'reset', 'zoom', 'release', 'release-state',
                                             'native-pan', 'native-sequence', 'native-sequence-state')
                        if operation.startswith('native-'):
                            assert args.native_helper, 'A compiled isolated native fixture helper is required'
                            request['nativeHelperPath'] = str(args.native_helper)
                        inst.client.chrome(script_timeout_ms=30000)
                        result = inst.client.run((support / 'cocoa-chrome-input.js').read_text(), [request])
                    if request.get('output'):
                        output = work / request['output']
                        assert output.parent == work and output.suffix == '.json'
                        output.write_text(json.dumps(result, indent=2) + '\n')
                    printed = dict(result)
                    if sequence := result.get('nativeSequence'):
                        printed['nativeSequence'] = {**sequence, 'events': len(sequence['events'])}
                    print(json.dumps(printed), flush=True)
                except Exception as error:
                    print(json.dumps({'ok': False, 'error': str(error)}), flush=True)
    server.shutdown()


if __name__ == '__main__':
    main()
