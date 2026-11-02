#!/usr/bin/env python3
"""Compare the offscreen Metal renderer with independent Arc theme equations."""
import argparse
import itertools
import json
from pathlib import Path
import subprocess
import sys
import tempfile


def run(binary, metallib, config):
    sys.path.insert(0, str(config / "scripts"))
    import arc_theme
    cases = []
    palettes = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]],
                [[.2, .5, .8], [.8, .2, .6], [.4, .8, .7]],
                [[0, 0, 0], [1, 1, 1], [.5, .5, .5]]]
    for count, appearance, half, colors, size in itertools.product(
            [1, 2, 3], ["dark", "light"], [False, True], palettes, [(31, 17), (17, 31)]):
        index = len(cases)
        cases.append({"request": {"version": 1, "colors": colors[:count],
            "intensity": [0, .5, 1][index % 3], "noise": [0, .25, 1][(index // 3) % 3],
            "texture": ["grain", "sand", "denim", "tweed"][index % 4], "appearance": appearance},
            "width": size[0], "height": size[1], "half": half})
    invalid = []
    for key, value in [("colors", []), ("colors", [[True, 0, 0]]), ("colors", [[1.1, 0, 0]]),
                       ("colors", [[0, 0]]), ("colors", [[0, 0, 0]] * 4), ("noise", -1),
                       ("intensity", 2), ("appearance", "unknown"), ("texture", "unknown"), ("noise", True)]:
        request = dict(cases[0]["request"])
        request[key] = value
        invalid.append({"request": request, "width": 31, "height": 17})
    with tempfile.TemporaryDirectory(prefix="zen-dynamic-shader-") as directory:
        source = Path(directory) / "cases.json"
        source.write_text(json.dumps(cases + invalid))
        actual = json.loads(subprocess.check_output([str(binary), str(metallib), str(source)]))
    assert len(actual) == len(cases) + len(invalid)
    errors, samples = {False: 0, True: 0}, 0
    for case, result in zip(cases, actual):
        assert result["valid"]
        request, colors = case["request"], result["srgb"]
        theme = {"base": colors[:2], "overlay": [[0, 0, 0, 0], colors[2]] if len(colors) == 3 else [],
                 "intensity": request["intensity"], "noise": request["noise"], "texture": request["texture"]}
        layer = arc_theme.layer(theme, request["appearance"])
        assert len(result["samples"]) == 9
        for sample in result["samples"]:
            u, v = (sample["x"] + .5) / case["width"], (sample["y"] + .5) / case["height"]
            axis = arc_theme.axis_p(case["width"] / case["height"])
            *rgb, alpha = arc_theme.pixel(theme, axis * u + (1 - axis) * v, v, layer)
            base = [c * alpha for c in rgb] + [alpha]
            grain = layer["grain"]
            over = [x / 255 * grain for x in [128, 64, 192]] + [grain]
            expected = [o * (1 - alpha + b) + (1 - grain) * b for o, b in zip(over, base)]
            error = max(abs(a - b) for a, b in zip(sample["rgba"], expected))
            errors[case["half"]] = max(errors[case["half"]], error)
            samples += 1
    assert all(not result["valid"] for result in actual[len(cases):])
    assert errors[False] < 2e-5 and errors[True] < .001, errors
    return {"cases": len(cases), "invalidRejected": len(invalid), "pixelSamples": samples,
            "maxRGBA32FloatError": errors[False], "maxRGBA16FloatError": errors[True],
            "reference": "Independent Python Arc equations with AppKit-converted extended sRGB inputs",
            "nativeUIOrPixelParity": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--metallib", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(run(args.binary.resolve(), args.metallib.resolve(), args.config.resolve()), indent=2))
