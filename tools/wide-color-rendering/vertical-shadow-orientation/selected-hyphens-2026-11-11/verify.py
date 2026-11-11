"""Verify Arc references, retained diagnostics, and candidate failures."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageChops


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compare(paths, bounds=None):
    images = []
    for path in paths:
        with Image.open(path) as image:
            assert image.format == "PNG"
            if bounds:
                assert image.width >= bounds[2] and image.height >= bounds[3]
            images.append(image.convert("RGB").crop(bounds) if bounds else image.convert("RGB"))
    assert images[0].size == images[1].size
    assert all(sum(p != (255, 255, 255) for p in image.getdata()) > 1000 for image in images)
    diff = ImageChops.difference(*images)
    return diff, sum(p != (0, 0, 0) for p in diff.getdata())


def main():
    root = Path(__file__).resolve().parent
    native = {}
    for name in ("arc-reference-report.json", "arc-reference-v2-report.json"):
        report = json.loads((root / name).read_text())
        native[name] = {}
        for case in report["cases"]:
            paths = [root / filename for filename in case["files"]]
            assert len(paths) == 2
            assert all(p.parent == root and digest(p) == case["files"][p.name] for p in paths)
            diff, count = compare(paths, report.get("contentBounds"))
            assert count == case["differentPixels"]
            for tile in case.get("tiles", []):
                i = tile["index"]
                x, y = 16 + i % 4 * 400, 16 + i // 4 * 480
                piece = diff.crop((x, y, x + 400, y + 480))
                assert sum(p != (0, 0, 0) for p in piece.getdata()) == tile["differentPixels"]
                assert max(high for low, high in piece.getextrema()) == tile["maxChannelDifference"]
            native[name][case["name"]] = count
    assert native["arc-reference-report.json"]["selected-plain"] == 0
    validation = json.loads((root / "validation.json").read_text())
    for mode, expected in validation["candidateFailures"].items():
        report = json.loads((root / mode / "report.json").read_text())
        assert report["completed"] and report["loadedEngineConfirmed"]
        assert report["files"] == expected["files"] and len(report["cases"]) == 1
        case = report["cases"][0]
        assert case["name"] == "selected-plain" and not case["diagnosticOnly"]
        paths = [root / mode / ("selected-plain" + suffix + ".png") for suffix in ("", "-ref")]
        for role, path in zip(("actual", "reference"), paths):
            assert digest(path) == case["imageSHA256"][role]
        diff, count = compare(paths)
        assert count == case["differentPixels"] == expected["differentPixels"] == 180
        assert not case["passed"]
        assert sum(not t["exact"] for t in case["tiles"]) == expected["failingTiles"] == 6
        for suffix in ("", "-ref"):
            page = json.loads((root / mode / ("selected-plain" + suffix + ".json")).read_text())
            assert page["selection"]["ready"] == "true" and page["selection"]["text"]
    tests = root.parents[3] / "src/testing/web-platform/tests/css/css-text-decor/astral-shadow-fallback-hyphen"
    for original, published in validation["mapping"].items():
        text = (root / "fixture-proposals" / original).read_text()
        text = text.replace("selected-plain-ref.html", "selected-soft-hyphen-ref.html")
        text = text.replace("<!doctype html>", '<!doctype html>\n<html class="reftest-wait">', 1)
        text = text.replace("document.documentElement.dataset.selectionFixtureReady = 'true';",
                            "document.documentElement.dataset.selectionFixtureReady = 'true';\n"
                            " requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('reftest-wait')));")
        assert text == (tests / published).read_text()
        assert digest(tests / published) == validation["wptSHA256"][published]
    print(json.dumps({"evidenceVerified": True, "arcReferenceExactTiles": 8,
                      "candidateFailingTilesPerPath": 6, "nativeResults": native,
                      "productionFixVerified": False}))


if __name__ == "__main__":
    main()
