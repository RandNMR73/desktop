#!/usr/bin/env python3
"""Check exact PNG sample bytes and color-space tags without a browser."""
import hashlib
import json
from pathlib import Path
import struct
import zlib


def main():
    root = Path(__file__).resolve().parents[2] / (
        'src/testing/web-platform/tests/css/css-color/astral-wide-background/resources')
    expected = {
        'p3-orange.png': (255, 77, 0, 255),
        'p3-green.png': (0, 255, 0, 255),
        'srgb-blue.png': (0, 0, 246, 255),
        'p3-orange-alpha.png': (255, 77, 0, 128),
        'p3-blue-alpha.png': (0, 0, 255, 128),
        'p3-repaint.png': (255, 51, 0, 255),
    }
    results = []
    for name, rgba in expected.items():
        data = (root / name).read_bytes()
        assert data[:8] == b'\x89PNG\r\n\x1a\n', name
        chunks = {}
        position = 8
        while position < len(data):
            length = struct.unpack('>I', data[position:position + 4])[0]
            kind = data[position + 4:position + 8]
            chunk = data[position + 8:position + 8 + length]
            crc = struct.unpack('>I', data[position + 8 + length:position + 12 + length])[0]
            assert zlib.crc32(kind + chunk) == crc, name
            chunks[kind] = chunks.get(kind, b'') + chunk
            position += 12 + length
        assert struct.unpack('>IIBBBBB', chunks[b'IHDR']) == (1, 1, 8, 6, 0, 0, 0), name
        assert zlib.decompress(chunks[b'IDAT']) == bytes((0, *rgba)), name
        if name.startswith('srgb'):
            assert b'sRGB' in chunks and b'iCCP' not in chunks, name
            profile = 'sRGB'
        else:
            compressed = chunks[b'iCCP']
            separator = compressed.index(b'\0')
            assert compressed[separator + 1] == 0, name
            icc = zlib.decompress(compressed[separator + 2:])
            assert icc[16:20] == b'RGB ', name
            profile = None
            count = struct.unpack('>I', icc[128:132])[0]
            for i in range(count):
                tag, offset, size = struct.unpack('>4sII', icc[132 + 12 * i:144 + 12 * i])
                if tag == b'desc':
                    body = icc[offset:offset + size]
                    assert body[:4] == b'mluc', name
                    length, start = struct.unpack('>II', body[20:28])
                    profile = body[start:start + length].decode('utf-16-be')
            assert profile == 'Display P3', name
            assert chunks[b'cICP'] == bytes((12, 13, 0, 1)), name
        results.append(dict(file=name, rgba=rgba, profile=profile,
                            sha256=hashlib.sha256(data).hexdigest()))
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
