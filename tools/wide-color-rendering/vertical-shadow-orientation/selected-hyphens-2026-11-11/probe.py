from pathlib import Path
from PIL import Image, ImageChops
import argparse
import hashlib
import json
import queue
import subprocess
import sys
import threading
import time

WORK = Path(__file__).parent


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--mode', choices=('default', 'p3'), default='default')
    parser.add_argument('--scale', type=int, choices=(1, 2), default=1)
    parser.add_argument('--capture', choices=('compositor', 'software'), default='compositor')
    parser.add_argument('--case', action='append', dest='selected_cases')
    parser.add_argument('--baseline', action='store_true')
    args = parser.parse_args()
    app_manifest = json.loads(args.manifest.read_text())
    manifest = json.loads((WORK / 'manifest.json').read_text())
    if args.selected_cases:
        assert set(args.selected_cases) <= {case['name'] for case in manifest['cases']}
    for case in manifest['cases']:
        if args.selected_cases and case['name'] not in args.selected_cases:
            continue
        if 'referenceValidationDPR' in case:
            assert args.scale == case['referenceValidationDPR'], 'Reference only validated at recorded DPR: ' + case['name']
    app = Path(app_manifest['app'])
    for name, expected in app_manifest['files'].items():
        assert digest(app / name) == expected
    for entry in manifest['files']:
        assert digest(WORK / 'fixtures' / entry['fixture']) == entry['sha256']
    args.output.mkdir()
    report = {'app': str(app), 'files': app_manifest['files'], 'startedAt': time.time(),
              'scope': manifest['scope'], 'sourceRevision': app_manifest['sourceRevision'],
              'fixtureSourceRevision': manifest['sourceRevision'],
              'capture': 'Owned headless ' + args.capture + ', not physical display capture',
              'harnessSHA256': {name: digest(WORK / name) for name in ('probe.py', 'fixture.py', 'fixture-base.py', 'manifest.json')},
              'nativeReferenceEvidenceSHA256': {name: digest(WORK / name) for name in sorted({case['referenceEvidence'] for case in manifest['cases'] if 'referenceEvidence' in case})},
              'mode': args.mode, 'scale': args.scale, 'baseline': args.baseline,
              'selectedCases': args.selected_cases,
              'completed': False, 'cases': []}
    messages = queue.Queue()
    with (args.output / 'driver-stderr.log').open('w') as stderr, (args.output / 'driver-stdout.log').open('w') as stdout:
        fixture = subprocess.Popen([sys.executable, '-u', str(WORK / 'fixture.py'),
                                    '--app', str(app), '--output-dir', str(args.output),
                                    '--mode', args.mode, '--scale', str(args.scale), '--capture', args.capture, '--physics', '--headless'],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=stderr, text=True, bufsize=1)

        def consume():
            for line in fixture.stdout:
                stdout.write(line)
                stdout.flush()
                messages.put(line)
            messages.put(None)

        threading.Thread(target=consume, daemon=True).start()

        def receive():
            deadline = time.monotonic() + 120
            while True:
                line = messages.get(timeout=max(.01, deadline - time.monotonic()))
                if line is None:
                    raise RuntimeError('Fixture exited before returning a result')
                try:
                    value = json.loads(line)
                except json.JSONDecodeError:
                    continue
                assert 'error' not in value, value
                return value

        try:
            ready = receive()
            assert ready['ready'] and ready['app'] == str(app) and ready['headless']
            mapped = subprocess.check_output(['lsof', '-p', str(ready['pid']), '-Fn'], text=True)
            assert '\nn' + str(app / 'Contents/MacOS/XUL') + '\n' in mapped
            report.update(pid=ready['pid'], loadedEngineConfirmed=True)
            for case in manifest['cases']:
                if args.selected_cases and case['name'] not in args.selected_cases:
                    continue
                results = []
                stem = case['name'].split('/')[-1]
                for reference in ((False,) if case['harness'] else (False, True)):
                    output_stem = stem + ('-ref' if reference else '')
                    print('Capturing ' + output_stem, flush=True)
                    request = {'case': case['name'], 'reference': reference,
                               'output': output_stem + '.json'}
                    if not case['harness']:
                        request['screenshot'] = output_stem + '.png'
                    fixture.stdin.write(json.dumps(request) + '\n')
                    fixture.stdin.flush()
                    result = receive()
                    assert result['ready']
                    results.append(result)
                entry = {'name': case['name'], 'harness': case['harness'], 'diagnosticOnly': case.get('diagnosticOnly', False)}
                if case['harness']:
                    wpt = results[0]['wptResults']
                    assert wpt and wpt['tests'] and wpt['status']['status'] == 0, wpt
                    entry.update(tests=wpt['tests'], passed=all(test['status'] == 0 for test in wpt['tests']))
                else:
                    assert results[0]['viewport'] == results[1]['viewport']
                    assert results[0]['viewport']['dpr'] == args.scale
                    actual = Image.open(args.output / (stem + '.png')).convert('RGB')
                    reference = Image.open(args.output / (stem + '-ref.png')).convert('RGB')
                    assert actual.size == reference.size
                    entry['imageSHA256'] = {name: digest(args.output / (stem + suffix + '.png'))
                                            for name, suffix in (('actual', ''), ('reference', '-ref'))}
                    entry['nonwhitePixels'] = {name: sum(pixel != (255, 255, 255) for pixel in img.getdata())
                                               for name, img in (('actual', actual), ('reference', reference))}
                    assert min(entry['nonwhitePixels'].values()) > 1000, 'Reject blank or incomplete captures'
                    diff = ImageChops.difference(actual, reference)
                    different_pixels = sum(pixel != (0, 0, 0) for pixel in diff.getdata())
                    max_difference = max(value[1] for value in diff.getextrema())
                    threshold, pixel_limit = case['fuzzy']
                    entry.update(exact=diff.getbbox() is None, differentPixels=different_pixels,
                                 maxDifference=max_difference, fuzzy=case['fuzzy'], viewport=results[0]['viewport'],
                                 passed=max_difference <= threshold and different_pixels <= pixel_limit)
                    diff.save(args.output / (stem + '-diff.png'))
                    entry['tiles'] = []
                    for index, tile in enumerate(results[0]['tiles']):
                        rect = tile['rect']
                        scale = results[0]['viewport']['dpr']
                        box = tuple(round(value * scale) for value in (
                            rect['left'], rect['top'], rect['right'], rect['bottom']))
                        piece = diff.crop(box)
                        entry['tiles'].append({
                            'index': index, 'exact': piece.getbbox() is None,
                            'differentPixels': sum(pixel != (0, 0, 0) for pixel in piece.getdata()),
                            'maxDifference': max(value[1] for value in piece.getextrema()),
                        })
                report['cases'].append(entry)
            report['completed'] = True
        finally:
            if fixture.poll() is None:
                fixture.stdin.write('stop\n')
                fixture.stdin.flush()
            report['fixtureExitCode'] = fixture.wait(timeout=120)
            report['endedAt'] = time.time()
            (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        assert report['fixtureExitCode'] == 0
    for name, expected in app_manifest['files'].items():
        assert digest(app / name) == expected
    assert subprocess.run(['ps', '-p', str(report['pid'])], stdout=subprocess.DEVNULL).returncode != 0
    print(json.dumps({'completed': report['completed'], 'cases': len(report['cases']),
                      'passingCases': sum(case['passed'] for case in report['cases'])}), flush=True)
    if not args.baseline:
        assert all(case['passed'] for case in report['cases'] if not case['diagnosticOnly']), 'Arc-validated rendering comparison failed'


if __name__ == '__main__':
    main()
