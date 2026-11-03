"""Check native favicon quantization against independently run Swift references."""
import base64
import ctypes
import hashlib
import json
from pathlib import Path
import random
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent


def samples(seed):
    rng = random.Random(seed)
    count = [1, 16, 256, 1024, 4096][seed % 5]
    swatches = [[rng.randrange(256) for _ in range(3)]
                for _ in range([1, 2, 3, 5, 8, 16, 64, 256][seed % 8])]
    pixels = bytearray()
    for _ in range(count):
        rgb = rng.choice(swatches)
        alpha = rng.choice([0, 124, 125, 255])
        pixels.extend([alpha, *rgb[::-1]])
    pixels[:4] = bytes([255, 32, 64, 96])
    return bytes(pixels)


def main():
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        wrapper = directory / "quantizer.m"
        wrapper.write_text('''#import <AppKit/AppKit.h>
#include "ZenSiteSearchQuantizer.h"
int quantize(const uint8_t *bytes, size_t count, uint8_t colors[5][3]) {
  return zen_site_search_quantize(bytes, count, colors);
}
''')
        library = directory / "palette.dylib"
        subprocess.run(["xcrun", "clang", "-dynamiclib", "-fobjc-arc", "-Wall", "-Wextra", "-Werror",
                        "-framework", "AppKit", "-framework", "ImageIO", "-I", str(ROOT), str(wrapper),
                        str(ROOT / "ZenSpacePalette.m"), "-o", str(library)], check=True)
        lib = ctypes.CDLL(str(library))
        quantize = lib.quantize
        quantize.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p]
        quantize.restype = ctypes.c_int
        reference = json.loads((ROOT / "site-search-quantizer-reference.json").read_text())
        for case in reference["cases"]:
            data = samples(case["seed"])
            assert hashlib.sha256(data).hexdigest() == case["sha256"]
            out = (ctypes.c_uint8 * 15)()
            count = quantize(data, len(data) // 4, out)
            actual = [list(out[i * 3:i * 3 + 3]) for i in range(count)]
            assert actual == case["palette"], (case["seed"], actual, case["palette"])
        for data in [b"", bytes([0, 32, 64, 96]) * 100, bytes([255] * 400)]:
            out = (ctypes.c_uint8 * 15)(*([99] * 15))
            assert quantize(data, len(data) // 4, out) == 0
            assert list(out) == [99] * 15

        assert lib.zen_site_search_palette_version() == 1
        calculate = lib.zen_site_search_palette
        calculate.argtypes = [ctypes.c_void_p, ctypes.c_uint32,
                              ctypes.POINTER(ctypes.c_double), ctypes.c_uint32]
        calculate.restype = ctypes.c_int
        images = json.loads((ROOT / "site-search-palette-reference.json").read_text())["cases"]
        errors = []
        for case in images:
            data = base64.b64decode(case["png"])
            assert hashlib.sha256(data).hexdigest() == case["sha256"]
            out = (ctypes.c_double * 112)()
            assert calculate(data, len(data), out, 112) == 0
            errors.append(max(abs(a - b) for a, b in zip(out[92:96], case["darkFocus"])))
            assert errors[-1] < 1e-7, (case["name"], errors[-1])
            assert all(0 <= a <= 1 for a in out[3::4])
        for data, size, length in [(None, 1, 112), (b"", 0, 112), (b"invalid", 7, 112),
                                   (b"x", 4 * 1024 * 1024 + 1, 112), (b"x", 1, 111)]:
            out = (ctypes.c_double * 112)(*([9] * 112))
            assert calculate(data, size, out, length) != 0
            assert list(out) == [9] * 112
        assert calculate(b"x", 1, None, 112) != 0
        print(json.dumps({"quantizerCases": len(reference["cases"]), "nativeImageCases": len(images),
                          "maxFocusError": max(errors), "passed": True,
                          "scope": "Independent Swift quantization and native palette arithmetic; browser pixels checked separately"}, indent=2))


if __name__ == "__main__":
    main()
