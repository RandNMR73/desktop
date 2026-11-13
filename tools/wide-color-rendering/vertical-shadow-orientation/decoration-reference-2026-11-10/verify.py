"""Recompute the recorded native Arc pixel comparisons without launching a browser.

Requires Pillow. The single-font control is the exact gate; the other captures
retain their measured differences and are diagnostics, not passing references.
"""
from pathlib import Path
import hashlib
import json

from PIL import Image, ImageChops


def main():
    root = Path(__file__).resolve().parent
    report = json.loads((root / "report.json").read_text())
    assert report["tolerance"] == [0, 0]
    frame_box = tuple(report["contentBounds"])
    results = []
    for case in report["cases"]:
        images = {}
        for name, expected in case["files"].items():
            path = root / name
            assert path.parent == root and path.suffix == ".png", name
            assert hashlib.sha256(path.read_bytes()).hexdigest() == expected, name
            with Image.open(path) as image:
                assert image.width >= frame_box[2] and image.height >= frame_box[3], name
                images["reference" if "reference" in name else "actual"] = image.convert("RGB").crop(frame_box)
        assert set(images) == {"actual", "reference"}
        difference = ImageChops.difference(images["actual"], images["reference"])
        assert len(case["tiles"]) == 8
        total = 0
        for index, recorded in enumerate(case["tiles"]):
            # Captured at DPR 2: 8px body margin, four 200x240 CSS-pixel tiles.
            x, y = 16 + (index % 4) * 400, 16 + (index // 4) * 480
            box = (x, y, x + 400, y + 480)
            for image in images.values():
                assert sum(pixel != (255, 255, 255) for pixel in image.crop(box).getdata()) > 100
            tile = difference.crop(box)
            count = sum(pixel != (0, 0, 0) for pixel in tile.getdata())
            maximum = max(high for low, high in tile.getextrema())
            bounds = tile.getbbox()
            assert count == recorded["differentPixels"], (case["name"], index, count)
            assert maximum == recorded["maxChannelDifference"], (case["name"], index, maximum)
            assert (list(bounds) if bounds else None) == recorded["bounds"], (case["name"], index, bounds)
            total += count
        assert total == case["differentPixels"], case["name"]
        if case["name"] == "single-font-control":
            assert total == 0 and difference.getbbox() is None
        results.append({"name": case["name"], "tiles": 8, "differentPixels": total})
    assert {case["name"] for case in results} == {"arial", "ahem", "single-font-control"}
    fixture = root.parents[3] / "src/testing/web-platform/tests/css/css-text-decor/astral-decoration-shadow-order"
    for name in ("ShadowOrderControl.ttf", "control-decoration-ref.html"):
        assert hashlib.sha256((fixture / name).read_bytes()).hexdigest() == report["fixtureFiles"][name], name
    # Only the WPT match link differs from the captured actual page.
    actual = (fixture / "control-decoration.html").read_bytes()
    captured_actual = actual.replace(b'href="control-decoration-ref.html"', b'href="mixed-shadow-decoration-ref.html"')
    assert hashlib.sha256(captured_actual).hexdigest() == report["fixtureFiles"]["control-decoration.html"]
    print(json.dumps({"verified": True, "cases": results, "exactControlTiles": 8,
                      "scope": "Native Arc reference validity; not candidate validation or whole-browser parity."}))


if __name__ == "__main__":
    main()
