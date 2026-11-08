from pathlib import Path
import argparse
import ctypes
import json
import math

parser = argparse.ArgumentParser(description='Compare native Arc/Zen measurements with the macOS font reference')
parser.add_argument('--arc', type=Path, required=True)
parser.add_argument('--zen', type=Path, required=True)
parser.add_argument('--ahem', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
cf = ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
ct = ctypes.CDLL('/System/Library/Frameworks/CoreText.framework/CoreText')
pointer, double = ctypes.c_void_p, ctypes.c_double
functions = [
    (cf, 'CFURLCreateFromFileSystemRepresentation', [pointer, ctypes.c_char_p, ctypes.c_long, ctypes.c_bool], pointer),
    (cf, 'CFStringCreateWithCString', [pointer, ctypes.c_char_p, ctypes.c_uint32], pointer),
    (ct, 'CTFontManagerCreateFontDescriptorsFromURL', [pointer], pointer),
    (cf, 'CFArrayGetValueAtIndex', [pointer, ctypes.c_long], pointer),
    (ct, 'CTFontCreateWithFontDescriptor', [pointer, double, pointer], pointer),
    (ct, 'CTFontCreateWithName', [pointer, double, pointer], pointer),
    (ct, 'CTFontCreateUIFontForLanguage', [ctypes.c_uint, double, pointer], pointer),
    (cf, 'CFRelease', [pointer], None),
]
for library, name, arguments, result in functions:
    function = getattr(library, name)
    function.argtypes, function.restype = arguments, result
for name in ['CTFontGetAscent', 'CTFontGetDescent', 'CTFontGetLeading']:
    function = getattr(ct, name)
    function.argtypes, function.restype = [pointer], double

font_path = str(args.ahem.resolve()).encode()
url = cf.CFURLCreateFromFileSystemRepresentation(None, font_path, len(font_path), False)
descriptors = ct.CTFontManagerCreateFontDescriptorsFromURL(url)
descriptor = cf.CFArrayGetValueAtIndex(descriptors, 0)
arc = json.loads(args.arc.read_text())
zen = json.loads(args.zen.read_text())
assert arc['viewport']['dpr'] == zen['viewport']['dpr'] == 2
assert len(arc['rows']) == len(zen['rows']) == 576

def f32(value):
    return ctypes.c_float(value).value

records = []
for observed, baseline in zip(arc['rows'], zen['rows']):
    key = {k: observed[k] for k in ['family', 'size', 'zoom', 'lineHeight']}
    assert key == {k: baseline[k] for k in key}
    family = key['family']
    size = f32(math.floor(f32(f32(key['size'] * key['zoom'] * 2) * 100)) / 100)
    if family.startswith('Ahem'):
        font = ct.CTFontCreateWithFontDescriptor(descriptor, size, None)
    elif family == 'system-ui':
        font = ct.CTFontCreateUIFontForLanguage(2, size, None)
    else:
        name = cf.CFStringCreateWithCString(None, family.encode(), 0x08000100)
        font = ct.CTFontCreateWithName(name, size, None)
        cf.CFRelease(name)
    raw = {key: f32(getattr(ct, function)(font)) for key, function in [
        ('ascent', 'CTFontGetAscent'), ('descent', 'CTFontGetDescent'), ('leading', 'CTFontGetLeading')]}
    cf.CFRelease(font)
    if family == 'AhemOverride':
        raw = {name: f32(size * f32(factor)) for name, factor in [('ascent', .705), ('descent', .2025), ('leading', .055)]}
    expected = {name: math.floor(f32(value + .5)) for name, value in raw.items()}
    if family in ['Times', 'Helvetica', 'Courier']:
        expected['ascent'] += math.floor(f32(f32((expected['ascent'] + expected['descent']) * .15) + .5))
    expected = {name: value / 2 for name, value in expected.items()}
    expected['height'] = expected['ascent'] + expected['descent']
    if key['lineHeight'] == 'normal':
        expected['line'] = expected['height'] + expected['leading']
    else:
        font_size = f32(key['size'] * key['zoom'] * 2)
        fixed_size = math.floor(f32(font_size * 64) + .5) / 64
        percent = f32(float(key['lineHeight']) * 100)
        expected['line'] = math.floor(f32(f32(fixed_size * percent) / 100) * 64) / 128
    half_leading = math.trunc((expected['line'] - expected['height']) * 128 / 2)
    expected['top'] = math.floor(half_leading / 64) / 2
    expected['baseline'] = expected['ascent'] + expected['top']
    fields = ['height', 'ascent', 'descent', 'line', 'baseline', 'top']
    records.append({'case': key, 'raw': raw, 'expected': expected,
                    'arc': {field: observed[field] for field in fields},
                    'zenBaseline': {field: baseline[field] for field in fields},
                    'metricsExact': all(abs(observed[field] - expected[field]) < 1e-6 for field in ['height', 'ascent', 'descent']),
                    'geometryExact': all(abs(observed[field] - expected[field]) < 1e-6 for field in fields),
                    'baselineGeometryExact': all(abs(observed[field] - baseline[field]) < 1e-6 for field in fields)})

result = {'cases': len(records), 'metricsExact': sum(row['metricsExact'] for row in records),
          'geometryExact': sum(row['geometryExact'] for row in records),
          'zenBaselineGeometryExact': sum(row['baselineGeometryExact'] for row in records),
          'scope': 'Core Text reference model versus native Arc; proposed engine fix is not linked or native-tested.',
          'rows': records}
args.output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({key: value for key, value in result.items() if key != 'rows'}))
print(json.dumps([row for row in records if not row['geometryExact']][:8], indent=2))
cf.CFRelease(descriptors)
cf.CFRelease(url)
