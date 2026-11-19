"""Exercise the installed-release receipt boundary with tiny synthetic apps."""
from pathlib import Path
import copy
import tempfile
import unittest
import zipfile

import export_resource as export
import test_export_resource as fixtures

Fixture, write_json = fixtures.Fixture, fixtures.write_json


class ReleaseCloneTests(unittest.TestCase):
    check = fixtures.PreflightTests.check

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.f = Fixture(Path(self.temp.name))
        f = self.f
        icons = "Contents/MacOS/libzen-app-icons.dylib"
        for app in (f.base_app, f.app, f.final_app):
            (app / icons).write_bytes(b"icons")
        f.terminal["baselineFiles"] = export.inventory(f.base_app)
        f.terminal["files"] = export.inventory(f.app)
        f.child["files"] = export.inventory(f.final_app)
        f.save()
        *_, self.previous = self.check()
        self.release_revision = f.target
        self.previous.update(files={name: f.terminal["files"][name] for name in export.CORE},
                             signatureVerified=True, mountedImageVerified=True,
                             overlayCompatibility={"nativeHelpers": {icons.split("/")[-1]: export.data_sha(b"icons")}})
        self.previous_path = f.root / "release-provenance.json"
        self.result_path = f.root / "clone-result.json"
        self.before_path, self.after_path = f.root / "source-before.json", f.root / "source-after.json"
        self.baseline = dict(f.terminal["files"], **{"Contents/Resources/astral-update.json": export.data_sha(b"{}")})
        snapshot = {"files": self.baseline, "metadata": {"fixture": {"mode": 420}}}
        write_json(self.before_path, snapshot)
        write_json(self.after_path, snapshot)
        f.terminal = {
            "status": "assembled", "app": str(f.app), "sourceRevision": self.release_revision,
            "files": export.inventory(f.app), "signatureVerified": True, "updaterConfigAbsent": True,
            "entitlementsPreserved": True, "engineNativeLibraryThemeAssetsUnchanged": True,
            "launcherNonSignatureBytesUnchanged": True, "installedAppBytesUnchanged": True,
            "installedAppMetadataUnchanged": True, "changedBundlePaths": [], "addedBundlePaths": [],
            "removedBundlePaths": ["Contents/Resources/astral-update.json"],
            "engineMetadata": {"uuid": "fixture", "xulSHA256": self.previous["files"][export.CORE[0]]},
            "sourceBefore": {"path": str(self.before_path), "sha256": export.sha256(self.before_path)},
            "sourceAfter": {"path": str(self.after_path), "sha256": export.sha256(self.after_path)},
        }
        f.put("src/foo.mjs", "pooled")
        f.target = f.commit("new resource improvement")
        f.git("update-ref", "refs/remotes/origin/astral", f.target)
        f.args.revision = f.child["sourceRevision"] = f.target
        f.zip(f.final_app / export.CORE[1], {"foo.mjs": b"pooled", "keep": b"same"})
        f.child["files"] = export.inventory(f.final_app)
        f.child["replacements"] = [{"archive": export.CORE[1], "member": "foo.mjs", "sourcePath": "src/foo.mjs",
                                    "oldSHA256": export.data_sha(b"frontend"), "sha256": export.data_sha(b"pooled")}]
        f.args.release_base_provenance = self.previous_path
        f.args.release_base_clone_result = self.result_path
        self.save()

    def save(self):
        f = self.f
        f.save()
        self.result = {
            "status": "complete", "passed": True, "exitCode": 0, "ownedProcessGroupGone": True,
            "inputPinsUnchanged": True, "guardFailures": [],
            "manifest": {"path": str(f.parent), "sha256": export.sha256(f.parent)},
            **{key: f.terminal[key] for key in ("app", "files", "sourceRevision", "engineMetadata")},
        }
        write_json(self.previous_path, self.previous)
        write_json(self.result_path, self.result)
        f.args.release_base_provenance_sha256 = export.sha256(self.previous_path)
        f.args.release_base_clone_result_sha256 = export.sha256(self.result_path)

    def test_true_clone_parent_and_component_history_are_retained(self):
        _, _, pins, provenance = self.check()
        self.assertEqual(len(provenance["parentReceipts"]), 2)
        self.assertEqual(provenance["parentReceipts"][-1]["manifestSHA256"], export.sha256(self.f.parent))
        self.assertEqual(provenance["resourceBaseRelease"]["revision"], self.release_revision)
        self.assertEqual(provenance["engineRevision"], self.f.base)
        self.assertEqual(provenance["optionalNativeLibrary"], self.previous["optionalNativeLibrary"])
        self.assertEqual(provenance["resourceReplacements"][0]["sha256"], export.data_sha(b"pooled"))
        self.assertEqual(pins[str(self.result_path)], export.sha256(self.result_path))
        self.assertEqual(pins[str(self.before_path)], export.sha256(self.before_path))
        self.assertNotIn("kind", export.load(self.f.parent))

    def test_unpinned_release_base_is_rejected(self):
        self.f.args.release_base_provenance_sha256 = None
        with self.assertRaisesRegex(ValueError, "Missing release-base pin"):
            self.check()

    def test_wrong_prior_engine_build_is_rejected(self):
        self.previous["engineBuild"]["stateSHA256"] = "0" * 64
        self.save()
        with self.assertRaisesRegex(ValueError, "engine build differs"):
            self.check()

    def test_release_archive_mismatch_is_rejected(self):
        self.previous["files"][export.CORE[1]] = "0" * 64
        self.save()
        with self.assertRaisesRegex(ValueError, "engine/archive bytes differ"):
            self.check()

    def test_failed_or_unbound_clone_result_is_rejected(self):
        original = copy.deepcopy(self.result)
        for key, value in (("passed", False), ("ownedProcessGroupGone", False),
                           ("inputPinsUnchanged", False), ("guardFailures", ["limit"]),
                           ("manifest", {"path": str(self.f.parent), "sha256": "0" * 64})):
            with self.subTest(key=key):
                write_json(self.result_path, dict(original, **{key: value}))
                self.f.args.release_base_clone_result_sha256 = export.sha256(self.result_path)
                with self.assertRaisesRegex(ValueError, "completed, unchanged assembly"):
                    self.check()

    def test_different_source_after_snapshot_is_rejected(self):
        after = export.load(self.after_path)
        after["metadata"]["fixture"]["mode"] = 384
        write_json(self.after_path, after)
        self.f.terminal["sourceAfter"]["sha256"] = export.sha256(self.after_path)
        self.save()
        with self.assertRaisesRegex(ValueError, "changed during cloning"):
            self.check()

    def test_clone_cannot_hide_native_change(self):
        self.baseline[export.NATIVE_LIBRARY] = "0" * 64
        for path in (self.before_path, self.after_path):
            value = export.load(path)
            value["files"] = self.baseline
            write_json(path, value)
        self.f.terminal["sourceBefore"]["sha256"] = export.sha256(self.before_path)
        self.f.terminal["sourceAfter"]["sha256"] = export.sha256(self.after_path)
        self.f.terminal["changedBundlePaths"] = [export.NATIVE_LIBRARY]
        self.save()
        with self.assertRaisesRegex(ValueError, "more than isolation"):
            self.check()

    def test_new_undeclared_archive_change_is_rejected(self):
        self.f.zip(self.f.final_app / export.CORE[1], {"foo.mjs": b"pooled", "keep": b"hidden change"})
        self.f.child["files"] = export.inventory(self.f.final_app)
        self.save()
        with self.assertRaisesRegex(ValueError, "Archive changes do not match"):
            self.check()

    def test_same_member_bytes_with_changed_compression_are_rejected(self):
        with zipfile.ZipFile(self.f.final_app / export.CORE[1], "w", compression=zipfile.ZIP_DEFLATED) as z:
            for name, data in (("foo.mjs", b"pooled"), ("keep", b"same")):
                info = zipfile.ZipInfo(name, (2020, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, data)
        self.f.child["files"] = export.inventory(self.f.final_app)
        self.save()
        with self.assertRaisesRegex(ValueError, "archive metadata/compression"):
            self.check()

    def test_new_unaccounted_source_change_is_rejected(self):
        self.f.put("src/native.cpp", "unbuilt engine change")
        target = self.f.commit("unbuilt")
        self.f.args.revision = self.f.child["sourceRevision"] = target
        self.f.git("update-ref", "refs/remotes/origin/astral", target)
        self.save()
        with self.assertRaisesRegex(ValueError, "Unaccounted product-source"):
            self.check()


if __name__ == "__main__":
    unittest.main()
