#!/usr/bin/env python3
"""Export a receipted frontend derivative while retaining its existing engine."""
from pathlib import Path, PurePosixPath
import argparse
import configparser
import io
import json
import os
import plistlib
import re
import shutil
import signal
import struct
import subprocess
import sys
import time
import zipfile

from export_local import CORE, LOCAL_RESOURCES, git, require, sha256

NATIVE_LIBRARY = "Contents/MacOS/libzen-native-theme.dylib"
SOURCE_SCOPES = ("src", "configs", "surfer.json", "tools/native-theme-runtime")
# These exact reviewed files change training or tests, not the reused engine.
# Updating this list requires a new source review; there is no suffix exemption.
NON_PACKAGED = {
    "src/build/pgo/index-html.patch": "40c094d3706467c31b699abc876615882614cd3bcbefc99c67b206d624f3882e",
    "src/build/pgo/profileserver-py.patch": "fb501fafd6ebd2494e8473e0564476c6690943cba6107b30d948d677281910b8",
    "src/zen/tests/library/browser.toml": "1cd7d8e6748b89b99191941f8801ef8abc18871187011d0fb3c52651f08bafac",
    "src/zen/tests/library/browser_library_space_tab_attributes.js": "e6e180493f5ac81cbc7e8626ca9a9f87791b64777494f87843c1544cb847df25",
}
# An appended resource module also needs its reviewed moz.build declaration.
# These pins permit exactly this packaging-only edit, not arbitrary build edits.
MODULE_ADDITIONS = {
    "src/zen/urlbar/moz.build": {
        "beforeSHA256": "63b878188c5936c55af00ef360c9c2c3bc4d19aea2742252658e894c1206b1b7",
        "afterSHA256": "11094e5ee0b0f00b926eba7e79c7ea18317b6eeae22a759180ad825e12dd3e0a",
        "archive": "Contents/Resources/browser/omni.ja",
        "member": "modules/zen/urlbar/ZenSiteSearchParseCache.sys.mjs",
        "sourcePath": "src/zen/urlbar/ZenSiteSearchParseCache.sys.mjs",
    },
}
GIB = 1024 ** 3
IDENTITY_KEYS = ("CFBundleIdentifier", "CFBundleName", "CFBundleDisplayName", "CFBundleGetInfoString")


def data_sha(data):
    import hashlib
    return hashlib.sha256(data).hexdigest()


def load(path):
    require(path.is_file() and not path.is_symlink(), "Receipt must be a regular file")
    return json.loads(path.read_text())


def revision(value):
    require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value), "Invalid revision")
    return value


def source_bytes(repo, rev, path):
    return subprocess.check_output(["git", "-C", str(repo), "show", rev + ":" + path])


def changes(repo, before, after, *paths):
    return set(git(repo, "diff", "--name-only", before, after, "--", *paths).splitlines())


def relative_file(name):
    p = PurePosixPath(name)
    require(not p.is_absolute() and ".." not in p.parts and str(p) == name,
            "Unsafe manifest path")
    return name


def inventory(app):
    require(app.is_absolute() and app.suffix == ".app" and app.is_dir() and not app.is_symlink(),
            "Invalid application")
    result = {}
    for path in sorted(app.rglob("*")):
        require(not path.is_symlink(), "Application symlink is not supported")
        if path.is_file():
            result[str(path.relative_to(app))] = sha256(path)
    return result


def executable_payload(path):
    """Keep every pre-signature byte except three signature-size fields.

    Ad-hoc signing may resize its trailing payload and __LINKEDIT. The signature
    offset, executable instructions, other load commands and data stay exact.
    """
    data = bytearray(path.read_bytes())
    require(len(data) >= 32, "Truncated executable")
    magic, cpu, _, _, commands, size, _, _ = struct.unpack_from("<8I", data)
    require(magic == 0xfeedfacf and cpu == 0x100000c, "Expected thin arm64 executable")
    offset, signature = 32, None
    for _ in range(commands):
        require(offset + 8 <= 32 + size <= len(data), "Invalid load commands")
        command, length = struct.unpack_from("<II", data, offset)
        require(length >= 8 and offset + length <= 32 + size, "Invalid load command")
        if command == 0x19 and data[offset + 8:offset + 24].rstrip(b"\0") == b"__LINKEDIT":
            require(length >= 72, "Invalid segment command")
            data[offset + 32:offset + 40] = bytes(8)
            data[offset + 48:offset + 56] = bytes(8)
        if command == 0x1d:
            require(signature is None and length == 16, "Invalid signature command")
            signature = struct.unpack_from("<II", data, offset + 8)
            data[offset + 12:offset + 16] = bytes(4)
        offset += length
    require(offset == 32 + size and signature is not None, "Missing executable signature")
    start, length = signature
    require(start >= offset and start + length == len(data), "Signature is not the trailing payload")
    return data_sha(data[:start])


def archive(path):
    """Read an ordinary or Gecko startup-optimized archive without rewriting it."""
    data = path.read_bytes()
    for pos in range(len(data) - 22, max(-1, len(data) - 65558), -1):
        if data[pos:pos + 4] == b"PK\x05\x06" and pos + 22 + struct.unpack_from("<H", data, pos + 20)[0] == len(data):
            break
    else:
        raise ValueError("Missing archive directory")
    disk, ddisk, count, total, size, offset = struct.unpack_from("<4H2I", data, pos + 4)
    require(not disk and not ddisk and count == total and total != 65535, "Unsupported archive")
    if offset == 4:
        require(data[4:8] == b"PK\x01\x02", "Invalid optimized archive")
        end = bytearray(data[pos:])
        struct.pack_into("<I", end, 16, pos)
        data = data[:pos] + data[offset:offset + size] + end
    result = zipfile.ZipFile(io.BytesIO(data))
    require(len(result.namelist()) == len(set(result.namelist())), "Duplicate archive member")
    return result


def validate_source_changes(repo, base, target, replacements, additions):
    paths = {item["sourcePath"] for item in replacements.values()}
    changed = changes(repo, base, target, "src")
    declarations = {}
    accounted_additions = set()
    for name in sorted(changed & MODULE_ADDITIONS.keys()):
        declaration = MODULE_ADDITIONS[name]
        key = (declaration["archive"], declaration["member"])
        require(key in additions and replacements[key]["sourcePath"] == declaration["sourcePath"],
                "Packaging declaration lacks its receipted module addition: " + name)
        require(data_sha(source_bytes(repo, base, name)) == declaration["beforeSHA256"] and
                data_sha(source_bytes(repo, target, name)) == declaration["afterSHA256"],
                "Unreviewed packaging declaration bytes: " + name)
        declarations[name] = declaration
        accounted_additions.add(key)
    require(additions == accounted_additions, "Module addition lacks a reviewed packaging declaration")
    require(changed <= paths | NON_PACKAGED.keys() | declarations.keys(), "Unaccounted product-source change: " + str(changed - paths - NON_PACKAGED.keys() - declarations.keys()))
    require(not changes(repo, base, target, "configs", "surfer.json"), "Engine configuration changed")
    excluded = {}
    for name in sorted(changed & NON_PACKAGED.keys()):
        digest = data_sha(source_bytes(repo, target, name))
        require(digest == NON_PACKAGED[name], "Unreviewed training/test bytes: " + name)
        excluded[name] = digest
    return excluded, declarations


def preflight(args):
    revision(args.revision)
    require(sha256(args.candidate) == args.candidate_sha256, "Candidate receipt hash mismatch")
    candidate = load(args.candidate)
    engine = load(args.engine_candidate)
    build, inputs = load(args.build_state), load(args.build_inputs)
    require(build.get("complete") and build.get("exitCode") == 0 and build.get("phases") and
            all(p.get("exitCode") == 0 for p in build["phases"]), "Base engine build is incomplete")
    require(build["sources"] == inputs["files"], "Base engine build input records disagree")
    require(engine["buildStartedAt"] == build["startedAt"] and
            engine["nativeBaseSourceHead"] == inputs["sourceHead"], "Wrong engine build records")
    base = revision(engine["nativeSourceHead"])
    require(base == inputs["sourceHead"] == engine["sourceHead"], "Base engine source identity differs")
    subprocess.run(["git", "-C", str(args.source), "merge-base", "--is-ancestor", base, args.revision], check=True)
    subprocess.run(["git", "-C", str(args.source), "merge-base", "--is-ancestor", args.revision, args.integration_ref], check=True)
    original_frontend = revision(candidate["sourceRevision"])
    require(not changes(args.source, original_frontend, args.revision, *SOURCE_SCOPES),
            "Integrated source differs from the validated derivative")
    app, base_app = Path(candidate["app"]), Path(engine["app"])
    require(inventory(app) == candidate["files"], "Candidate inventory changed")
    require(all(sha256(base_app / relative_file(p)) == h for p, h in engine["files"].items()),
            "Base engine candidate changed")
    require(candidate["files"][CORE[0]] == engine["files"][CORE[0]], "Engine bytes changed")
    chain, receipts, replacements, additions = [], {}, {}, set()
    path, expected = args.candidate, args.candidate_sha256
    for _ in range(12):
        require(str(path) not in receipts and sha256(path) == expected, "Parent receipt cycle or hash mismatch")
        model = load(path)
        receipts[str(path)] = expected
        require(model.get("signatureVerified") is True and model.get("updaterConfigAbsent") is True,
                "Parent was not signed and isolated")
        parent_app = Path(model["app"])
        require(inventory(parent_app) == model["files"], "Parent application changed")
        chain.append({"manifestSHA256": expected, "sourceRevision": revision(model["sourceRevision"])})
        rows = model.get("replacements", model.get("archiveReplacements", []))
        for item in rows:
            scope, member = relative_file(item["archive"]), relative_file(item["member"])
            require(scope in CORE[1:], "Unexpected archive scope")
            source_path = relative_file(item["sourcePath"])
            expected_member = item.get("sha256", item.get("candidateSHA256"))
            with archive(parent_app / scope) as z:
                require(data_sha(z.read(member)) == expected_member, "Parent module bytes changed")
            require(data_sha(source_bytes(args.source, model["sourceRevision"], source_path)) == expected_member,
                    "Parent module differs from recorded source")
            if "oldSHA256" in item and item["oldSHA256"] is None:
                additions.add((scope, member))
            replacements.setdefault((scope, member), {"archive": scope, "member": member, "sourcePath": source_path})
        if model.get("kind") == "owned-diagnostic-derivative":
            require(model.get("baseSourceRevision") == base and model.get("engineUnchanged") is True,
                    "Derivative engine origin differs")
            terminal = model
            break
        require(model.get("kind") == "owned-resource-derivative", "Unsupported derivative receipt")
        path = Path(model["parentManifest"])
        expected = model["parentManifestSHA256"]
    else:
        raise ValueError("Too many derivative parents")
    baseline = terminal["baselineFiles"]
    allowed_files = set(CORE[1:]) | {NATIVE_LIBRARY, "Contents/Info.plist", "Contents/MacOS/zen",
                                   "Contents/_CodeSignature/CodeResources"}
    require(set(baseline) - set(candidate["files"]) == {"Contents/Resources/astral-update.json"} and
            not set(candidate["files"]) - set(baseline), "Unexpected bundle file set")
    require(all(h == baseline[name] or name in allowed_files for name, h in candidate["files"].items()),
            "Unaccounted bundle or native change")
    executable_hash = executable_payload(app / "Contents/MacOS/zen")
    require(executable_hash == executable_payload(base_app / "Contents/MacOS/zen"),
            "Executable changed beyond signature-size bookkeeping")
    before_info = plistlib.loads((base_app / "Contents/Info.plist").read_bytes())
    after_info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    require(before_info.get("CFBundleIdentifier") == "app.zen-browser.zen" and
            before_info.get("CFBundleName") == "Zen", "Unexpected base application identity")
    require(after_info.get("CFBundleGetInfoString") in (before_info.get("CFBundleGetInfoString"),
            "Owned diagnostic derivative of Zen Astral17; not a release"), "Unexpected diagnostic identity text")
    normal_identity = {key: before_info[key] for key in IDENTITY_KEYS if key in before_info}
    for key in IDENTITY_KEYS:
        before_info.pop(key, None)
        after_info.pop(key, None)
    require(before_info == after_info, "Unexpected application identity metadata change")
    for scope in CORE[1:]:
        with archive(base_app / scope) as before, archive(app / scope) as after:
            appended = {member for archive_name, member in additions if archive_name == scope}
            require(not appended.intersection(before.namelist()) and
                    after.namelist()[:len(before.namelist())] == before.namelist() and
                    set(after.namelist()[len(before.namelist()):]) == appended,
                    "Archive members/order differ beyond receipted appended modules")
            actual = {name for name in before.namelist() if before.read(name) != after.read(name)}
            actual.update(appended)
            declared = {member for archive_name, member in replacements if archive_name == scope}
            require(actual == declared, "Archive changes do not match the receipt chain")
            for member in actual:
                item = replacements[(scope, member)]
                data = source_bytes(args.source, args.revision, item["sourcePath"])
                require(after.read(member) == data, "Packaged module differs from integrated source")
                item["sha256"] = data_sha(data)
    excluded, declarations = validate_source_changes(args.source, base, args.revision, replacements, additions)
    native_sources = terminal["nativeSourceHashes"]
    require(native_sources and all(data_sha(source_bytes(args.source, args.revision, name)) == digest
                                  for name, digest in native_sources.items()), "Optional native source changed")
    native_delta = changes(args.source, base, args.revision, "tools/native-theme-runtime")
    require(native_delta <= native_sources.keys() | {"tools/native-theme-runtime/README.md", "tools/native-theme-runtime/TestDownloadKind.m"},
            "Unaccounted optional native source change")
    require(candidate["files"][NATIVE_LIBRARY] == terminal["files"][NATIVE_LIBRARY], "Optional native library changed")
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True, capture_output=True)
    pins = {str(p): sha256(p) for p in [args.candidate, args.engine_candidate, args.build_state, args.build_inputs,
                                       Path(__file__), Path(__file__).with_name("export_local.py")]}
    pins.update(receipts)
    for receipt in receipts:
        model = load(Path(receipt))
        pins.update({str(Path(model["app"]) / name): digest for name, digest in model["files"].items()})
    pins.update({str(base_app / name): digest for name, digest in engine["files"].items()})
    provenance = {
        "schemaVersion": 2, "kind": "validated-resource-derivative",
        "releaseRevision": args.revision, "frontendRevision": args.revision,
        "engineRevision": base, "nativeBaseRevision": base, "geckoBase": inputs["geckoBase"],
        "engineBuild": {"startedAt": build["startedAt"], "endedAt": build["endedAt"],
                        "candidateSHA256": sha256(args.engine_candidate), "stateSHA256": sha256(args.build_state),
                        "inputsSHA256": sha256(args.build_inputs), "recompiled": False},
        "candidateManifestSHA256": args.candidate_sha256,
        "exporterSHA256": sha256(Path(__file__)),
        "nativeExporterSHA256": sha256(Path(__file__).with_name("export_local.py")),
        "normalBundleIdentity": normal_identity,
        "executableNonSignatureSHA256": executable_hash,
        "validatedFrontendRevision": original_frontend,
        "sourceEquivalence": {"integratedSourceIdentical": True, "scopes": list(SOURCE_SCOPES),
                              "integrationRef": args.integration_ref, "integrationRevision": git(args.source, "rev-parse", args.integration_ref)},
        "parentReceipts": chain, "resourceReplacements": list(replacements.values()),
        "nonPackagedSourceChanges": excluded,
        "packagingDeclarationChanges": declarations,
        "appendedResourceModules": [replacements[key] for key in sorted(additions)],
        "optionalNativeLibrary": {"file": NATIVE_LIBRARY, "sha256": candidate["files"][NATIVE_LIBRARY],
                                  "sourceRevision": terminal["sourceRevision"], "sourceHashes": native_sources,
                                  "assemblyManifestSHA256": chain[-1]["manifestSHA256"], "restoredByUpdater": True},
        "notes": "Frontend resources match the integrated revision. The engine is reused from the separately recorded build. The optional native helper has separate later source provenance and must be restored by the enrolled runtime. Training/test-only source changes were not applied to this engine. No new engine build or training is claimed.",
    }
    return app, candidate, pins, provenance


class BoundedCommands:
    """Monitor fixed packaging commands; retain failures and stop only owned groups."""
    def __init__(self, root):
        self.root = root
        self.records = []
        self.samples = []

    def check(self):
        free = shutil.disk_usage(self.root).free
        allocated = sum(p.lstat().st_blocks * 512 for p in self.root.rglob("*"))
        self.samples.append({"freeBytes": free, "ownedAllocatedBytes": allocated})
        require(free > 2 * GIB, "Available storage reached the 2 GiB reserve")
        require(allocated <= 2 * GIB, "Owned export allocation exceeded 2 GiB")

    def run(self, argv, label, cleanup=False):
        if not cleanup:
            self.check()
        argv = [str(a) for a in argv]
        start = time.monotonic()
        with (self.root / (label + ".log")).open("wb") as log:
            child = subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                while True:
                    if not cleanup:
                        self.check()
                    require(time.monotonic() - start < 300, "Command exceeded 300 seconds")
                    if child.poll() is not None:
                        break
                    time.sleep(.25)
                require(child.returncode == 0, label + " failed; retained log")
            except BaseException:
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGTERM)
                    try:
                        child.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait()
                raise
            finally:
                self.records.append({"argv": argv, "exitCode": child.poll(), "elapsedSecondsForLimitOnly": time.monotonic() - start})
                (self.root / "commands.json").write_text(json.dumps(self.records, indent=2) + "\n")
        if not cleanup:
            self.check()


def export(args, app, candidate, pins, provenance):
    require(not args.output.exists(), "Output must be new")
    output = args.output.resolve()
    require(not any(output.is_relative_to(parent) for parent in (app, args.source.resolve())),
            "Output must be outside the input application and source checkout")
    input_apps = {parent for name in pins for parent in Path(name).parents if parent.suffix == ".app"}
    require(not any(output.is_relative_to(parent) for parent in input_apps),
            "Output must be outside all input applications")
    require(shutil.disk_usage(args.output.parent).free > 2 * GIB, "Less than 2 GiB reserve")
    args.output.mkdir()
    commands = BoundedCommands(args.output)
    status = {"complete": False, "published": False, "installed": False,
              "inputPins": pins,
              "limits": {"ownedAllocatedBytes": 2 * GIB, "minimumFreeBytesExclusive": 2 * GIB, "commandSeconds": 300}}
    try:
        contents = args.output / "contents"
        contents.mkdir()
        exported = contents / "Zen.app"
        commands.run(["/bin/cp", "-cR", app, exported], "clone")
        require(inventory(exported) == candidate["files"], "Clone differs from candidate")
        for name in LOCAL_RESOURCES:
            path = exported / name
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink(missing_ok=True)
        info_path = exported / "Contents/Info.plist"
        info = plistlib.loads(info_path.read_bytes())
        for key in IDENTITY_KEYS:
            info.pop(key, None)
        info.update(provenance["normalBundleIdentity"])
        info_path.write_bytes(plistlib.dumps(info, sort_keys=False))
        core = {name: sha256(exported / name) for name in CORE}
        require(all(core[name] == candidate["files"][name] for name in CORE), "Core bytes changed")
        platform = configparser.RawConfigParser()
        platform.read(exported / "Contents/Resources/platform.ini")
        provenance.update(legacyResourceSourceStamp=platform.get("Build", "SourceStamp"),
                          files=core, removedLocalResources=list(LOCAL_RESOURCES), exportedAt=time.time())
        (exported / "Contents/Resources/astral-build.json").write_text(json.dumps(provenance, indent=2) + "\n")
        for path in (exported / "Contents").rglob("*"):
            if path.is_file() and path.suffix in (".json", ".ini", ".plist"):
                text = repr(plistlib.loads(path.read_bytes())) if path.suffix == ".plist" else path.read_text()
                require(not re.search(r"/(?:Users|home)/|fixture-update-state|zen-arc-validation", text), "Machine-local package metadata remains")
        commands.run(["/usr/bin/codesign", "--force", "--sign", "-", exported], "sign")
        commands.run(["/usr/bin/codesign", "--verify", "--deep", "--strict", exported], "verify-signature")
        require(executable_payload(exported / "Contents/MacOS/zen") == provenance["executableNonSignatureSHA256"],
                "Signing changed executable code")
        require(all(sha256(exported / name) == digest for name, digest in core.items()), "Signing changed core bytes")
        version = json.loads(source_bytes(args.source, args.revision, "surfer.json"))["brands"]["release"]["release"]["displayVersion"]
        require(re.fullmatch(r"[0-9A-Za-z.+-]+", version), "Invalid version")
        image = args.output / f"zen-astral-{version}-macos-aarch64.dmg"
        commands.run(["/usr/bin/hdiutil", "create", "-srcfolder", contents, "-volname", "Zen Astral", "-format", "UDZO", image], "create-image")
        commands.run(["/usr/bin/hdiutil", "verify", image], "verify-image")
        mount = args.output / "mounted"
        mount.mkdir()
        try:
            commands.run(["/usr/bin/hdiutil", "attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount, image], "mount-image")
            require(all(sha256(mount / "Zen.app" / name) == value for name, value in core.items()), "Mounted core differs")
            require(inventory(mount / "Zen.app") == inventory(exported), "Mounted application differs")
            commands.run(["/usr/bin/codesign", "--verify", "--deep", "--strict", mount / "Zen.app"], "verify-mounted-signature")
        finally:
            if os.path.ismount(mount):
                commands.run(["/usr/bin/hdiutil", "detach", mount], "detach-image", cleanup=True)
        image_hash = sha256(image)
        (args.output / (image.name + ".sha256")).write_text(image_hash + "  " + image.name + "\n")
        shutil.copyfile(exported / "Contents/Resources/platform.ini", args.output / "platform.ini")
        provenance.update(image=image.name, imageSHA256=image_hash, signatureVerified=True, mountedImageVerified=True,
                          published=False, installed=False)
        (args.output / "build-provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
        status.update(complete=True, image=image.name, imageSHA256=image_hash)
    finally:
        status["inputsUnchanged"] = all(sha256(Path(name)) == value for name, value in pins.items())
        status["sourceCandidateUnchanged"] = inventory(app) == candidate["files"]
        status["commands"] = commands.records
        status["samples"] = commands.samples
        status["complete"] &= status["inputsUnchanged"] and status["sourceCandidateUnchanged"]
        finish_receipt(args.output / "export-result.json", status, commands)
    require(status["complete"], "Export postflight failed")
    return status


def finish_receipt(path, status, commands):
    """A final sample over either cap must never leave a successful receipt."""
    try:
        commands.check()
        path.write_text(json.dumps(status, indent=2) + "\n")
        commands.check()
    except ValueError:
        status["complete"] = False
        raise
    finally:
        path.write_text(json.dumps(status, indent=2) + "\n")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("source", "candidate", "engine-candidate", "build-state", "build-inputs", "output"):
        p.add_argument("--" + name, required=True, type=Path)
    p.add_argument("--candidate-sha256", required=True)
    p.add_argument("--revision", required=True)
    p.add_argument("--integration-ref", default="origin/astral")
    p.add_argument("--preflight-only", action="store_true")
    args = p.parse_args()
    require(sys.platform == "darwin", "Resource export requires macOS")
    require(not args.output.exists(), "Output must be new")
    app, candidate, pins, provenance = preflight(args)
    if args.preflight_only:
        print(json.dumps(provenance, indent=2))
        return
    result = export(args, app, candidate, pins, provenance)
    print(json.dumps({key: result[key] for key in ("complete", "image", "imageSHA256", "published", "installed")}))


if __name__ == "__main__":
    main()
