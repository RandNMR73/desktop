#!/usr/bin/env python3
"""Build the macOS app-icon helper and package the existing Astralforge catalog."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess


def build(icons: Path, output: Path):
    rows = list(csv.DictReader((icons / 'icons.tsv').open(), delimiter='\t'))
    slugs = [row['slug'] for row in rows]
    if not rows or len(set(slugs)) != len(slugs) or any(not re.fullmatch(r'[a-z0-9-]{1,64}', slug) for slug in slugs):
        raise ValueError('Invalid or duplicate catalog slug')
    resources = output
    resources.mkdir(parents=True, exist_ok=True)
    catalog = []
    assets = []
    for row in rows:
        slug = row['slug']
        for suffix in ['.icns', '-preview.png']:
            src = icons / f'arc-{slug}{suffix}'
            if src.is_symlink() or not src.is_file():
                raise ValueError(f'Missing original icon asset: {src}')
            magic = b'icns' if suffix == '.icns' else b'\x89PNG\r\n\x1a\n'
            if not src.read_bytes().startswith(magic):
                raise ValueError(f'Invalid icon asset: {src}')
            dest = resources / src.name
            if src.resolve() != dest.resolve():
                shutil.copyfile(src, dest)
            assets.append(dest)
        catalog.append({'slug': slug, 'label': row['label']})
    (resources / 'catalog.json').write_text(json.dumps(catalog, indent=2) + '\n')
    source = Path(__file__).with_name('ZenAppIcons.m')
    library = output / 'libzen-app-icons.dylib'
    subprocess.run(['xcrun', 'clang', '-dynamiclib', '-fobjc-arc', '-fvisibility=hidden',
                    '-Wall', '-Wextra', '-Werror', '-O2', '-mmacosx-version-min=12.0',
                    '-framework', 'AppKit', str(source), '-o', str(library)], check=True)
    subprocess.run(['codesign', '--force', '--sign', '-', str(library)], check=True)
    manifest = {'version': 1, 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                'files': {str(p.relative_to(output)): hashlib.sha256(p.read_bytes()).hexdigest()
                          for p in [library, resources / 'catalog.json', *assets]}}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'icons': len(catalog), 'output': str(output)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--icons', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    build(args.icons, args.output)
