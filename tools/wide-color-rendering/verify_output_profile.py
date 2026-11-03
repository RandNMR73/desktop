#!/usr/bin/env python3
"""Compare vendored qcms Display P3 output with macOS CoreGraphics."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--rustc', default='rustc')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('The independent reference requires macOS CoreGraphics')
    source = Path(__file__).resolve().parent
    qcms = args.engine.resolve() / 'gfx/qcms/src/lib.rs'
    if not qcms.is_file() or args.output.exists():
        parser.error('Supply a Gecko checkout and a fresh output directory')
    output = args.output.resolve()
    output.mkdir(parents=True)
    library = output / 'libqcms.rlib'
    subprocess.run([args.rustc, '--edition=2018', '--crate-name=qcms',
                    '--crate-type=rlib', '-O', '--cfg', 'feature="iccv4-enabled"',
                    '--cfg', 'feature="cmyk"', '--cfg', 'feature="neon"',
                    str(qcms), '-o', str(library)], check=True)
    subprocess.run([args.rustc, '--edition=2018', '-O',
                    str(source / 'qcms_reference.rs'), '--extern',
                    f'qcms={library}', '-o', str(output / 'qcms-reference')], check=True)
    subprocess.run(['xcrun', 'clang++', '-std=c++17', '-O2',
                    str(source / 'coregraphics_reference.mm'), '-framework',
                    'CoreGraphics', '-o', str(output / 'native-reference')], check=True)
    with (output / 'qcms.csv').open('wb') as handle:
        subprocess.run([str(output / 'qcms-reference')], stdout=handle, check=True)
    with (output / 'qcms.csv').open('rb') as handle:
        result = subprocess.run([str(output / 'native-reference')], stdin=handle,
                                capture_output=True, text=True)
    report = json.loads(result.stdout)
    report.update(passed=result.returncode == 0, macOS=platform.mac_ver()[0],
                  rustc=subprocess.check_output([args.rustc, '--version'], text=True).strip(),
                  scope='Conversion reference only; not browser rendering parity',
                  sourceSHA256={str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest()
                                for p in [source / 'qcms_reference.rs', source / 'coregraphics_reference.mm']},
                  qcmsTableSHA256=hashlib.sha256((output / 'qcms.csv').read_bytes()).hexdigest())
    (output / 'validation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    if result.returncode:
        raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
