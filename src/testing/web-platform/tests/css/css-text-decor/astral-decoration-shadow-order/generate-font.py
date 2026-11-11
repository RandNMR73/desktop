from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

root = Path(__file__).parent
builder = FontBuilder(1000, isTTF=True)
names = ['.notdef', 'F', 'cjk']
builder.setupGlyphOrder(names)


def glyph(rectangles):
    pen = TTGlyphPen(None)
    for x0, y0, x1, y1 in rectangles:
        pen.moveTo((x0, y0))
        pen.lineTo((x1, y0))
        pen.lineTo((x1, y1))
        pen.lineTo((x0, y1))
        pen.closePath()
    return pen.glyph()


builder.setupCharacterMap({70: 'F', 0x6c38: 'cjk'})
builder.setupGlyf({
    '.notdef': glyph([]),
    'F': glyph([(0, 0, 250, 750), (250, 500, 750, 750), (250, 250, 500, 500)]),
    'cjk': glyph([(250, 0, 500, 750), (0, 250, 250, 500), (500, 250, 750, 500)]),
})
builder.setupHorizontalMetrics({name: (1000, 0) for name in names})
builder.setupHorizontalHeader(ascent=800, descent=-200)
builder.setupNameTable({
    'familyName': 'Shadow Order Control',
    'styleName': 'Regular',
    'uniqueFontIdentifier': 'ZenArcShadowOrderControl1',
    'fullName': 'Shadow Order Control',
    'psName': 'ShadowOrderControl',
})
builder.setupOS2(sTypoAscender=800, sTypoDescender=-200,
                usWinAscent=800, usWinDescent=200)
builder.setupPost()
builder.setupMaxp()
builder.font.recalcTimestamp = False
builder.font['head'].created = 2082844800
builder.font['head'].modified = 2082844800
builder.save(root / 'ShadowOrderControl.ttf')
