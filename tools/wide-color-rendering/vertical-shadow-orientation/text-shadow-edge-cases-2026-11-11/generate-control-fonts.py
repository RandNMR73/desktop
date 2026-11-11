from pathlib import Path
import argparse

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, required=True)
OUT = parser.parse_args().output
OUT.mkdir(parents=True, exist_ok=True)


def glyph(rectangles):
    pen = TTGlyphPen(None)
    for x0, y0, x1, y1 in rectangles:
        pen.moveTo((x0, y0))
        for point in ((x1, y0), (x1, y1), (x0, y1)):
            pen.lineTo(point)
        pen.closePath()
    return pen.glyph()


def font(name, characters):
    shapes = {
        '.notdef': [],
        'F': [(0, 0, 250, 750), (250, 500, 750, 750), (250, 250, 500, 500)],
        'cjk': [(250, 0, 500, 750), (0, 250, 250, 500), (500, 250, 750, 500)],
        'hyphen': [(0, 250, 500, 375)],
    }
    names = ['.notdef', *characters.values()]
    builder = FontBuilder(1000, isTTF=True)
    builder.setupGlyphOrder(names)
    builder.setupCharacterMap(characters)
    builder.setupGlyf({n: glyph(shapes[n]) for n in names})
    builder.setupHorizontalMetrics({n: (500 if n == 'hyphen' else 1000, 0) for n in names})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable({'familyName': name, 'styleName': 'Regular',
                           'uniqueFontIdentifier': name + '1', 'fullName': name, 'psName': name})
    builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    builder.setupPost()
    builder.setupMaxp()
    builder.font.recalcTimestamp = False
    builder.font['head'].created = builder.font['head'].modified = 2082844800
    builder.save(OUT / (name + '.ttf'))


font('ShadowLatinOnly', {70: 'F'})
font('ShadowCJKOnly', {0x6c38: 'cjk'})
font('ShadowHyphenControl', {70: 'F', 45: 'hyphen'})
