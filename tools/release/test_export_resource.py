"""Finite source/receipt/export guard tests; no application launch or signing."""
from pathlib import Path
from types import SimpleNamespace
import json
import plistlib
import shutil
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import export_resource as export


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def signed_executable(signature=b"signature", code=b"CODE"):
    header = struct.pack("<8I", 0xfeedfacf, 0x100000c, 0, 2, 2, 88, 0, 0)
    segment = struct.pack("<II16s4Q4I", 0x19, 72, b"__LINKEDIT", 0, len(signature) + 8,
                          120, len(signature) + len(code), 1, 1, 0, 0)
    sign = struct.pack("<4I", 0x1d, 16, 120 + len(code), len(signature))
    return header + segment + sign + code + signature


class Fixture:
    def __init__(self, root):
        self.root, self.repo = root, root / "repo"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("config", "user.name", "Exporter test")
        self.git("config", "user.email", "exporter@example.invalid")
        self.put("src/foo.mjs", "base")
        self.put("src/moz.build", 'EXTRA_JS_MODULES += ["foo.mjs"]\n')
        self.put("tools/native-theme-runtime/native.m", "native base")
        self.put("surfer.json", '{"brands":{"release":{"release":{"displayVersion":"1.0"}}}}')
        self.base = self.commit("engine")
        self.put("src/foo.mjs", "frontend")
        self.put("tools/native-theme-runtime/native.m", "native newer")
        self.frontend = self.commit("validated branch")
        self.git("checkout", "-q", "-b", "integrated", self.base)
        self.put("src/foo.mjs", "frontend")
        self.put("tools/native-theme-runtime/native.m", "native newer")
        self.put("README.md", "Squash-equivalent integration")
        self.target = self.commit("squash integration")
        self.git("update-ref", "refs/remotes/origin/astral", self.target)
        self.base_app = root / "Engine.app"
        self.app = root / "Derivative.app"
        for name, data in {
            export.CORE[0]: b"unchanged engine",
            "Contents/MacOS/zen": signed_executable(),
            export.NATIVE_LIBRARY: b"native base",
            "Contents/Resources/astral-update.json": b"{}",
            "Contents/_CodeSignature/CodeResources": b"signed",
        }.items():
            p = self.base_app / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        (self.base_app / "Contents/Info.plist").write_bytes(plistlib.dumps({
            "CFBundleIdentifier": "app.zen-browser.zen", "CFBundleName": "Zen", "CFBundleVersion": "1"}))
        self.zip(self.base_app / export.CORE[1], {"foo.mjs": b"base", "keep": b"same"})
        self.zip(self.base_app / export.CORE[2], {"keep": b"same"})
        shutil.copytree(self.base_app, self.app)
        self.zip(self.app / export.CORE[1], {"foo.mjs": b"frontend", "keep": b"same"})
        (self.app / export.NATIVE_LIBRARY).write_bytes(b"native newer")
        (self.app / "Contents/Resources/astral-update.json").unlink()
        self.engine = root / "engine.json"
        self.build = root / "build.json"
        self.inputs = root / "inputs.json"
        self.parent = root / "parent.json"
        self.candidate = root / "candidate.json"
        self.state = {"complete": True, "exitCode": 0, "phases": [{"exitCode": 0}],
                      "sources": {"source": "pin"}, "startedAt": "start", "endedAt": "end"}
        write_json(self.build, self.state)
        write_json(self.inputs, {"files": self.state["sources"], "sourceHead": self.base, "geckoBase": "fixture"})
        write_json(self.engine, {"app": str(self.base_app), "files": {p: export.sha256(self.base_app / p) for p in export.CORE},
                               "buildStartedAt": "start", "nativeBaseSourceHead": self.base,
                               "nativeSourceHead": self.base, "sourceHead": self.base})
        self.terminal = {"kind": "owned-diagnostic-derivative", "sourceRevision": self.frontend,
                         "app": str(self.app), "files": export.inventory(self.app),
                         "signatureVerified": True, "updaterConfigAbsent": True,
                         "baseSourceRevision": self.base, "engineUnchanged": True,
                         "baselineFiles": export.inventory(self.base_app),
                         "nativeSourceHashes": {"tools/native-theme-runtime/native.m": export.data_sha(b"native newer")},
                         "archiveReplacements": [{"archive": export.CORE[1], "member": "foo.mjs", "sourcePath": "src/foo.mjs",
                                                   "candidateSHA256": export.data_sha(b"frontend")}]}
        self.final_app = root / "Final.app"
        shutil.copytree(self.app, self.final_app)
        self.child = {"kind": "owned-resource-derivative", "sourceRevision": self.frontend,
                      "app": str(self.final_app), "files": export.inventory(self.final_app),
                      "signatureVerified": True, "updaterConfigAbsent": True,
                      "parentManifest": str(self.parent), "replacements": []}
        self.args = SimpleNamespace(source=self.repo, candidate=self.candidate, candidate_sha256=None,
                                    engine_candidate=self.engine, build_state=self.build, build_inputs=self.inputs,
                                    revision=self.target, integration_ref="origin/astral", output=root / "export")
        self.save()

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], text=True).strip()

    def put(self, name, data):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(data)

    def commit(self, message):
        self.git("add", ".")
        self.git("commit", "-qm", message)
        return self.git("rev-parse", "HEAD")

    def save(self):
        write_json(self.parent, self.terminal)
        self.child["parentManifestSHA256"] = export.sha256(self.parent)
        write_json(self.candidate, self.child)
        self.args.candidate_sha256 = export.sha256(self.candidate)

    @staticmethod
    def zip(path, entries):
        path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(path, "w") as archive:
            for name, data in entries.items():
                archive.writestr(name, data)


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.f = Fixture(Path(self.temp.name))

    def check(self):
        real_run = subprocess.run
        def run(args, **kwargs):
            if Path(args[0]).name == "codesign":
                return subprocess.CompletedProcess(args, 0)
            return real_run(args, **kwargs)
        with patch.object(export.subprocess, "run", side_effect=run):
            return export.preflight(self.f.args)

    def add_module(self):
        before = 'EXTRA_JS_MODULES += ["foo.mjs"]\n'
        after = 'EXTRA_JS_MODULES += ["foo.mjs", "new.mjs"]\n'
        self.f.put("src/moz.build", after)
        self.f.put("src/new.mjs", "new module")
        revision = self.f.commit("append module")
        self.f.args.revision = self.f.child["sourceRevision"] = revision
        self.f.git("update-ref", "refs/remotes/origin/astral", revision)
        self.f.zip(self.f.final_app / export.CORE[1], {
            "foo.mjs": b"frontend", "keep": b"same", "new.mjs": b"new module"})
        self.f.child["files"] = export.inventory(self.f.final_app)
        self.f.child["replacements"] = [{"archive": export.CORE[1], "member": "new.mjs",
            "sourcePath": "src/new.mjs", "sha256": export.data_sha(b"new module"), "oldSHA256": None}]
        self.f.save()
        patcher = patch.object(export, "MODULE_ADDITIONS", {"src/moz.build": {
            "beforeSHA256": export.data_sha(before.encode()), "afterSHA256": export.data_sha(after.encode()),
            "archive": export.CORE[1], "member": "new.mjs", "sourcePath": "src/new.mjs"}})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_receipted_appended_module_and_declaration_are_attributed(self):
        self.add_module()
        *_, provenance = self.check()
        self.assertEqual(provenance["appendedResourceModules"][0]["member"], "new.mjs")
        self.assertEqual(set(provenance["packagingDeclarationChanges"]), {"src/moz.build"})
        self.assertNotIn("src/moz.build", provenance["nonPackagedSourceChanges"])

    def test_new_module_without_explicit_addition_receipt_is_rejected(self):
        self.add_module()
        del self.f.child["replacements"][0]["oldSHA256"]
        self.f.save()
        with self.assertRaisesRegex(ValueError, "Archive members/order"):
            self.check()

    def test_added_module_may_not_reorder_existing_members(self):
        self.add_module()
        self.f.zip(self.f.final_app / export.CORE[1], {
            "new.mjs": b"new module", "foo.mjs": b"frontend", "keep": b"same"})
        self.f.child["files"] = export.inventory(self.f.final_app)
        self.f.save()
        with self.assertRaisesRegex(ValueError, "Archive members/order"):
            self.check()

    def test_unreviewed_module_declaration_is_rejected(self):
        self.add_module()
        with patch.object(export, "MODULE_ADDITIONS", {}):
            with self.assertRaisesRegex(ValueError, "lacks a reviewed packaging"):
                self.check()

    def test_packaging_allowance_cannot_hide_other_build_changes(self):
        self.add_module()
        self.f.put("src/moz.build", 'EXTRA_JS_MODULES += ["foo.mjs", "new.mjs"]\nSOURCES += ["native.cpp"]\n')
        revision = self.f.commit("unreviewed build edit")
        self.f.args.revision = self.f.child["sourceRevision"] = revision
        self.f.git("update-ref", "refs/remotes/origin/astral", revision)
        self.f.save()
        with self.assertRaisesRegex(ValueError, "Unreviewed packaging declaration"):
            self.check()

    def test_packaging_pin_cannot_name_another_source(self):
        self.add_module()
        export.MODULE_ADDITIONS["src/moz.build"]["sourcePath"] = "src/foo.mjs"
        with self.assertRaisesRegex(ValueError, "lacks its receipted module"):
            self.check()

    def test_existing_member_cannot_be_declared_as_added(self):
        self.f.child["replacements"] = [{"archive": export.CORE[1], "member": "foo.mjs",
            "sourcePath": "src/foo.mjs", "sha256": export.data_sha(b"frontend"), "oldSHA256": None}]
        self.f.save()
        with self.assertRaisesRegex(ValueError, "Archive members/order"):
            self.check()

    def test_later_edit_retains_parent_addition_provenance(self):
        self.add_module()
        added_app = self.f.root / "Added.app"
        shutil.copytree(self.f.final_app, added_app)
        added = dict(self.f.child, app=str(added_app))
        added_receipt = self.f.root / "added.json"
        write_json(added_receipt, added)
        self.f.put("src/new.mjs", "updated module")
        revision = self.f.commit("update added module")
        self.f.args.revision = self.f.child["sourceRevision"] = revision
        self.f.git("update-ref", "refs/remotes/origin/astral", revision)
        self.f.zip(self.f.final_app / export.CORE[1], {
            "foo.mjs": b"frontend", "keep": b"same", "new.mjs": b"updated module"})
        self.f.child["files"] = export.inventory(self.f.final_app)
        self.f.child["parentManifest"] = str(added_receipt)
        self.f.child["parentManifestSHA256"] = export.sha256(added_receipt)
        self.f.child["replacements"] = [{"archive": export.CORE[1], "member": "new.mjs",
            "sourcePath": "src/new.mjs", "sha256": export.data_sha(b"updated module"),
            "oldSHA256": export.data_sha(b"new module")}]
        write_json(self.f.candidate, self.f.child)
        self.f.args.candidate_sha256 = export.sha256(self.f.candidate)
        *_, provenance = self.check()
        self.assertEqual(provenance["appendedResourceModules"][0]["sha256"], export.data_sha(b"updated module"))

    def test_squash_equivalent_product_source_is_accepted_and_attributed(self):
        _, _, _, provenance = self.check()
        self.assertNotEqual(self.f.frontend, self.f.target)
        self.assertEqual(provenance["engineRevision"], self.f.base)
        self.assertEqual(provenance["frontendRevision"], self.f.target)
        self.assertEqual(provenance["optionalNativeLibrary"]["sourceRevision"], self.f.frontend)
        self.assertFalse(provenance["engineBuild"]["recompiled"])
        self.assertEqual(len(provenance["resourceReplacements"]), 1)

    def test_wrong_candidate_hash(self):
        self.f.args.candidate_sha256 = "0" * 64
        with self.assertRaisesRegex(ValueError, "receipt hash"):
            self.check()

    def test_wrong_parent_hash(self):
        self.f.child["parentManifestSHA256"] = "0" * 64
        write_json(self.f.candidate, self.f.child)
        self.f.args.candidate_sha256 = export.sha256(self.f.candidate)
        with self.assertRaisesRegex(ValueError, "Parent receipt"):
            self.check()

    def test_changed_candidate_inventory(self):
        (self.f.final_app / export.CORE[0]).write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "Candidate inventory"):
            self.check()

    def test_changed_parent_inventory(self):
        (self.f.app / export.CORE[0]).write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "Parent application"):
            self.check()

    def test_source_changed_after_validation(self):
        self.f.put("src/foo.mjs", "later")
        self.f.args.revision = self.f.commit("later product change")
        self.f.git("update-ref", "refs/remotes/origin/astral", self.f.args.revision)
        with self.assertRaisesRegex(ValueError, "Integrated source differs"):
            self.check()

    def test_unaccounted_toml_is_not_exempt(self):
        self.f.put("src/hidden.toml", "native = true")
        rev = self.f.commit("unaccounted source")
        self.f.args.revision = rev
        self.f.git("update-ref", "refs/remotes/origin/astral", rev)
        self.f.terminal["sourceRevision"] = self.f.child["sourceRevision"] = rev
        self.f.save()
        with self.assertRaisesRegex(ValueError, "Unaccounted product-source"):
            self.check()

    def test_undeclared_archive_change(self):
        self.f.zip(self.f.final_app / export.CORE[1], {"foo.mjs": b"frontend", "keep": b"changed"})
        self.f.child["files"] = export.inventory(self.f.final_app)
        self.f.save()
        with self.assertRaisesRegex(ValueError, "Archive changes"):
            self.check()

    def test_wrong_native_build_input_record(self):
        self.f.state["sources"] = {"wrong": "record"}
        write_json(self.f.build, self.f.state)
        with self.assertRaisesRegex(ValueError, "input records disagree"):
            self.check()

    def test_wrong_optional_native_source(self):
        self.f.terminal["nativeSourceHashes"]["tools/native-theme-runtime/native.m"] = "0" * 64
        self.f.save()
        with self.assertRaisesRegex(ValueError, "Optional native source"):
            self.check()

    def test_changed_optional_native_library(self):
        (self.f.final_app / export.NATIVE_LIBRARY).write_bytes(b"unexpected native")
        self.f.child["files"] = export.inventory(self.f.final_app)
        self.f.save()
        with self.assertRaisesRegex(ValueError, "Optional native library"):
            self.check()

    def test_executable_code_change_is_not_a_signing_exception(self):
        (self.f.final_app / "Contents/MacOS/zen").write_bytes(signed_executable(code=b"EVIL"))
        self.f.child["files"] = export.inventory(self.f.final_app)
        self.f.save()
        with self.assertRaisesRegex(ValueError, "Executable changed"):
            self.check()

    def test_signature_length_change_keeps_payload(self):
        (self.f.final_app / "Contents/MacOS/zen").write_bytes(signed_executable(signature=b"new longer signature"))
        self.f.child["files"] = export.inventory(self.f.final_app)
        self.f.save()
        self.check()

    def test_unrelated_bundle_file_change_is_rejected(self):
        (self.f.final_app / "Contents/unlisted").write_bytes(b"unexpected")
        self.f.child["files"] = export.inventory(self.f.final_app)
        self.f.save()
        with self.assertRaisesRegex(ValueError, "bundle file set"):
            self.check()

    def test_non_identity_plist_change_is_rejected(self):
        path = self.f.final_app / "Contents/Info.plist"
        info = plistlib.loads(path.read_bytes())
        info["CFBundleVersion"] = "99"
        path.write_bytes(plistlib.dumps(info))
        self.f.child["files"] = export.inventory(self.f.final_app)
        self.f.save()
        with self.assertRaisesRegex(ValueError, "identity metadata"):
            self.check()

    def test_reviewed_diagnostic_identity_is_replaced_with_base_identity(self):
        path = self.f.final_app / "Contents/Info.plist"
        info = plistlib.loads(path.read_bytes())
        info.update(CFBundleIdentifier="app.zen-browser.zen.owned-test", CFBundleDisplayName="Owned test",
                    CFBundleGetInfoString="Owned diagnostic derivative of Zen Astral17; not a release")
        path.write_bytes(plistlib.dumps(info))
        self.f.child["files"] = export.inventory(self.f.final_app)
        self.f.save()
        *_, provenance = self.check()
        self.assertEqual(provenance["normalBundleIdentity"], {"CFBundleIdentifier": "app.zen-browser.zen", "CFBundleName": "Zen"})

    def test_real_preflight_does_not_create_output(self):
        self.check()
        self.assertFalse(self.f.args.output.exists())


class ReceiptTests(unittest.TestCase):
    def test_post_write_limit_failure_cannot_leave_success(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "result.json"
            status = {"complete": True}
            commands = SimpleNamespace(check=unittest.mock.Mock(side_effect=[None, ValueError("cap")]))
            with self.assertRaisesRegex(ValueError, "cap"):
                export.finish_receipt(path, status, commands)
            self.assertFalse(json.loads(path.read_text())["complete"])

    def test_successful_final_samples_preserve_success(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "result.json"
            commands = SimpleNamespace(check=unittest.mock.Mock())
            export.finish_receipt(path, {"complete": True}, commands)
            self.assertTrue(json.loads(path.read_text())["complete"])
            self.assertEqual(commands.check.call_count, 2)


if __name__ == "__main__":
    unittest.main()
