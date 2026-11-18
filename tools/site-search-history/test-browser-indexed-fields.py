"""Validate the real packaged history function and provider in an owned profile."""
from pathlib import Path
import argparse
import datetime
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

sys.dont_write_bytecode = True

def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def inventory(app):
    result = {}
    for path in sorted(app.rglob('*')):
        assert not path.is_symlink(), 'Unexpected app symlink'
        if path.is_file():
            result[str(path.relative_to(app))] = sha(path)
    return result

p = argparse.ArgumentParser(description=__doc__)
for name in ('app', 'manifest', 'module-source', 'bench-tools', 'output', 'budget-root', 'clone-budget-manifest'):
    p.add_argument('--' + name, type=Path, required=True)
for name in ('manifest-sha256', 'clone-budget-sha256'):
    p.add_argument('--' + name, required=True)
p.add_argument('--fixture-now', type=int, required=True)
a = p.parse_args()
app, root, output = a.app.resolve(), a.budget_root.resolve(), a.output.resolve()
assert app.suffix == '.app' and output.is_relative_to(root) and not output.exists()
assert not output.is_relative_to(app)
assert sha(a.manifest) == a.manifest_sha256
assert sha(a.clone_budget_manifest) == a.clone_budget_sha256
manifest = json.loads(a.manifest.read_text())
clone = json.loads(a.clone_budget_manifest.read_text())
assert manifest['app'] == str(app) and manifest['signatureVerified'] and manifest['updaterConfigAbsent']
assert inventory(app) == manifest['files']
assert not (app / 'Contents/Resources/astral-update.json').exists()
clone_app = Path(clone['app'])
assert clone_app.is_relative_to(root) and clone['cloneMechanism'].startswith('clonefile(2)')
assert inventory(clone_app) == clone['files']
shared = set(clone['sharedCloneFilesRelativeToEvidence'])
for name in shared:
    path = root / name
    assert path.resolve().is_relative_to(clone_app)
    assert sha(path) == clone['files'][str(path.relative_to(clone_app))]
subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(app)], check=True, capture_output=True)
source = a.module_source.read_text()
start = source.index('export async function typedSiteSearches')
end = source.index('/** Match the combined browser history', start)
function_source = source[start:end].removeprefix('export ').strip()
fixture = Path(__file__).with_name('browser-indexed-fields-validation.js')
helpers = [a.bench_tools / 'zen_bench' / name for name in ('__init__.py', 'instance.py', 'marionette.py', 'profile.py')]
pins = {str(path): sha(path) for path in [Path(__file__), fixture, a.module_source, a.manifest, a.clone_budget_manifest, *helpers]}
sys.path.insert(0, str(a.bench_tools))
from zen_bench.instance import Instance, free_port
from zen_bench.profile import harness_prefs, render_prefs

output.mkdir()
result = {'passed': False, 'argv': sys.argv, 'inputPins': pins, 'benchTools': str(a.bench_tools),
          'manifestSHA256': a.manifest_sha256, 'fixtureNow': a.fixture_now,
          'startedUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'samples': [],
          'allocationAccounting': 'Count all evidence files except hash-verified unchanged clonefile(2) app files; this is not an APFS physical extent measurement.',
          'limits': {'additionalAllocatedBytes': 192 * 1024**2, 'minimumFreeBytes': 2 * 1024**3, 'wallSeconds': 180}}
inst = None
stopped = threading.Event()
failures = []

def allocation():
    total = 0
    for path in root.rglob('*'):
        if str(path.relative_to(root)) in shared:
            continue
        try:
            total += path.lstat().st_blocks * 512
        except FileNotFoundError:
            pass
    return total

def stop_owned():
    if inst and inst.proc:
        try:
            os.killpg(inst.proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

def guard():
    start = time.monotonic()
    try:
        while not stopped.wait(.25):
            size, free = allocation(), shutil.disk_usage(root).free
            result['samples'].append({'chargedAllocatedBytes': size, 'freeBytes': free, 'seconds': time.monotonic() - start})
            if size > 192 * 1024**2 or free < 2 * 1024**3 or time.monotonic() - start > 180:
                failures.append('resource/time limit')
                stop_owned()
                return
    except BaseException as error:
        failures.append('monitor error: ' + repr(error))
        stop_owned()

thread = threading.Thread(target=guard, daemon=True)
thread.start()
try:
    with tempfile.TemporaryDirectory(prefix='owned-indexed-fields-', dir=output) as temporary:
        profile, port = Path(temporary), free_port()
        prefs = {**harness_prefs(port), 'browser.startup.page': 0, 'zen.welcome-screen.seen': True,
                 'browser.startup.homepage_override.mstone': 'ignore', 'startup.homepage_welcome_url': '',
                 'startup.homepage_welcome_url.additional': '', 'browser.warnOnQuit': False,
                 'zen.urlbar.open-on-startup': False, 'browser.urlbar.closeOnWindowBlur': False,
                 'browser.search.suggest.enabled': False, 'browser.urlbar.suggest.searches': False}
        (profile / 'user.js').write_text(render_prefs(prefs))
        inst = Instance(app, profile, port, env={'MOZ_HEADLESS': '1', 'MOZ_HEADLESS_WIDTH': '1280',
                                               'MOZ_HEADLESS_HEIGHT': '800', 'MOZ_PURGE_CACHES': '1'}, log=output / 'browser.log')
        process = None
        try:
            inst.start(connect_timeout=30)
            process = inst.proc
            inst.client.sock.settimeout(100)
            inst.client.chrome(script_timeout_ms=90000)
            result['validation'] = inst.client.run(fixture.read_text(), [{'executable': str(app / 'Contents/MacOS/zen'),
                'profile': str(profile), 'pid': inst.pid, 'archive': str(app / 'Contents/Resources/browser/omni.ja'),
                'moduleSHA256': sha(a.module_source), 'functionSource': function_source, 'fixtureNow': a.fixture_now}])
        finally:
            process = process or inst.proc
            inst.stop(timeout=10)
            result['browserExitCode'] = process.returncode if process else None
        result['profile'] = temporary
    result['profileRemoved'] = not Path(temporary).exists()
except BaseException as error:
    result['error'] = str(error)
    if 'temporary' in locals():
        result['profileRemoved'] = not Path(temporary).exists()
finally:
    stopped.set()
    thread.join(timeout=2)
    result['finalChargedBytes'], result['finalFreeBytes'] = allocation(), shutil.disk_usage(root).free
    if result['finalChargedBytes'] > 192 * 1024**2 or result['finalFreeBytes'] < 2 * 1024**3:
        failures.append('final resource limit')
    result['guardFailures'] = failures
    result['inputsUnchanged'] = all(sha(Path(path)) == digest for path, digest in pins.items())
    result['appUnchanged'] = inventory(app) == manifest['files']
    result['cloneUnchanged'] = inventory(clone_app) == clone['files']
    result['signatureAfter'] = subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(app)], capture_output=True).returncode == 0
    result['passed'] = bool(result.get('validation', {}).get('passed') and result.get('browserExitCode') == 0 and
        result.get('profileRemoved') and result['inputsUnchanged'] and result['appUnchanged'] and result['cloneUnchanged'] and
        result['signatureAfter'] and not failures)
    result['finishedUTC'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (output / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: result.get(key) for key in ('passed', 'browserExitCode', 'profileRemoved', 'inputsUnchanged', 'appUnchanged', 'guardFailures', 'error')}))
    if not result['passed']:
        print(json.dumps(result.get('validation')))
raise SystemExit(0 if result['passed'] else 1)
