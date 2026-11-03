"""Build and exercise the standalone native calculator; no browser changes."""
import ctypes
import json
import math
from pathlib import Path
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
PRIMARY = ["tintedLight", "midTone", "shaded", "shadedDark"]
SEMANTIC = ["foregroundPrimary", "foregroundSecondary", "foregroundTertiary", "maxContrastColor",
            "minContrastColor", "backgroundExtra", "background", "focus", "hover", "cutoutColor", "title", "subtitle"]


def main():
    with tempfile.TemporaryDirectory() as directory:
        library = Path(directory) / "palette.dylib"
        subprocess.run(["xcrun", "clang", "-dynamiclib", "-fobjc-arc", "-Wall", "-Wextra", "-Werror",
                        "-framework", "AppKit", "-framework", "ImageIO", str(Path(__file__).with_name("ZenSpacePalette.m")), "-o", str(library)], check=True)
        lib = ctypes.CDLL(str(library))
        assert lib.zen_space_palette_version() == 1
        calculate = lib.zen_space_palette
        calculate.argtypes = [ctypes.c_int, ctypes.POINTER(ctypes.c_double), ctypes.c_uint32,
                              ctypes.POINTER(ctypes.c_double), ctypes.c_uint32]
        calculate.restype = ctypes.c_int
        def palette(rgb, space=1):
            out = (ctypes.c_double * 112)()
            assert calculate(space, (ctypes.c_double * 3)(*rgb), 3, out, 112) == 0
            return list(out)
        cases = json.loads((ROOT / "scripts/tests/fixtures/space-palettes.json").read_text())["cases"]
        errors = []
        for case in cases:
            actual = palette(case["input"]["rgb"])
            expected = [v for mode, keys in [("primary", PRIMARY), ("light", SEMANTIC), ("dark", SEMANTIC)]
                        for key in keys for v in case["palette"][mode][key]]
            error = max(abs(a - b) for a, b in zip(actual, expected))
            assert error < .000002, error
            errors.append(error)
        # New colors, neutral endpoints and both RGB spaces; no saved IDs.
        samples = 0
        for space in [0, 1]:
            for r in range(6):
                for g in range(6):
                    for b in range(6):
                        result = palette([r / 5, g / 5, b / 5], space)
                        assert all(math.isfinite(v) and abs(v) <= 4 for v in result)
                        assert all(0 <= v <= 1 for v in result[3::4])
                        assert abs(result[95] - .8075) < 1e-7
                        assert abs(result[99] - .48) < 1e-7
                        assert result == palette([r / 5, g / 5, b / 5], space)
                        samples += 1
        assert palette([1, 0, 0], 0) != palette([1, 0, 0], 1)
        assert any(v < 0 or v > 1 for v in palette([0, 1, 0]))
        for rgb in [[math.nan, 0, 0], [math.inf, 0, 0], [-.01, 0, 0], [1.01, 0, 0]]:
            out = (ctypes.c_double * 112)(*([9] * 112))
            assert calculate(1, (ctypes.c_double * 3)(*rgb), 3, out, 112) == 1
            assert list(out) == [9] * 112
        rgb, out = (ctypes.c_double * 3)(0, 0, 0), (ctypes.c_double * 112)()
        for space, data, count, target, length in [(2, rgb, 3, out, 112), (1, None, 3, out, 112),
            (1, rgb, 2, out, 112), (1, rgb, 3, None, 112), (1, rgb, 3, out, 111)]:
            assert calculate(space, data, count, target, length) == 1
        start = time.perf_counter()
        for _ in range(1000): palette([.1, .2, .3])
        print(json.dumps({"ok": True, "independentPalettes": len(cases), "comparedChannels": len(cases) * 112,
                          "maxChannelErrors": errors, "syntheticColors": samples,
                          "uncachedAverageMicroseconds": (time.perf_counter() - start) * 1000,
                          "scope": "Standalone calculator; does not certify rendered pixels or browser speed"}, indent=2))


if __name__ == "__main__":
    main()
