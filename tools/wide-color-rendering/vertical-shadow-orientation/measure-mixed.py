from pathlib import Path
from PIL import Image
import argparse
import hashlib
import json


def bounds(points):
    return [min(p[0] for p in points), min(p[1] for p in points),
            max(p[0] for p in points) + 1, max(p[1] for p in points) + 1]


def measure(capture, metadata, origin):
    data = json.loads(metadata.read_text())
    image = Image.open(capture).convert('RGB')
    scale = data['viewport']['dpr']
    results = []
    assert len(data['samples']) == len(data['tiles']) == 8
    for sample, tile in zip(data['samples'], data['tiles']):
        rect = sample['rect']
        left = round(origin[0] + scale * rect['x'])
        top = round(origin[1] + scale * rect['y'])
        right = round(origin[0] + scale * rect['right'])
        bottom = round(origin[1] + scale * rect['bottom'])
        glyph = [(x, y) for y in range(top, bottom) for x in range(left, right)
                 if max(image.getpixel((x, y))) < 100]
        axis = 0 if sample['mode'] == 'horizontal-tb' else 1
        positions = sorted({p[axis] for p in glyph})
        groups = []
        for position in positions:
            if not groups or position > groups[-1][-1] + 1:
                groups.append([])
            groups[-1].append(position)
        assert len(groups) == len(sample['text']) == 3, sample['name']
        chars = sample['text']
        if sample['mode'] == 'sideways-lr':
            chars = chars[::-1]
        box = tile['rect']
        red = set()
        for y in range(round(origin[1] + scale * box['y']),
                       round(origin[1] + scale * box['bottom'])):
            for x in range(round(origin[0] + scale * box['x']),
                           round(origin[0] + scale * box['right'])):
                r, g, b = image.getpixel((x, y))
                if r > 150 and g < 100 and b < 100:
                    red.add((x, y))
        accounted = set()
        for index, (char, group) in enumerate(zip(chars, groups)):
            glyph_bounds = bounds([p for p in glyph if group[0] <= p[axis] <= group[-1]])
            sideways = sample['mode'].startswith('sideways') or (
                sample['mode'].startswith('vertical') and
                sample['orientation'] == 'mixed' and char == 'F')
            expected = ((25, -40) if sample['mode'] == 'sideways-lr' else (-25, 40)) if sideways else (40, 25)
            expected_bounds = [glyph_bounds[i] + round(scale * expected[i % 2]) for i in range(4)]
            found = {p for p in red if expected_bounds[0] - 2 <= p[0] < expected_bounds[2] + 2
                     and expected_bounds[1] - 2 <= p[1] < expected_bounds[3] + 2}
            actual_bounds = bounds(found) if found else None
            error = [abs(actual_bounds[i] - expected_bounds[i]) / scale for i in range(4)] if found else None
            accounted.update(found)
            results.append({'case': sample['name'], 'glyph': index, 'character': char,
                            'expectedOffsetCSSPixels': expected,
                            'measuredOffsetCSSPixels': [(actual_bounds[i] - glyph_bounds[i]) / scale for i in range(2)] if found else None,
                            'boundsErrorCSSPixels': error,
                            'matchesWithinOneDevicePixel': bool(found) and max(error) <= 1 / scale})
        assert red and not (red - accounted), (sample['name'], 'Unaccounted shadow pixels', len(red - accounted))
    return {'scope': 'Ordinary mixed-text shadow displacement from same-image foreground glyph bounds',
            'captureSHA256': hashlib.sha256(capture.read_bytes()).hexdigest(),
            'metadataSHA256': hashlib.sha256(metadata.read_bytes()).hexdigest(),
            'originDevicePixels': origin, 'devicePixelRatio': scale, 'glyphs': results,
            'limitations': ['This measures shadow position, not full pixel or color parity',
                            'Reference-page and custom-highlight mixed-run captures remain pending',
                            'Foreground segmentation is restricted to these three-glyph fixtures']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--capture', required=True, type=Path)
    parser.add_argument('--metadata', required=True, type=Path)
    parser.add_argument('--origin', nargs=2, type=int, required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    report = measure(args.capture, args.metadata, args.origin)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'glyphs': len(report['glyphs']),
                      'matches': sum(g['matchesWithinOneDevicePixel'] for g in report['glyphs'])}))


if __name__ == '__main__':
    main()
