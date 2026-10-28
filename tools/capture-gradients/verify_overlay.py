#!/usr/bin/env python3
"""Check the gradient overlay against the pinned Mozilla source, without building."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--base-file", type=Path)
    source.add_argument("--download", action="store_true")
    args = parser.parse_args()
    manifest = json.loads((Path(__file__).parent / "manifest.json").read_text())
    version = json.loads((ROOT / "surfer.json").read_text())["version"]["version"]
    if version != manifest["version"]:
        raise ValueError("Firefox pin changed; rebase and revalidate the patch")
    if args.base_file:
        original = args.base_file.read_bytes()
    else:
        with urlopen(manifest["base_url"], timeout=45) as response:
            original = response.read()
    if sha(original) != manifest["base_sha256"]:
        raise ValueError("Original Firefox source hash differs")
    patch = ROOT / manifest["patch"]
    if sha(patch.read_bytes()) != manifest["patch_sha256"]:
        raise ValueError("Overlay changed; update validation before the manifest")
    with tempfile.TemporaryDirectory(prefix="zen-gradient-verify-") as temp:
        tree = Path(temp)
        target = tree / "layout/painting/nsCSSRenderingGradients.cpp"
        target.parent.mkdir(parents=True)
        target.write_bytes(original)
        subprocess.run(["git", "apply", "--check", "--whitespace=error", str(patch)], cwd=tree, check=True)
        subprocess.run(["git", "apply", str(patch)], cwd=tree, check=True)
        if sha(target.read_bytes()) != manifest["result_sha256"]:
            raise ValueError("Patched source hash differs")
    print(json.dumps({"overlay_applies": True, "version": version,
                      "compiled": False, "patched_engine_rendering_verified": False}))


if __name__ == "__main__":
    main()
