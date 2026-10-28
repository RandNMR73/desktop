#!/usr/bin/env python3
"""Verify the pinned backdrop overlay in a temporary tree, never in an app."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import subprocess
import tempfile
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_path(value, prefix):
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or not value.startswith(prefix):
        raise ValueError(f"Unexpected overlay path: {value}")
    return Path(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--base-cache", type=Path, help="Read-only tree of the pinned original Firefox files")
    source.add_argument("--download", action="store_true", help="Fetch only affected original files from the pinned Mozilla commit")
    parser.add_argument("--syntax", action="store_true", help="Parse patched Rust with rustfmt; this is not a compiler check")
    args = parser.parse_args()
    manifest = json.loads((Path(__file__).parent / "manifest.json").read_text())
    version = json.loads((ROOT / "surfer.json").read_text())["version"]["version"]
    if manifest["base_tag"] != f"FIREFOX_{version.replace('.', '_')}_RELEASE":
        raise ValueError("Firefox pin changed; rebase and revalidate this backport")

    with tempfile.TemporaryDirectory(prefix="zen-backdrop-verify-") as directory:
        tree = Path(directory)
        for entry in manifest["files"]:
            relative = safe_path(entry["path"], "gfx/wr/")
            source_path = safe_path(entry["source"], "src/gfx/wr/")
            payload = (ROOT / source_path).read_bytes()
            if digest(payload) != entry["source_sha256"]:
                raise ValueError(f"Overlay hash mismatch: {source_path}")
            target = tree / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if entry["base_sha256"] is not None:
                if args.base_cache:
                    original = (args.base_cache / relative).read_bytes()
                else:
                    url = f"https://raw.githubusercontent.com/mozilla-firefox/firefox/{manifest['base_sha']}/{relative.as_posix()}"
                    with urlopen(Request(url, headers={"User-Agent": "Zen-backdrop-overlay-verifier"}), timeout=45) as response:
                        original = response.read()
                if digest(original) != entry["base_sha256"]:
                    raise ValueError(f"Base hash mismatch: {relative}")
                target.write_bytes(original)
            if entry["kind"] == "patch":
                subprocess.run(["git", "apply", "--check", "--whitespace=error", str(ROOT / source_path)], cwd=tree, check=True)
                subprocess.run(["git", "apply", "--whitespace=error", str(ROOT / source_path)], cwd=tree, check=True)
            elif entry["kind"] == "overlay":
                target.write_bytes(payload)
            else:
                raise ValueError(f"Unknown overlay kind: {entry['kind']}")
            if digest(target.read_bytes()) != entry["result_sha256"]:
                raise ValueError(f"Patched result mismatch: {relative}")

        rust_files = sorted(tree.rglob("*.rs"))
        if args.syntax:
            for path in rust_files:
                subprocess.run(
                    ["rustfmt", "--emit", "stdout", "--edition", "2018", "--config", "skip_children=true", str(path)],
                    stdout=subprocess.DEVNULL, check=True,
                )
        print(json.dumps({
            "base_tag": manifest["base_tag"], "base_sha": manifest["base_sha"],
            "overlay_files_verified": len(manifest["files"]),
            "rust_files_parsed": len(rust_files) if args.syntax else None,
            "compiler_check_passed": False, "render_tests_run": False,
            "application_modified": False,
        }, indent=2))


if __name__ == "__main__":
    main()
