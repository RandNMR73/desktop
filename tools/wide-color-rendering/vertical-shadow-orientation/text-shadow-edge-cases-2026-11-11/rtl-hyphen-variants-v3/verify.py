"""Recheck native Arc captures without treating failed proposals as references."""

from pathlib import Path
import hashlib
import json

from PIL import Image, ImageChops


def main():
    root = Path(__file__).resolve().parent
    report = json.loads((root / "arc-reference-report.json").read_text())
    assert report["tolerance"] == [0, 0]
    frame = tuple(report["contentBounds"])
    summaries = []
    for case in report["cases"]:
        images = {}
        for filename, expected in case["files"].items():
            path = root / filename
            assert path.parent == root
            assert hashlib.sha256(path.read_bytes()).hexdigest() == expected
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
        assert case["name"] in ("blur", "decoration")
        assert total == 0 and diff.getbbox() is None
        summaries.append({"case": case["name"], "differentPixels": total})
    manifest = json.loads((root / "manifest.json").read_text())
    for entry in manifest["files"]:
        path = root / "fixtures" / entry["fixture"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == entry["sha256"]
    print(json.dumps({"verified": True, "comparisons": summaries,
                      "arcExactReferenceTiles": 16,
                      "scope": "Arc reference validity, not candidate parity."}))


if __name__ == "__main__":
    main()
