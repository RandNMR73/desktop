from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit
import argparse
import base64
import hashlib
import html
import json
import mimetypes
import shutil
import sys
import tempfile
import threading
import time

work = Path(__file__).parent
checkout = Path('/Users/matthewnoto/Temp/zen-sidebar-reload-overflow')
fixtures = checkout / 'src/testing/web-platform/tests/css/css-color/astral-wide-background'
config = Path('/Users/matthewnoto/Temp/astralforge-space-heading-hover-audit')
cases = ('backgrounds', 'visited-alpha', 'repaint', 'root-background',
         'body-propagation', 'root-alpha', 'root-repaint', 'iframe-alpha', 'visited-style-privacy', 'paint-paths', 'paint-details', 'paint-details-repaint', 'paint-visited', 'paint-blur')
native_hook = b'''<script>
addEventListener('load', () => requestAnimationFrame(() => requestAnimationFrame(() => {
  dispatchEvent(new Event('TestRendered'));
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.documentElement.dataset.nativeFixtureReady = 'true';
  }));
})), { once: true });
</script>'''


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlsplit(self.path)
        path = unquote(parsed.path).lstrip('/')
        if not path:
            links = ''.join(f'<li><a href="/{c}.html?native=1">{html.escape(c)}</a> · '
                            f'<a href="/{c}-ref.html?native=1">reference</a></li>' for c in cases)
            data = ('<!doctype html><meta charset="utf-8"><title>Wide color comparison</title>'
                    '<style>body{font:20px system-ui;margin:40px}li{margin:12px 0}</style>'
                    '<h1>Wide color comparison</h1><p>Native visual fixtures; WPT originals remain unchanged.</p>'
                    f'<ul>{links}</ul>').encode()
            content_type = 'text/html'
        else:
            resource_root = Path('/Users/matthewnoto/Temp/zen-overscroll-engine.noindex/testing/web-platform/tests')
            harness = path in ('resources/testharness.js', 'resources/testharnessreport.js', 'fonts/Ahem.ttf')
            root = resource_root if harness else fixtures
            target = (root / path).resolve()
            if not target.is_relative_to(root.resolve()) or not target.is_file():
                self.send_error(404)
                return
            data = target.read_bytes()
            content_type = mimetypes.guess_type(path)[0] or 'application/octet-stream'
            if target.suffix == '.html' and parse_qs(parsed.query).get('native') == ['1']:
                data += native_hook
                if path == 'visited-style-privacy.html':
                    data += b'<script>add_completion_callback((tests,status)=>{window.nativeWPTResults={tests:tests.map(t=>({name:t.name,status:t.status,message:t.message})),status:{status:status.status,message:status.message}}});</script>'
                if parse_qs(parsed.query).get('nearest') == ['1']:
                    data += b'<style>img { image-rendering: pixelated !important; }</style>'
                repeated = {'root-background-ref.html': 'p3-orange.png',
                            'body-propagation-ref.html': 'p3-green.png',
                            'root-alpha-ref.html': 'p3-root-alpha.png',
                            'root-repaint-ref.html': 'p3-repaint.png'}
                if parse_qs(parsed.query).get('repeat') == ['1'] and path in repeated:
                    data += ('<style>html { background-image:url(resources/' + repeated[path] +
                             ');background-repeat:repeat; }img { display:none; }</style>').encode()
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser()
    global work, checkout, fixtures
    parser.add_argument('--app', type=Path)
    parser.add_argument('--output-dir', type=Path)
    parser.add_argument('--fixture-repo', type=Path)
    parser.add_argument('--mode', choices=('default', 'p3'), default='default')
    parser.add_argument('--scale', type=int, choices=(1, 2), default=1)
    parser.add_argument('--capture', choices=('compositor', 'software'), default='compositor')
    parser.add_argument('--physics', action='store_true')
    parser.add_argument('--headless', action='store_true')
    parser.add_argument('--control', action='store_true')
    parser.add_argument('--serve-only', action='store_true')
    parser.add_argument('--smoke', action='store_true')
    args = parser.parse_args()
    if args.output_dir:
        work = args.output_dir.resolve()
        work.mkdir(parents=True, exist_ok=True)
    if args.fixture_repo:
        checkout = args.fixture_repo.resolve()
        fixtures = checkout / 'src/testing/web-platform/tests/css/css-color/astral-wide-background'
    assert not (args.control and args.mode == 'p3'), 'The old control has no P3 implementation'
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}'
    manifest = {str(p.relative_to(fixtures)): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in sorted(fixtures.rglob('*')) if p.is_file()}
    if args.serve_only:
        print(json.dumps({'ready': True, 'base': base, 'cases': cases, 'files': len(manifest)}), flush=True)
        for line in sys.stdin:
            if line.strip() == 'stop':
                break
        server.shutdown()
        return
    app = (work.parent / 'overscroll-input-2026-11-02/Zen PGO Candidate.app' if args.control
           else work / 'Zen Wide Color Candidate.app')
    if args.app:
        app = args.app.resolve()
    assert app.is_dir(), app
    assert args.headless, 'Only an isolated headless browser may use this fixture driver'
    assert app.is_relative_to(Path('/Users/matthewnoto/Temp/zen-arc-validation')), app
    assert json.loads((app / 'Contents/Resources/astral-update.json').read_text())['stateFile'] in (
        '/Users/matthewnoto/Temp/zen-arc-validation/search-text-current-2026-11-07/fixture-update-state.json',
        '/Users/matthewnoto/Temp/zen-arc-validation/vertical-shadow-orientation-2026-11-08/fixture-update-state.json',
        '/Users/matthewnoto/Temp/zen-arc-validation/vertical-shadow-paint-order-2026-11-10/baseline-fixture-update-state.json',
        '/Users/matthewnoto/Temp/zen-arc-validation/vertical-shadow-paint-order-2026-11-10/candidate-fixture-update-state.json',
        '/Users/matthewnoto/Temp/zen-arc-validation/vertical-shadow-selection-runs-2026-11-10/baseline-fixture-update-state.json',
        '/Users/matthewnoto/Temp/zen-arc-validation/vertical-shadow-selection-runs-2026-11-10/candidate-fixture-update-state.json',
        '/Users/matthewnoto/Temp/zen-arc-validation/decoration-glyph-groups-2026-11-10/baseline-fixture-update-state.json',
        '/Users/matthewnoto/Temp/zen-arc-validation/decoration-glyph-groups-2026-11-10/candidate-fixture-update-state.json',
        '/Users/matthewnoto/Temp/zen-arc-validation/fallback-hyphen-shadows-2026-11-11/baseline-fixture-update-state.json',
        '/Users/matthewnoto/Temp/zen-arc-validation/fallback-hyphen-shadows-2026-11-11/candidate-fixture-update-state.json',
        '/Users/matthewnoto/Temp/zen-arc-validation/hyphen-decoration-bounds-2026-11-11/baseline-fixture-update-state.json',
        '/Users/matthewnoto/Temp/zen-arc-validation/hyphen-decoration-bounds-2026-11-11/candidate-fixture-update-state.json',
        '/Users/matthewnoto/Temp/zen-arc-validation/rtl-hyphen-order-2026-11-11/baseline-fixture-update-state.json',
        '/Users/matthewnoto/Temp/zen-arc-validation/rtl-hyphen-order-2026-11-11/candidate-fixture-update-state.json',
        '/Users/matthewnoto/Temp/zen-arc-validation/hyphen-overflow-bounds-2026-11-11/baseline-fixture-update-state.json',
        '/Users/matthewnoto/Temp/zen-arc-validation/hyphen-overflow-bounds-2026-11-11/candidate-fixture-update-state.json',
    ), 'Disposable updater required'
    sys.path[:0] = [str(config / 'tools/zen-bench'), str(config / 'scripts')]
    from zen_bench.instance import Instance, free_port
    from zen_bench.profile import harness_prefs, render_prefs
    import zen_profile
    import zen_mozlz4
    with tempfile.TemporaryDirectory(prefix='zen-wide-color-') as tmp:
        profile = Path(tmp) / 'profile'
        profile.mkdir()
        shutil.copytree(config / 'config/zen/chrome', profile / 'chrome', symlinks=True)
        (profile / 'chrome/arc-icons').symlink_to(config / 'config/zen/arc-icons')
        port = free_port()
        prefs = {**harness_prefs(port), 'remote.screenshot.use_readback': args.capture == 'compositor', 'apz.overscroll.arc_physics': args.physics, 'gfx.color_management.native_p3': args.mode == 'p3',
                 'layout.css.devPixelsPerPx': str(args.scale),
                 'gfx.color_management.mode': 1, 'gfx.color_management.force_srgb': False,
                 'gfx.color_management.display_profile': '', 'browser.startup.page': 3,
                 'browser.startup.homepage_override.mstone': 'ignore',
                 'startup.homepage_welcome_url': '', 'startup.homepage_welcome_url.additional': '',
                 'zen.welcome-screen.seen': True, 'zen.library.preview.sources.documents': False,
                 'zen.library.preview.sources.desktop': False, 'zen.library.preview.sources.screenshot': False,
                 'browser.topsites.useRemoteSetting': False, 'browser.newtabpage.activity-stream.default.sites': ''}
        (profile / 'user.js').write_text((config / 'config/zen/user.js').read_text() + '\n' + render_prefs(prefs))
        width = json.loads((config / 'config/zen/arc/arc-sidebar.json').read_text())['sidebar_width']
        (profile / 'xulstore.json').write_text(json.dumps(zen_profile.set_sidebar_width({}, width)))
        spaces = json.loads((config / 'config/zen/workspaces.json').read_text())
        model = zen_profile.seed({}, spaces, {
            'essentials': [{'id': 'wide-color-favorite', 'title': 'Wide color comparison', 'url': base + '/'}],
            'spaces': [{'space': s['uuid'], 'items': []} for s in spaces],
        })
        themes = json.loads((app / 'Contents/Resources/zen-native-theme/themes.json').read_text())
        serialized = json.dumps(model).replace('{11a50d7f-602d-587c-a1a0-ffff662996b9}', themes['themes'][0]['id'])
        zen_mozlz4.write_json(profile / 'zen-sessions.jsonlz4', json.loads(serialized))
        environment = {'MOZ_PURGE_CACHES': '1'}
        if args.headless:
            environment.update(MOZ_HEADLESS='1', MOZ_HEADLESS_WIDTH='1280', MOZ_HEADLESS_HEIGHT='900')
        label = ('control' if args.control else 'candidate') + '-' + args.mode
        with Instance(app, profile, port, env=environment, log=work / f'fixture-{label}.log') as inst:
            inst.client.sock.settimeout(45)
            inst.client.chrome(script_timeout_ms=30000)
            tab_state = inst.client.run('''
const done = arguments[arguments.length - 1];
const before = { empty: gBrowser.selectedTab.hasAttribute('zen-empty-tab'),
  transparent: gBrowser.selectedBrowser.getAttribute('transparent') };
const tab = gBrowser.addTab('about:blank', {
  triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
});
gBrowser.selectedTab = tab;
requestAnimationFrame(() => requestAnimationFrame(() => done({ before,
  after: { empty: tab.hasAttribute('zen-empty-tab'),
    transparent: tab.linkedBrowser.getAttribute('transparent') }
})));
''')
            handles = inst.client.call('WebDriver:GetWindowHandles')
            if isinstance(handles, dict):
                handles = handles['value']
            inst.client.call('WebDriver:SwitchToWindow', {'handle': handles[-1], 'focus': True})
            # Keep both engines' captures at the same explicit size, independent
            # of the macOS Dock's current available-screen inset.
            print('Setting owned fixture window to 1280 by 850', file=sys.stderr, flush=True)
            rect = inst.client.run('''
const done = arguments[arguments.length - 1];
window.moveTo(4, 33);
window.resizeTo(1280, 850);
window.setTimeout(() => done({width: window.outerWidth, height: window.outerHeight}), 250);
''')
            assert rect['width'] == 1280 and rect['height'] == 850, rect
            print('Owned fixture size verified', file=sys.stderr, flush=True)
            inst.client.chrome(script_timeout_ms=30000)
            status = inst.client.run('''
const done = arguments[arguments.length - 1];
const { Troubleshoot } = ChromeUtils.importESModule('resource://gre/modules/Troubleshoot.sys.mjs');
Troubleshoot.snapshot().then(snapshot => done({
  source: Services.appinfo.sourceURL, buildID: Services.appinfo.appBuildID,
  prefs: { compositorReadback: Services.prefs.getBoolPref('remote.screenshot.use_readback'), p3: Services.prefs.getBoolPref('gfx.color_management.native_p3', false),
    mode: Services.prefs.getIntPref('gfx.color_management.mode'),
    forceSRGB: Services.prefs.getBoolPref('gfx.color_management.force_srgb') },
  graphics: snapshot.graphics
}));
''')
            assert status['prefs']['compositorReadback'] == (args.capture == 'compositor')
            report = {'capturePath': 'owned-headless-' + args.capture, 'ready': True, 'pid': inst.pid, 'app': str(app), 'base': base,
                      'headless': args.headless, 'mode': args.mode, 'control': args.control, 'scale': args.scale,
                      'fixtureSHA256': manifest, 'nativeHookSHA256': hashlib.sha256(native_hook).hexdigest(),
                      'runtime': status, 'tabState': tab_state, 'renderingValidated': False}
            (work / f'fixture-{label}-state.json').write_text(json.dumps(report, indent=2) + '\n')
            print(json.dumps({k: v for k, v in report.items() if k not in ('runtime', 'fixtureSHA256')}), flush=True)
            if not args.smoke:
                for line in sys.stdin:
                    if line.strip() == 'stop':
                        break
                    request = json.loads(line)
                    name = request['case']
                    assert name in cases
                    filename = name + ('-ref' if request.get('reference') else '') + '.html'
                    url = base + '/' + filename + '?native=1' + ('&repeat=1' if request.get('repeat') else '')
                    visited_setup = None
                    if name in ('visited-alpha', 'visited-style-privacy', 'paint-visited') and not request.get('reference'):
                        inst.client.chrome(script_timeout_ms=30000)
                        visited_setup = inst.client.run('''
const url = arguments[0];
const done = arguments[arguments.length - 1];
const { PlacesUtils } = ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
(async () => {
  await PlacesUtils.history.insert({ url, visits: [{ date: new Date(),
    transition: PlacesUtils.history.TRANSITIONS.LINK }] });
  done({ url, hasVisits: await PlacesUtils.history.hasVisits(url) });
})().catch(error => done({ error: String(error) }));
''', [url])
                        assert visited_setup.get('hasVisits') is True, visited_setup
                    inst.client.call('Marionette:SetContext', {'value': 'content'})
                    inst.client.call('WebDriver:Navigate', {'url': url})
                    result = inst.client.run('''
const done = arguments[arguments.length - 1];
(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map(image => image.decode()));
  const start = performance.now();
  while (document.documentElement.dataset.nativeFixtureReady !== 'true' ||
         document.documentElement.classList.contains('reftest-wait') ||
         document.documentElement.dataset.selectionFixtureReady !== 'true' ||
         (location.pathname.includes('visited-style-privacy') && !window.nativeWPTResults)) {
    if (performance.now() - start > 10000) throw new Error('Fixture did not finish rendering');
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
  let stableSince = performance.now();
  let dimensions = `${innerWidth},${innerHeight},${devicePixelRatio}`;
  const settleStart = performance.now();
  while (performance.now() - stableSince < 750) {
    if (performance.now() - settleStart > 10000) throw new Error('Viewport did not settle');
    await new Promise(resolve => requestAnimationFrame(resolve));
    const next = `${innerWidth},${innerHeight},${devicePixelRatio}`;
    if (next !== dimensions) { dimensions = next; stableSince = performance.now(); }
  }
  done({ title: document.title, url: location.href, ready: true, samples: [...document.querySelectorAll('.sample')].map(e=>({name:e.parentElement.dataset.case,rect:e.getBoundingClientRect().toJSON(),text:e.textContent,mode:getComputedStyle(e).writingMode,orientation:getComputedStyle(e).textOrientation})),
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      screenX: mozInnerScreenX, screenY: mozInnerScreenY, windowX: screenX, windowY: screenY, outerWidth, outerHeight },
    selection: { ready: document.documentElement.dataset.selectionFixtureReady, text: getSelection().toString(), highlights: [...CSS.highlights.keys()] },
    wptResults: window.nativeWPTResults || null,
    p3Display: matchMedia('(color-gamut: p3)').matches,
    canvasColorSpaces: window.paintPathCanvasSpaces || null,
    tiles: [...document.querySelectorAll('.tile, td')].map(element => ({
      path: element.dataset.paintPath || null,
      rect: element.getBoundingClientRect().toJSON(), background: getComputedStyle(element).backgroundColor
    })) });
})().catch(error => done({ error: String(error) }));
''')
                    if request.get('screenshot'):
                        output = (work / request['screenshot']).resolve()
                        assert output.is_relative_to(work.resolve())
                        snapshot = inst.client.call('WebDriver:TakeScreenshot', {'full': False, 'scroll': False})
                        encoded = snapshot.get('value') if isinstance(snapshot, dict) else snapshot
                        image = base64.b64decode(encoded)
                        assert image.startswith(b'\x89PNG\r\n\x1a\n')
                        output.write_bytes(image)
                        result['screenshot'] = {'path': str(output), 'sha256': hashlib.sha256(image).hexdigest(),
                            'capture': 'Gecko content screenshot; not a physical-display or wide-gamut measurement'}
                    inst.client.chrome(script_timeout_ms=30000)
                    visible = inst.client.run('''
const done = arguments[arguments.length - 1];
done({ url: gBrowser.selectedBrowser.currentURI.spec,
  empty: gBrowser.selectedTab.hasAttribute('zen-empty-tab'),
  transparent: gBrowser.selectedBrowser.getAttribute('transparent') });
''')
                    assert visible['url'] == result.get('url'), (visible, result)
                    assert not visible['empty'] and visible['transparent'] is None, visible
                    result['visibleTab'] = visible
                    result['visitedSetup'] = visited_setup
                    if request.get('output'):
                        output = (work / request['output']).resolve()
                        assert output.is_relative_to(work.resolve())
                        output.write_text(json.dumps(result, indent=2) + '\n')
                    print(json.dumps(result), flush=True)
        report.update(stopped=True, stoppedAt=time.time())
        (work / f'fixture-{label}-state.json').write_text(json.dumps(report, indent=2) + '\n')
    server.shutdown()


if __name__ == '__main__':
    main()
