"""Verify lossless native Arc captures and the corresponding WPT sources."""

from pathlib import Path
import hashlib
import json

from PIL import Image, ImageChops


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    root = Path(__file__).resolve().parent
    summaries = {}
    for name in ("arc-reference-report.json", "arc-reference-v2-report.json"):
        report = json.loads((root / name).read_text())
        assert report["tolerance"] == [0, 0]
        frame = tuple(report["contentBounds"])
        summaries[name] = []
        for case in report["cases"]:
            images = {}
            for filename, expected in case["files"].items():
                path = root / filename
                assert path.parent == root and digest(path) == expected
                with Image.open(path) as image:
                    assert image.format == "PNG"
                    assert image.width >= frame[2] and image.height >= frame[3]
                    role = "reference" if "reference" in filename else "actual"
                    images[role] = image.convert("RGB").crop(frame)
            assert set(images) == {"actual", "reference"}
            diff = ImageChops.difference(images["actual"], images["reference"])
            assert len(case["tiles"]) == 8
            total = 0
            for index, recorded in enumerate(case["tiles"]):
                x, y = 16 + index % 4 * 400, 16 + index // 4 * 480
                box = (x, y, x + 400, y + 480)
                tile = diff.crop(box)
                count = sum(pixel != (0, 0, 0) for pixel in tile.getdata())
                maximum = max(high for low, high in tile.getextrema())
                bounds = tile.getbbox()
                assert count == recorded["differentPixels"]
                assert maximum == recorded["maxChannelDifference"]
                assert (list(bounds) if bounds else None) == recorded["bounds"]
                for role, image in images.items():
                    nonwhite = sum(pixel != (255, 255, 255)
                                   for pixel in image.crop(box).getdata())
                    assert nonwhite == recorded["nonwhitePixels"][role] > 100
                total += count
            assert total == case["differentPixels"]
            assert (diff.getbbox() is None) == case["frameExact"]
            if name == "arc-reference-v2-report.json":
                assert total == 0 and diff.getbbox() is None
            summaries[name].append({"name": case["name"], "differentPixels": total})

    validation = json.loads((root / "validation.json").read_text())
    test = root.parents[3] / "src/testing/web-platform/tests/css/css-text-decor/astral-shadow-fallback-hyphen"
    for name, expected in validation["wptSHA256"].items():
        assert digest(test / name) == expected
    for captured, published in validation["sourceFixtureMapping"].items():
        original = (root / "fixture-proposals" / captured).read_bytes()
        original = original.replace(b"fallback-decoration-v2-ref.html",
                                    b"fallback-decoration-ref.html")
        original = original.replace(b"soft-hyphen-v2-ref.html",
                                    b"soft-hyphen-ref.html")
        assert original == (test / published).read_bytes()
    print(json.dumps({"verified": True, "comparisons": summaries,
                      "arcExactRevisedReferenceTiles": 16,
                      "scope": "Reference validity, not candidate or whole-browser parity."}))


if __name__ == "__main__":
    main()
