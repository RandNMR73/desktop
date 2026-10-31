#!/usr/bin/env python3
"""Pack SVG frames exported by lottie-web 5.13.0 into context-colored strips.

Export the installed Arc HomeButton assets in an owned browser (see the
validation reference). This build step preserves masks, offset paths, strokes,
and per-frame definitions; no animation player is shipped with the browser.
"""
import argparse
import json
import re
from pathlib import Path
from xml.etree import ElementTree as ET

SVG = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG)
ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")
ROOT = Path(__file__).resolve().parents[2]
OUTPUTS = {
    "archive": "src/browser/themes/shared/zen-icons/common/library/library-history-sprite.svg",
    "downloads": "src/browser/themes/shared/zen-icons/common/library/library-downloads-sprite.svg",
    "screenshots": "src/browser/themes/shared/zen-icons/common/library/library-media-sprite.svg",
    "spaces": "src/browser/themes/shared/zen-icons/common/library/library-spaces-sprite.svg",
    "boosts": "src/browser/themes/shared/zen-icons/common/library/library-boosts-sprite.svg",
    "easels": "src/zen/easels/icons/easel-library-sprite.svg",
}


def frame_svg(source, index):
    frame = ET.fromstring(source)
    ids = {node.get("id"): f"f{index}-{node.get('id')}" for node in frame.iter() if node.get("id")}
    def clean(node, color=None):
        color = {"primaryColor": "context-stroke", "secondaryColor": "context-fill"}.get(node.get("class"), color)
        for key, value in list(node.attrib.items()):
            if key == "id":
                node.set(key, ids[value])
            elif key == "class":
                del node.attrib[key]
            elif key in ("fill", "stroke") and color and value not in ("none", "transparent"):
                assert not value.startswith("url("), "Gradient colors require explicit conversion"
                node.set(key, color)
            else:
                value = re.sub(r"url\(#([^)]+)\)", lambda m: "url(#" + ids[m[1]] + ")", value)
                if key.endswith("href") and value.startswith("#"):
                    value = "#" + ids[value[1:]]
                # Five decimal places are <0.00001pt at the rendered 28pt size.
                if key in ("d", "transform"):
                    value = re.sub(r"-?\d+\.\d+(?:e[+-]?\d+)?", lambda m: format(float(m[0]), ".5f").rstrip("0").rstrip("."), value)
                node.set(key, value)
        for child in node:
            clean(child, color)
    clean(frame)
    frame.attrib.pop("style", None)
    frame.set("x", str(index * 28))
    frame.set("width", "28")
    frame.set("height", "28")
    return frame


def build(export_dir, root=ROOT):
    report = {}
    for name, output in OUTPUTS.items():
        data = json.loads((export_dir / f"{name}-frames.json").read_text())
        assert len(data["frames"]) == data["end"] + 1
        count = len(data["frames"])
        strip = ET.Element(f"{{{SVG}}}svg", {"width":str(28*count), "height":"28",
            "viewBox":f"0 0 {28*count} 28", "fill":"none", "stroke":"none"})
        for index, frame in enumerate(data["frames"]):
            strip.append(frame_svg(frame, index))
        raw = ET.tostring(strip) + b"\n"
        (root / output).write_bytes(raw)
        report[name] = {"frames":count,"end":data["end"],"bytes":len(raw),"output":output}
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("export_dir", type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.export_dir), indent=2))
