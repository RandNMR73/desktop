"""Exercise Favorite URL/artwork lifecycle against a loopback-only web fixture."""
from pathlib import Path
import argparse
import http.server
import json
import shutil
import sys
import tempfile
import threading

parser = argparse.ArgumentParser()
parser.add_argument('--app', required=True, type=Path)
parser.add_argument('--config', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
a = parser.parse_args()
sys.path[:0] = [str(a.config/'tools/zen-bench'), str(a.config/'scripts')]
from zen_bench.instance import Instance, free_port
from zen_bench.profile import harness_prefs, render_prefs
import zen_profile
import zen_mozlz4

hosts = ['twitter.com', 'x.com', 'mail.google.com', 'open.spotify.com',
         'youtube.com', 'music.youtube.com', 'web.whatsapp.com']
requests = []
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        host = self.headers.get('Host', '').split(':')[0]
        requests.append({'host': host, 'path': self.path})
        if host not in hosts:
            self.send_error(400); return
        if self.path == '/redirect':
            self.send_response(302)
            self.send_header('Location', f'http://x.com:{self.server.server_port}/final')
            self.end_headers(); return
        if self.path == '/favicon.svg':
            body = b'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#8060d0"/></svg>'
            mime = 'image/svg+xml'
        else:
            body = b'<title>Favorite artwork fixture</title><link rel="icon" href="/favicon.svg"><p>Local Favorite artwork navigation fixture.</p>'
            mime = 'text/html'
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def log_message(self, *_): pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
a.output.parent.mkdir(parents=True, exist_ok=True)
try:
    with tempfile.TemporaryDirectory(prefix='zen-search-color-retention-') as temp:
        profile = Path(temp)
        conf = a.config/'config/zen'
        shutil.copytree(conf/'chrome', profile/'chrome', symlinks=True)
        (profile/'chrome/arc-icons').symlink_to(conf/'arc-icons')
        spaces = json.loads((conf/'workspaces.json').read_text())
        themes = json.loads((a.app/'Contents/Resources/zen-native-theme/themes.json').read_text())
        for space, theme in zip(spaces, themes['themes']): space['uuid'] = theme['id']
        zen_mozlz4.write_json(profile/'zen-sessions.jsonlz4', zen_profile.seed({}, spaces, {'essentials': [], 'spaces': []}))
        port = free_port()
        prefs = {**harness_prefs(port), 'zen.welcome-screen.seen': True,
                 'browser.startup.homepage_override.mstone': 'ignore',
                 'startup.homepage_welcome_url': '', 'startup.homepage_welcome_url.additional': '',
                 'zen.library.preview.sources.documents': False,
                 'zen.library.preview.sources.desktop': False,
                 'zen.library.preview.sources.screenshot': False,
                 'network.dns.localDomains': ','.join(hosts), 'network.trr.mode': 5,
                 'network.proxy.type': 0, 'network.stricttransportsecurity.preloadlist': False,
                 'dom.security.https_first': False, 'dom.security.https_first_schemeless': False,
                 'dom.security.https_only_mode': False}
        (profile/'user.js').write_text((conf/'user.js').read_text()+'\n'+render_prefs(prefs))
        with Instance(a.app, profile, port, env={'MOZ_PURGE_CACHES': '1'}, log=a.output.with_suffix('.log')) as inst:
            inst.client.chrome(script_timeout_ms=120000)
            result = inst.client.run(Path(__file__).with_name('browser-app-artwork.js').read_text(), [server.server_port])
        result['requests'] = requests
        a.output.write_text(json.dumps(result, indent=2)+'\n')
        print(json.dumps({'passed': result.get('passed'), 'checks': len(result.get('checks', [])), 'error': result.get('error')}))
        raise SystemExit(0 if result.get('passed') else 1)
finally:
    server.shutdown()
