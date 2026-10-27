#!/usr/bin/env python3
"""Exercise the real native resource validator with valid and corrupt bundles."""
import argparse
import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile


def run(binary: Path, source: Path) -> list[str]:
    passed = []
    with tempfile.TemporaryDirectory(prefix="zen-native-resource-tests-") as directory:
        target = Path(directory) / "resources"

        def check(label, edit=None, valid=False):
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(source, target)
            if edit:
                edit(target)
            result = subprocess.run([str(binary), str(target)], capture_output=True, check=False)
            assert result.returncode == (0 if valid else 1), (label, result.returncode, result.stderr)
            passed.append(label)

        def model_edit(change):
            def edit(root):
                file = root / "themes.json"
                data = json.loads(file.read_text())
                change(data)
                file.write_text(json.dumps(data))
            return edit

        def field_value(value):
            def edit(root):
                file = root / "theme-0.rgba32f"
                data = bytearray(file.read_bytes())
                data[:4] = struct.pack("<f", value)
                file.write_bytes(data)
            return edit

        check("valid extended-sRGB bundle", valid=True)
        check("negative color channels remain valid", field_value(-.2), valid=True)
        check("missing metadata", lambda r: (r / "themes.json").unlink())
        check("malformed JSON", lambda r: (r / "themes.json").write_text("{"))
        check("wrong root type", lambda r: (r / "themes.json").write_text("[]"))
        check("wrong metadata version", model_edit(lambda m: m.update(version=2)))
        check("empty theme set", model_edit(lambda m: m.update(themes=[])))
        check("too many themes", model_edit(lambda m: m.update(themes=m["themes"] * 65)))
        for name, value in [("width", 0), ("width", 513), ("height", -1),
                            ("width", 2.5), ("grain", 2), ("grain", "bad")]:
            check(f"invalid {name} {value}", model_edit(lambda m, n=name, v=value: m["themes"][0].update({n: v})))
        check("truncated pixels", lambda r: (r / "theme-0.rgba32f").write_bytes(b"\0"))
        check("NaN channel", field_value(float("nan")))
        check("infinite channel", field_value(float("inf")))
        check("overflowing half float", field_value(70000))
        check("missing grain", lambda r: (r / "grain.rgba8").unlink())
        check("corrupt shader", lambda r: (r / "theme.metallib").write_bytes(b"invalid"))

        def symlink(root):
            file = root / "theme-0.rgba32f"
            file.unlink()
            file.symlink_to(source / file.name)
        check("resource symlink", symlink)
    return passed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--resources", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps({"passed": run(args.binary.resolve(), args.resources.resolve())}, indent=2))
