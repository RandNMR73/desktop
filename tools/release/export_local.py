#!/usr/bin/env python3
"""Package an already validated local fork assembly without publishing it."""
from pathlib import Path
import argparse
import configparser
import hashlib
import json
import plistlib
import re
import shutil
import subprocess
import sys
import time

CORE = (
    "Contents/MacOS/XUL",
    "Contents/Resources/browser/omni.ja",
    "Contents/Resources/omni.ja",
)
LOCAL_RESOURCES = (
    "Contents/Resources/astral-update.json",
    "Contents/Resources/browser/astral-omni-patches.json",
    "Contents/Resources/zen-native-theme",
    "Contents/MacOS/libzen-native-theme.dylib",
    "Contents/Resources/zen-app-icons/build-manifest.json",
)


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--build-state", required=True, type=Path)
    parser.add_argument("--build-inputs", required=True, type=Path)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    require(sys.platform == "darwin", "Export requires macOS")
    require(re.fullmatch(r"[0-9a-f]{40}", args.revision), "Use a full release revision")
    candidate = json.loads(args.candidate.read_text())
    build = json.loads(args.build_state.read_text())
    inputs = json.loads(args.build_inputs.read_text())
    require(build.get("complete") and build.get("exitCode") == 0, "Native build is incomplete")
    require(build["phases"] and all(phase.get("exitCode") == 0 for phase in build["phases"]),
            "A native build phase failed")
    require(build["sources"] == inputs["files"], "Native input fingerprints differ")
    require(candidate["buildStartedAt"] == build["startedAt"], "Candidate is from another build")
    require(candidate["nativeBaseSourceHead"] == inputs["sourceHead"], "Native base differs")
    for revision in (candidate["sourceHead"], candidate["nativeSourceHead"], inputs["sourceHead"]):
        require(re.fullmatch(r"[0-9a-f]{40}", revision), "Invalid component source revision")
        subprocess.run(["git", "-C", str(args.source), "merge-base", "--is-ancestor",
                        revision, args.revision], check=True)
    changes = git(args.source, "diff", "--name-only", candidate["sourceHead"], args.revision,
                  "--", "src", "configs", "surfer.json")
    require(not changes, "Release code differs from the validated candidate: " + changes)
    native_changes = git(args.source, "diff", "--name-only", candidate["nativeSourceHead"],
                         args.revision, "--", "src").splitlines()
    native_suffix = re.compile(r"(?:[.-](?:c|cc|cpp|h|hh|hpp|m|mm|rs|py|toml|build|in|idl|webidl|ipdl))(?:\.patch)?$")
    require(not any(native_suffix.search(path) for path in native_changes),
            "Native source changed after the compiled candidate")
    app = Path(candidate["app"])
    require(app.is_absolute() and app.suffix == ".app", "Invalid candidate application")
    require(all(sha256(app / name) == value for name, value in candidate["files"].items()),
            "Candidate resources changed after validation")
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
    version = json.loads(git(args.source, "show", args.revision + ":surfer.json"))["brands"]["release"]["release"]["displayVersion"]
    require(re.fullmatch(r"[0-9A-Za-z.+-]+", version), "Invalid display version")
    require(shutil.disk_usage(args.output.parent).free > 2 * 1024**3, "Less than 2 GiB free")
    args.output.mkdir()
    contents = args.output / "contents"
    contents.mkdir()
    exported = contents / "Zen.app"
    subprocess.run(["cp", "-cR", str(app), str(exported)], check=True)
    for name in LOCAL_RESOURCES:
        path = exported / name
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink(missing_ok=True)
    for path in (exported / "Contents").rglob("*"):
        if not path.is_file() or path.suffix not in (".json", ".ini", ".plist"):
            continue
        if path.suffix == ".plist":
            data = repr(plistlib.loads(path.read_bytes()))
        else:
            data = path.read_text()
        require(not re.search(r"/(?:Users|home)/|fixture-update-state|zen-arc-validation", data),
                "Machine-local metadata remains in " + str(path.relative_to(exported)))
    core = {name: sha256(exported / name) for name in CORE}
    require(all(core[name] == candidate["files"][name] for name in CORE), "Export changed browser code")
    platform = configparser.RawConfigParser()
    platform.read(exported / "Contents/Resources/platform.ini")
    provenance = {
        "schemaVersion": 1,
        "kind": "validated-local-assembly",
        "releaseRevision": args.revision,
        "frontendRevision": candidate["sourceHead"],
        "nativeRevision": candidate["nativeSourceHead"],
        "nativeBaseRevision": inputs["sourceHead"],
        "geckoBase": inputs["geckoBase"],
        "legacyResourceSourceStamp": platform.get("Build", "SourceStamp"),
        "nativeBuildStartedAt": build["startedAt"],
        "nativeBuildEndedAt": build["endedAt"],
        "nativeBuildInputsSHA256": sha256(args.build_inputs),
        "candidateManifestSHA256": sha256(args.candidate),
        "exportedAt": time.time(),
        "files": core,
        "removedLocalResources": list(LOCAL_RESOURCES),
        "notes": "Core bytes are unchanged from the validated local assembly. Legacy platform.ini identifies the resource baseline used by the archive-patch catalog. Component revisions above identify the assembled code. The local updater restores enrolled theme resources and machine-specific update configuration during staging.",
    }
    (exported / "Contents/Resources/astral-build.json").write_text(json.dumps(provenance, indent=2) + "\n")
    subprocess.run(["codesign", "--force", "--sign", "-", str(exported)], check=True)
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(exported)], check=True)
    name = f"zen-astral-{version}-macos-aarch64.dmg"
    image = args.output / name
    subprocess.run(["hdiutil", "create", "-srcfolder", str(contents), "-volname", "Zen Astral",
                    "-format", "UDZO", str(image)], check=True)
    subprocess.run(["hdiutil", "verify", str(image)], check=True)
    mounted = args.output / "mounted"
    mounted.mkdir()
    subprocess.run(["hdiutil", "attach", "-readonly", "-nobrowse", "-noautoopen",
                    "-mountpoint", str(mounted), str(image)], check=True)
    try:
        require(all(sha256(mounted / "Zen.app" / path) == value for path, value in core.items()),
                "Mounted image differs from the candidate")
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(mounted / "Zen.app")], check=True)
    finally:
        subprocess.run(["hdiutil", "detach", str(mounted)], check=True)
    image_hash = sha256(image)
    (args.output / (name + ".sha256")).write_text(image_hash + "  " + name + "\n")
    shutil.copyfile(exported / "Contents/Resources/platform.ini", args.output / "platform.ini")
    provenance.update(image=name, imageSHA256=image_hash, signatureVerified=True, mountedImageVerified=True,
                      published=False, installed=False)
    (args.output / "build-provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    require(all(sha256(app / name) == value for name, value in candidate["files"].items()),
            "Source candidate changed during export")
    print(json.dumps({"image": str(image), "sha256": image_hash, "published": False}))


if __name__ == "__main__":
    main()
