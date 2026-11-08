from pathlib import Path
from PIL import Image
import argparse
import hashlib
import json


def bounds(image, red):
    points = []
    for y in range(image.height):
        for x in range(image.width):
            r, g, b = image.getpixel((x, y))
            matches = (r > 150 and g < 100 and b < 100) if red else max(r, g, b) < 40
            if matches:
                points.append((x, y))
    assert points, 'Missing glyph or shadow in capture'
    return [min(x for x, y in points), min(y for x, y in points),
            max(x for x, y in points) + 1, max(y for x, y in points) + 1]


def measure(directory, arc, origin):
    output = []
    ordinary = {}
    for page in ('ordinary', 'highlight'):
        metadata = directory / (f'probe-vertical-shadow-{page}.json' if arc else f'{page}.json')
        capture = directory / (page + ('.jpeg' if arc else '.png'))
        data = json.loads(metadata.read_text())
        image = Image.open(capture).convert('RGB')
        scale = data['viewport']['dpr']
        assert len(data['samples']) == len(data['tiles']) == 8
        for sample, tile in zip(data['samples'], data['tiles']):
            rect = tile['rect']
            box = (origin[0] + scale * rect['x'], origin[1] + scale * rect['y'],
                   min(image.width, origin[0] + scale * rect['right']),
                   min(image.height, origin[1] + scale * rect['bottom']))
            crop = image.crop(box)
            glyph, shadow = bounds(crop, False), bounds(crop, True)
            if page == 'ordinary':
                ordinary[sample['name']] = {'glyph': glyph, 'shadow': shadow, 'rect': sample['rect']}
            baseline = ordinary[sample['name']]
            assert sample['rect'] == baseline['rect']
            output.append({'page': page, 'case': sample['name'], 'glyphBounds': glyph,
                           'shadowBounds': shadow,
                           'offset': [(shadow[i] - baseline['glyph'][i]) / scale for i in range(2)],
                           'sameShadowBoundsAsOrdinary': shadow == baseline['shadow'],
                           'captureSHA256': hashlib.sha256(capture.read_bytes()).hexdigest()})
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--arc', required=True, type=Path)
    parser.add_argument('--zen', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--arc-origin', nargs=2, type=int, required=True)
    args = parser.parse_args()
    arc = measure(args.arc, True, args.arc_origin)
    zen = measure(args.zen, False, (0, 0))
    comparisons = []
    for a, z in zip(arc, zen):
        assert (a['case'], a['page']) == (z['case'], z['page'])
        error = [abs(a['offset'][i] - z['offset'][i]) for i in range(2)]
        comparisons.append({'page': a['page'], 'case': a['case'], 'arcOffset': a['offset'],
                            'zenOffset': z['offset'], 'absoluteError': error,
                            'offsetMatchesWithinOnePixel': max(error) <= 1})
    report = {'scope': 'Single-glyph shadow displacement only',
              'arc': arc, 'zen': zen, 'comparisons': comparisons,
              'limitations': ['Arc DPR 2 native-window capture versus Zen DPR 1 headless content capture',
                              'Color and glyph rasterization parity are not tested',
                              'Offsets use ordinary glyph bounds because Arc clips part of some highlighted sideways glyphs',
                              'Mixed-run Arc actual/reference validation remains pending']}
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'cases': len(comparisons), 'offsetMatches': sum(c['offsetMatchesWithinOnePixel'] for c in comparisons)}))


if __name__ == '__main__':
    main()
