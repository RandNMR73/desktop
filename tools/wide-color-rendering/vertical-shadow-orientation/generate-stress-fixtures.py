"""Independent painted-glyph references for vertical shadow layering."""

from html import escape
import json
from pathlib import Path


ROOT = Path(__file__).parent
MODES = (
    ("horizontal", "horizontal-tb", "mixed"),
    ("vertical-rl-mixed", "vertical-rl", "mixed"),
    ("vertical-lr-mixed", "vertical-lr", "mixed"),
    ("sideways-lr", "sideways-lr", "mixed"),
    ("vertical-rl-upright", "vertical-rl", "upright"),
    ("vertical-lr-upright", "vertical-lr", "upright"),
    ("sideways-rl", "sideways-rl", "mixed"),
    ("vertical-rl-cjk-first", "vertical-rl", "mixed"),
)
CASES = {
    "mixed-layer-overlap": {"layers": [(3, 6, "red"), (-8, -5, "blue")]},
    "mixed-layer-separated": {"layers": [(40, 25, "red"), (-25, -30, "blue")]},
    "mixed-partial-highlight": {
        "layers": [(3, 6, "red"), (-8, -5, "blue")], "partial": True,
    },
    "mixed-shadow-decoration": {
        "layers": [(12, 8, "red"), (-8, -5, "blue")], "decoration": True,
        "paint_order": ("ts", "ds", "di", "ti"),
    },
}
CSS = """
html { background: white; color: black; }
body { margin: 8px; }
.grid { display: grid; grid-template-columns: repeat(4, 200px); }
.tile { height: 240px; position: relative; }
.sample { position: absolute; left: 80px; top: 80px; font: 24px/1 Arial;
          width: max-content; height: max-content; white-space: pre; }
.shadow, .decoration-shadow, .ink-copy { color: transparent; }
.shadow.upright .upright, .shadow.sideways .sideways { color: var(--ink); }
.ink-copy .paint { color: var(--ink); }
.decorated { text-decoration: underline; text-decoration-thickness: 2px;
             text-decoration-skip-ink: none; text-underline-offset: 3px; }
"""


def render(name, case, reference):
    doc = ['<!doctype html>', '<meta charset="utf-8">',
           '<title>Vertical text shadow layering and partial highlights</title>',
           '<link rel="help" href="https://drafts.csswg.org/css-text-decor/#text-shadow-property">']
    if not reference:
        doc.append(f'<link rel="match" href="{name}-ref.html">')
    shadow = ', '.join(f'{x}px {y}px 0 {color}' for x, y, color in case['layers'])
    styles = CSS
    if not reference:
        selector = '.text::highlight(probe)' if case.get('partial') else '.text'
        styles += f'{selector} {{ text-shadow: {shadow}; }}\n'
    doc.extend(['<style>', styles, '</style>', '<div class="grid">'])
    for label, mode, orientation in MODES:
        text = '永F永F' if label.endswith('cjk-first') else 'F永F永'
        decoration = ' decorated' if case.get('decoration') else ''
        doc.append(f'<div class="tile" data-case="{label}" '
                   f'style="writing-mode:{mode};text-orientation:{orientation}">')
        if reference:
            parts = {key: [] for key in ('ds', 'di', 'ts', 'ti', 'runs')}

            def offset(x, y, sideways):
                if not sideways:
                    return x, y
                return (y, -x) if mode == 'sideways-lr' else (-y, x)

            if case.get('decoration'):
                for x, y, color in reversed(case['layers']):
                    dx, dy = offset(x, y, mode != 'horizontal-tb')
                    parts['ds'].append('<span class="sample decoration-shadow decorated" '
                                       f'style="margin-left:{dx}px;margin-top:{dy}px;'
                                       f'text-decoration-color:{color}">{text}</span>')
                parts['di'].append('<span class="sample decoration-shadow decorated" '
                                   f'style="text-decoration-color:black">{text}</span>')

            mixed = mode.startswith('vertical') and orientation == 'mixed'
            groups = [[i] for i in range(len(text))] if mixed else [list(range(len(text)))]
            for group in groups:
                sideways = mode.startswith('sideways') or (mixed and text[group[0]] == 'F')

                def ink_copy(indices, color, dx=0, dy=0):
                    spans = ''.join(f'<span class="{"paint" if i in indices else "hidden"}">'
                                    f'{escape(char)}</span>' for i, char in enumerate(text))
                    return ('<span class="sample ink-copy" '
                            f'style="margin-left:{dx}px;margin-top:{dy}px;--ink:{color}">{spans}</span>')

                selected = [i for i in group if not case.get('partial') or i in (1, 2)]
                for x, y, color in reversed(case['layers']):
                    dx, dy = offset(x, y, sideways)
                    painted = ink_copy(selected, color, dx, dy)
                    parts['ts'].append(painted)
                    parts['runs'].append(painted)
                painted = ink_copy(group, 'black')
                parts['ti'].append(painted)
                parts['runs'].append(painted)
            order = case.get('paint_order') or (
                ('ts', 'ti') if case.get('partial') else
                ('ds', 'di', 'runs') if case.get('decoration') else ('runs',))
            for part in order:
                doc.extend(parts[part])
        else:
            doc.append(f'<span class="sample text{decoration}">{text}</span>')
        doc.append('</div>')
    doc.append('</div>')
    if case.get('partial') and not reference:
        doc.append("""<script>
const ranges = [...document.querySelectorAll('.text')].map(element => {
  const range = new Range();
  range.setStart(element.firstChild, 1);
  range.setEnd(element.firstChild, 3);
  return range;
});
CSS.highlights.set('probe', new Highlight(...ranges));
</script>""")
    return '\n'.join(doc) + '\n'


def main():
    for name, case in CASES.items():
        for reference in (False, True):
            filename = name + ('-ref' if reference else '') + '.html'
            (ROOT / 'fixtures' / filename).write_text(render(name, case, reference))
    (ROOT / 'stress-cases.json').write_text(json.dumps({
        'cases': CASES, 'modes': MODES,
        'reference': 'Positioned glyph copies with explicit layer order; no text-shadow in references',
        'validation': {
            'Arc': 'Overlap, separated layers and partial highlights match in all eight writing modes',
            'decorations': 'Diagnostic only; small Arc reference differences remain in four modes',
            'candidate': 'Native build and comparisons pending',
        },
    }, indent=2) + '\n')


if __name__ == '__main__':
    main()
