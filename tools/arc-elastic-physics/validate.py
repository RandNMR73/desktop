#!/usr/bin/env python3
"""Compare the standalone physics models with pinned Chromium code."""

import argparse
import hashlib
import json
import platform
from pathlib import Path
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cxx', default='clang++')
    parser.add_argument('--sysroot')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    models = root.parents[1] / 'src/gfx/layers/apz/src'
    reference = json.loads((root / 'reference-sources.json').read_text())
    for name, expected in reference['sha256'].items():
        actual = hashlib.sha256((root / name).read_bytes()).hexdigest()
        if actual != expected:
            raise RuntimeError(f'Pinned reference changed: {name}')
    common = [args.cxx, '-std=c++20', '-O2', '-ffp-contract=off', '-I' + str(models)]
    if args.sysroot:
        common += ['-isysroot', args.sysroot]
    cases = [
        ('return', 'upstream-shim', ['upstream-elastic_overscroll_controller_exponential.cc']),
        ('gesture', 'controller-shim', ['upstream-elastic_overscroll_controller.cc',
                                        'upstream-elastic_overscroll_controller_exponential.cc']),
    ]
    if platform.machine().lower() in ('arm64', 'aarch64'):
        cases.append(('input', 'upstream-shim',
                      ['upstream-elastic_overscroll_controller_exponential.cc']))
    report = {'standaloneOnly': True, 'browserTestsRun': False, 'results': {},
              'inputBinaryReferenceAvailable': len(cases) == 3,
              'compiler': subprocess.check_output([args.cxx, '--version'], text=True).splitlines()[0],
              'upstreamRevision': reference['revision'],
              'modelSHA256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                              for p in sorted(models.glob('ArcElastic*Model.h'))}}
    with tempfile.TemporaryDirectory(prefix='zen-arc-physics-') as directory:
        for name, shim, sources in cases:
            binary = Path(directory) / name
            command = common + ['-I' + str(root / shim),
                                str(root / f'validate-{name}-model.cpp')]
            command += [str(root / source) for source in sources]
            subprocess.run(command + ['-o', str(binary)], check=True)
            result = json.loads(subprocess.check_output([str(binary)], text=True))
            assert result['passed'], result
            report['results'][name] = result
    if args.output:
        args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
