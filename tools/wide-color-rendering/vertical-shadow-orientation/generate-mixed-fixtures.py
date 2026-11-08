from pathlib import Path
import json

root = Path(__file__).parent
cases = [
    ('horizontal', 'horizontal-tb', 'mixed', 'F永F'),
    ('vertical-rl-mixed', 'vertical-rl', 'mixed', 'F永F'),
    ('vertical-lr-mixed', 'vertical-lr', 'mixed', 'F永F'),
    ('sideways-lr', 'sideways-lr', 'mixed', 'F永F'),
    ('vertical-rl-upright', 'vertical-rl', 'upright', 'F永F'),
    ('vertical-lr-upright', 'vertical-lr', 'upright', 'F永F'),
    ('sideways-rl', 'sideways-rl', 'mixed', 'F永F'),
    ('vertical-rl-cjk-mixed', 'vertical-rl', 'mixed', '永F永'),
]
css = '''
html { background: white; color: black; }
body { margin: 8px; }
.grid { display: grid; grid-template-columns: repeat(4, 180px); }
.tile { height: 220px; position: relative; }
.sample { position: absolute; left: 60px; top: 80px; font: 24px/1 Arial;
          width: max-content; height: max-content; white-space: pre; }
.text { text-shadow: 40px 25px 0 red; }
.shadow { color: transparent; }
.shadow.upright { margin-left: 40px; margin-top: 25px; }
.shadow.sideways { margin-left: -25px; margin-top: 40px; }
.left .shadow.sideways { margin-left: 25px; margin-top: -40px; }
.shadow.upright .upright, .shadow.sideways .sideways { color: red; }
'''
for highlight in (False, True):
    stem = 'mixed-highlight' if highlight else 'mixed-ordinary'
    for reference in (False, True):
        title = 'Arc shadow orientation for mixed vertical text'
        head = f'<!doctype html>\n<meta charset="utf-8">\n<title>{title}</title>\n'
        head += '<link rel="help" href="https://drafts.csswg.org/css-text-decor/#text-shadow-property">\n'
        if not reference:
            head += f'<link rel="match" href="{stem}-ref.html">\n'
        styles = css
        if reference:
            styles += '.text { text-shadow: none; }\n'
        if highlight:
            styles += '.text { color: transparent; text-shadow: none; }\n'
            if not reference:
                styles += '.text::highlight(probe) { color: transparent; text-shadow: 40px 25px 0 red; }\n'
        content = head + '<style>\n' + styles + '</style>\n<div class="grid">\n'
        for name, mode, orientation, text in cases:
            content += f'<div class="tile {"left" if mode == "sideways-lr" else "right"}" data-case="{name}" style="writing-mode:{mode};text-orientation:{orientation}">\n'
            if reference:
                spans = ''
                for char in text:
                    sideways = mode.startswith('sideways') or (mode.startswith('vertical') and orientation == 'mixed' and char == 'F')
                    spans += f'<span class="{"sideways" if sideways else "upright"}">{char}</span>'
                for group in ('upright', 'sideways'):
                    content += f'<span class="sample shadow {group}">{spans}</span>\n'
            content += f'<span class="sample text">{text}</span>\n</div>\n'
        content += '</div>\n'
        if highlight and not reference:
            content += '''<script>
const ranges = [...document.querySelectorAll('.text')].map(element => {
  const range = new Range();
  range.selectNodeContents(element);
  return range;
});
CSS.highlights.set('probe', new Highlight(...ranges));
</script>
'''
        (root / 'fixtures' / (stem + ('-ref' if reference else '') + '.html')).write_text(content)
(root/'mixed-cases.json').write_text(json.dumps(cases,indent=2)+'\n')
