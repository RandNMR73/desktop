"""Applied resource patch reconstruction and explicit delivery approval guards."""
from pathlib import Path
import copy
import difflib
import json
import subprocess
import struct
import tempfile
import unittest
from unittest.mock import patch

import export_resource as export
from test_export_resource import Fixture, write_json

SOURCE = "src/browser/components/urlbar/UrlbarProvidersManager-sys-mjs.patch"
APPLICATION = export.APPLIED_PATCHES[SOURCE]["applicationPath"]
SCOPE = export.APPLIED_PATCHES[SOURCE]["archive"]
MEMBER = export.APPLIED_PATCHES[SOURCE]["member"]
UPSTREAM = "".join(f"line{n}();\n" for n in range(24)).encode()
OLD = UPSTREAM.replace(b"line3();", b"old();")
NEW = OLD.replace(b"line19();", b"new();")


def delta(before, after, path=APPLICATION):
    return (f"diff --git a/{path} b/{path}\n" + "".join(difflib.unified_diff(
        before.decode().splitlines(True), after.decode().splitlines(True),
        fromfile="a/" + path, tofile="b/" + path))).encode()


def optimize_fixture(path, preload_first):
    """Small standard-ZIP to Gecko front-directory fixture conversion."""
    data = path.read_bytes()
    end = bytearray(data[-22:])
    size, offset = struct.unpack_from("<II", end, 12)
    directory = bytearray(data[offset:-22])
    prefix = 4 + size + len(end)
    cursor = 0
    while cursor < size:
        name, extra, comment = struct.unpack_from("<3H", directory, cursor + 28)
        local = struct.unpack_from("<I", directory, cursor + 42)[0]
        struct.pack_into("<I", directory, cursor + 42, local + prefix)
        cursor += 46 + name + extra + comment
    struct.pack_into("<I", end, 16, 4)
    # A threshold one byte after the first local header marks just that member.
    preload = prefix + 1 if preload_first else prefix
    path.write_bytes(struct.pack("<I", preload) + directory + end + data[:offset] + end)


class ReconstructionTests(unittest.TestCase):
    def reconstruct(self, **overrides):
        values = dict(parent_bytes=OLD, candidate_bytes=NEW, old_patch=delta(UPSTREAM, OLD),
                      new_patch=delta(UPSTREAM, NEW), application_path=APPLICATION)
        values.update(overrides)
        return export.reconstruct_patch(**values)

    def test_exact_multiple_hunks_and_parent_roundtrip(self):
        proof = self.reconstruct()
        self.assertTrue(proof["oldPatchRoundTrip"])
        self.assertEqual(proof["upstreamModuleSHA256"], export.data_sha(UPSTREAM))
        self.assertEqual(proof["sha256"], export.data_sha(NEW))
        self.assertEqual(len(proof["commands"]), 7)
        self.assertNotIn("/Users/", json.dumps(proof))

    def test_wrong_parent_cannot_reverse(self):
        with self.assertRaisesRegex(ValueError, "reconstruction failed"):
            self.reconstruct(parent_bytes=UPSTREAM)

    def test_declared_output_hash_does_not_replace_byte_reconstruction(self):
        with self.assertRaisesRegex(ValueError, "Reconstructed module differs"):
            self.reconstruct(candidate_bytes=NEW + b"unaccounted();\n")

    def test_omitted_second_hunk_fails_complete_output_comparison(self):
        with self.assertRaisesRegex(ValueError, "Reconstructed module differs"):
            self.reconstruct(new_patch=delta(UPSTREAM, OLD))

    def test_unsafe_file_operations_and_metadata_rejected_before_git(self):
        valid = delta(UPSTREAM, NEW)
        examples = [valid + delta(b"one\n", b"two\n", "another"),
                    valid.replace(b"--- a/", b"old mode 100644\nnew mode 100755\n--- a/"),
                    valid.replace(b"--- a/", b"rename from elsewhere\n--- a/"),
                    valid.replace(b"--- a/" + APPLICATION.encode(), b"--- /dev/null"),
                    valid.replace(APPLICATION.encode(), b"../escape"),
                    valid.replace(APPLICATION.encode(), b"/absolute"),
                    valid.replace(b"--- a/", b"GIT binary patch\n--- a/"),
                    valid.replace(b"--- a/", b"index abc..def 120000\n--- a/")]
        for data in examples:
            with self.subTest(data=data[:100]), patch.object(export.subprocess, "run") as run:
                with self.assertRaises(ValueError):
                    self.reconstruct(new_patch=data)
                run.assert_not_called()

    def test_timeout_is_not_retried(self):
        with patch.object(export.subprocess, "run", side_effect=subprocess.TimeoutExpired("git", 10)) as run:
            with self.assertRaises(subprocess.TimeoutExpired):
                self.reconstruct()
            self.assertEqual(run.call_count, 1)

    def test_warning_or_unexpected_output_is_rejected(self):
        real = subprocess.run
        for unexpected_file in (False, True):
            def invoke(argv, **kwargs):
                result = real(argv, **kwargs)
                if unexpected_file:
                    (Path(kwargs["cwd"]) / "unexpected").write_text("bad")
                else:
                    result.stderr = b"warning"
                return result
            with self.subTest(unexpected_file=unexpected_file), patch.object(export.subprocess, "run", side_effect=invoke):
                with self.assertRaisesRegex(ValueError, "Unexpected reconstruction output|emitted diagnostics"):
                    self.reconstruct()

    def test_roundtrip_guard_rejects_changed_successful_old_apply_output(self):
        real = subprocess.run
        def invoke(argv, **kwargs):
            result = real(argv, **kwargs)
            if argv[-1] == "old.patch" and "--reverse" not in argv and "--check" not in argv:
                (Path(kwargs["cwd"]) / APPLICATION).write_bytes(OLD + b"unexpected();\n")
            return result
        with patch.object(export.subprocess, "run", side_effect=invoke):
            with self.assertRaisesRegex(ValueError, "round-trip"):
                self.reconstruct()


class AppliedPreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.f = f = Fixture(Path(self.temp.name))
        f.put(SOURCE, delta(UPSTREAM, OLD).decode())
        self.parent_revision = f.commit("old integrated engine patch")
        f.terminal["sourceRevision"] = self.parent_revision
        f.zip(f.base_app / SCOPE, {"keep": b"same", MEMBER: OLD})
        f.zip(f.app / SCOPE, {"keep": b"same", MEMBER: OLD})
        f.terminal["files"] = export.inventory(f.app)
        f.terminal["baselineFiles"] = export.inventory(f.base_app)
        engine = json.loads(f.engine.read_text())
        engine["files"][SCOPE] = export.sha256(f.base_app / SCOPE)
        write_json(f.engine, engine)
        f.put(SOURCE, delta(UPSTREAM, NEW).decode())
        self.source_revision = f.commit("new integrated engine patch")
        f.args.revision = self.source_revision
        f.git("update-ref", "refs/remotes/origin/astral", self.source_revision)
        f.zip(f.final_app / SCOPE, {"keep": b"same", MEMBER: NEW})
        self.proof = f.root / "proof.json"
        self.review = f.root / "review.json"
        self.acceptance = f.root / "runtime-acceptance.json"
        self.delivery = f.root / "delivery.json"
        write_json(self.proof, {
            "baseRevision": self.parent_revision, "productPatchPath": SOURCE,
            "productPatchSHA256": export.data_sha(delta(UPSTREAM, NEW)),
            "baselineNativeModuleSHA256": export.data_sha(OLD), "candidateNativeModuleSHA256": export.data_sha(NEW),
            "nativeArchive": SCOPE, "nativeMember": MEMBER, "inputsUnchanged": True,
            "testClassExactlyMatchesAppliedRuntime": True})
        f.child.update(schemaVersion=3, kind="owned-applied-patch-derivative", exportEligible=False,
                       sourceRevision=self.source_revision, sourceBaseRevision=self.parent_revision,
                       files=export.inventory(f.final_app), replacements=[{
                           "archive": SCOPE, "member": MEMBER, "sourcePath": SOURCE,
                           "sourceKind": "applied-engine-patch", "sourcePatchSHA256": export.data_sha(delta(UPSTREAM, NEW)),
                           "sha256": export.data_sha(NEW), "oldSHA256": export.data_sha(OLD),
                           "applicationProofSHA256": export.sha256(self.proof)}])
        f.save()
        self.save_acceptance()

    def save_acceptance(self):
        f = self.f
        write_json(self.review, {"passed": True, "sourceRevision": self.source_revision,
            "inputPins": {str(f.candidate): f.args.candidate_sha256, str(self.proof): export.sha256(self.proof)}})
        write_json(self.acceptance, {"sourceRevision": self.source_revision,
            "sourceTree": f.git("rev-parse", self.source_revision + "^{tree}"),
            "pins": {self.review.name: export.sha256(self.review), self.proof.name: export.sha256(self.proof)}})
        self.entry = {"manifestSHA256": f.args.candidate_sha256, "sourceRevision": self.source_revision,
                      **{key: {"path": str(path), "sha256": export.sha256(path)} for key, path in (
                          ("runtimeAcceptance", self.acceptance), ("runtimeReview", self.review), ("applicationProof", self.proof))}}
        self.approval = {"schemaVersion": 1, "kind": "accepted-applied-patch-delivery", "approvedForResourceExport": True,
                        "candidateManifestSHA256": f.args.candidate_sha256, "sourceRevision": f.child["sourceRevision"],
                        "integrationRevision": f.args.revision, "appliedPatches": [self.entry]}
        self.save_delivery()

    def save_delivery(self):
        write_json(self.delivery, self.approval)
        self.f.args.accepted_delivery = self.delivery
        self.f.args.accepted_delivery_sha256 = export.sha256(self.delivery)

    def check(self):
        real = subprocess.run
        def run(argv, **kwargs):
            if Path(argv[0]).name == "codesign":
                return subprocess.CompletedProcess(argv, 0)
            return real(argv, **kwargs)
        with patch.object(export.subprocess, "run", side_effect=run):
            return export.preflight(self.f.args)

    def change_manifest(self):
        self.f.save()
        self.save_acceptance()

    def test_accepted_diagnostic_reconstructs_without_rewriting_receipts(self):
        before = {p: p.read_bytes() for p in (self.f.candidate, self.f.parent, self.proof, self.review, self.acceptance, self.delivery)}
        _, candidate, pins, provenance = self.check()
        self.assertFalse(candidate["exportEligible"])
        self.assertFalse(provenance["engineBuild"]["recompiled"])
        self.assertEqual(provenance["acceptedDeliverySHA256"], export.sha256(self.delivery))
        edge = provenance["appliedPatchEdges"][0]
        self.assertEqual(edge["oldModuleSHA256"], export.data_sha(OLD))
        self.assertEqual(edge["sha256"], export.data_sha(NEW))
        self.assertEqual(edge["sourcePatchSHA256"], export.data_sha(delta(UPSTREAM, NEW)))
        self.assertIn(str(self.proof), pins)
        self.assertEqual(before, {p: p.read_bytes() for p in before})
        self.assertFalse(self.f.args.output.exists())

    def test_diagnostic_false_cannot_be_ignored_without_explicit_acceptance(self):
        self.f.args.accepted_delivery = self.f.args.accepted_delivery_sha256 = None
        with self.assertRaisesRegex(ValueError, "explicit accepted-delivery"):
            self.check()

    def test_mutating_original_eligibility_is_not_an_approval(self):
        self.f.child["exportEligible"] = True
        self.change_manifest()
        with self.assertRaisesRegex(ValueError, "original ineligibility"):
            self.check()

    def test_acceptance_is_bound_to_candidate_source_and_integration(self):
        for key in ("candidateManifestSHA256", "sourceRevision", "integrationRevision"):
            original = self.approval[key]
            self.approval[key] = "0" * len(original)
            self.save_delivery()
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "identity differs"):
                self.check()
            self.approval[key] = original

    def test_not_approved_and_unmatched_extra_entry_are_rejected(self):
        self.approval["approvedForResourceExport"] = False
        self.save_delivery()
        with self.assertRaisesRegex(ValueError, "not explicitly approved"):
            self.check()
        self.approval["approvedForResourceExport"] = True
        self.approval["appliedPatches"].append(dict(self.entry, manifestSHA256="0" * 64))
        self.save_delivery()
        with self.assertRaisesRegex(ValueError, "Unused applied-patch"):
            self.check()

    def test_wrong_acceptance_hash_and_duplicate_entries_are_rejected(self):
        self.f.args.accepted_delivery_sha256 = "0" * 64
        with self.assertRaisesRegex(ValueError, "receipt hash mismatch"):
            self.check()
        self.approval["appliedPatches"].append(dict(self.entry))
        self.save_delivery()
        with self.assertRaisesRegex(ValueError, "Duplicate/invalid"):
            self.check()

    def test_applied_mapping_cannot_fall_back_to_literal_interpretation(self):
        self.f.child["replacements"][0].pop("sourceKind")
        self.change_manifest()
        with self.assertRaisesRegex(ValueError, "Unsupported replacement source kind"):
            self.check()

    def test_changed_application_proof_fails_before_reconstruction(self):
        proof = json.loads(self.proof.read_text())
        proof["candidateNativeModuleSHA256"] = "0" * 64
        write_json(self.proof, proof)
        self.save_acceptance()
        with self.assertRaisesRegex(ValueError, "Application proof differs"):
            self.check()

    def test_runtime_review_must_be_successful_and_bind_exact_manifest(self):
        for field in ("passed", "inputPins"):
            model = json.loads(self.review.read_text())
            model[field] = False if field == "passed" else {}
            write_json(self.review, model)
            self.entry["runtimeReview"]["sha256"] = export.sha256(self.review)
            acceptance = json.loads(self.acceptance.read_text())
            acceptance["pins"][self.review.name] = export.sha256(self.review)
            write_json(self.acceptance, acceptance)
            self.entry["runtimeAcceptance"]["sha256"] = export.sha256(self.acceptance)
            self.save_delivery()
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "Runtime evidence|Runtime review"):
                self.check()
            self.save_acceptance()

    def test_old_module_and_unrelated_member_changes_cannot_hide_in_hashes(self):
        for field, value in (("oldSHA256", "0" * 64), ("sourcePath", "src/other.patch")):
            old = self.f.child["replacements"][0][field]
            self.f.child["replacements"][0][field] = value
            self.change_manifest()
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.check()
            self.f.child["replacements"][0][field] = old
        self.f.zip(self.f.final_app / SCOPE, {"keep": b"changed", MEMBER: NEW})
        self.f.child["files"] = export.inventory(self.f.final_app)
        self.change_manifest()
        with self.assertRaisesRegex(ValueError, "undeclared archive"):
            self.check()

    def test_new_compression_or_order_is_rejected(self):
        import zipfile
        for reordered in (False, True):
            with zipfile.ZipFile(self.f.final_app / SCOPE, "w", compression=zipfile.ZIP_DEFLATED if not reordered else zipfile.ZIP_STORED) as z:
                entries = [(MEMBER, NEW), ("keep", b"same")] if reordered else [("keep", b"same"), (MEMBER, NEW)]
                for name, data in entries:
                    z.writestr(name, data)
            self.f.child["files"] = export.inventory(self.f.final_app)
            self.change_manifest()
            with self.subTest(reordered=reordered), self.assertRaisesRegex(ValueError, "metadata/compression|order/set"):
                self.check()

    def test_actual_optimized_preload_membership_change_is_rejected(self):
        optimize_fixture(self.f.app / SCOPE, True)
        optimize_fixture(self.f.final_app / SCOPE, False)
        self.f.terminal["files"] = export.inventory(self.f.app)
        self.f.child["files"] = export.inventory(self.f.final_app)
        self.change_manifest()
        with export.archive(self.f.app / SCOPE) as z:
            self.assertTrue(z.astral_optimized)
            self.assertEqual(z.astral_preloaded, {"keep"})
        with self.assertRaisesRegex(ValueError, "preload/layout"):
            self.check()

    def test_exact_optimized_layout_and_preload_are_accepted(self):
        for app in (self.f.base_app, self.f.app, self.f.final_app):
            optimize_fixture(app / SCOPE, True)
        engine = json.loads(self.f.engine.read_text())
        engine["files"][SCOPE] = export.sha256(self.f.base_app / SCOPE)
        write_json(self.f.engine, engine)
        self.f.terminal["baselineFiles"] = export.inventory(self.f.base_app)
        self.f.terminal["files"] = export.inventory(self.f.app)
        self.f.child["files"] = export.inventory(self.f.final_app)
        self.change_manifest()
        self.check()

    def test_parent_patch_must_equal_declared_source_base(self):
        self.f.child["sourceBaseRevision"] = self.source_revision
        proof = json.loads(self.proof.read_text())
        proof["baseRevision"] = self.source_revision
        write_json(self.proof, proof)
        self.f.child["replacements"][0]["applicationProofSHA256"] = export.sha256(self.proof)
        self.change_manifest()
        with self.assertRaisesRegex(ValueError, "base patch differs"):
            self.check()

    def test_intermediate_applied_edge_is_not_hidden_by_latest_mapping(self):
        # Add a later ordinary identity-only derivative. The invalid older
        # applied edge must still be inspected before aggregate source matching.
        old_receipt = self.f.root / "intermediate.json"
        bad = copy.deepcopy(self.f.child)
        bad["replacements"][0]["sourcePatchSHA256"] = "0" * 64
        write_json(old_receipt, bad)
        old_digest = export.sha256(old_receipt)
        self.f.child = {**self.f.child, "kind": "owned-resource-derivative", "replacements": [],
                        "parentManifest": str(old_receipt), "parentManifestSHA256": old_digest}
        del self.f.child["exportEligible"]
        write_json(self.f.candidate, self.f.child)
        self.f.args.candidate_sha256 = export.sha256(self.f.candidate)
        self.save_acceptance()
        self.entry["manifestSHA256"] = old_digest
        review = json.loads(self.review.read_text())
        review["inputPins"][str(old_receipt)] = old_digest
        write_json(self.review, review)
        self.entry["runtimeReview"]["sha256"] = export.sha256(self.review)
        acceptance = json.loads(self.acceptance.read_text())
        acceptance["pins"][self.review.name] = export.sha256(self.review)
        write_json(self.acceptance, acceptance)
        self.entry["runtimeAcceptance"]["sha256"] = export.sha256(self.acceptance)
        self.save_delivery()
        with self.assertRaisesRegex(ValueError, "Application proof differs"):
            self.check()

    def test_valid_latest_applied_mapping_does_not_hide_older_bad_edge(self):
        import shutil
        f = self.f
        previous_app = f.root / "Previous.app"
        shutil.copytree(f.final_app, previous_app)
        previous_receipt = f.root / "previous.json"
        previous = dict(f.child, app=str(previous_app))
        previous["replacements"] = copy.deepcopy(previous["replacements"])
        previous["replacements"][0]["sourcePatchSHA256"] = "0" * 64
        write_json(previous_receipt, previous)
        previous_hash = export.sha256(previous_receipt)
        review = json.loads(self.review.read_text())
        review["inputPins"][str(previous_receipt)] = previous_hash
        write_json(self.review, review)
        acceptance = json.loads(self.acceptance.read_text())
        acceptance["pins"][self.review.name] = export.sha256(self.review)
        write_json(self.acceptance, acceptance)
        previous_entry = copy.deepcopy(self.entry)
        previous_entry["manifestSHA256"] = previous_hash
        previous_entry["runtimeReview"]["sha256"] = export.sha256(self.review)
        previous_entry["runtimeAcceptance"]["sha256"] = export.sha256(self.acceptance)
        self.proof, self.review, self.acceptance = (f.root / n for n in ("next-proof.json", "next-review.json", "next-acceptance.json"))
        newest = NEW.replace(b"line12();", b"newest();")
        f.put(SOURCE, delta(UPSTREAM, newest).decode())
        self.source_revision = f.commit("latest valid applied patch")
        f.args.revision = self.source_revision
        f.git("update-ref", "refs/remotes/origin/astral", self.source_revision)
        f.zip(f.final_app / SCOPE, {"keep": b"same", MEMBER: newest})
        write_json(self.proof, {
            "baseRevision": previous["sourceRevision"], "productPatchPath": SOURCE,
            "productPatchSHA256": export.data_sha(delta(UPSTREAM, newest)),
            "baselineNativeModuleSHA256": export.data_sha(NEW), "candidateNativeModuleSHA256": export.data_sha(newest),
            "nativeArchive": SCOPE, "nativeMember": MEMBER, "inputsUnchanged": True,
            "testClassExactlyMatchesAppliedRuntime": True})
        f.child.update(sourceRevision=self.source_revision, sourceBaseRevision=previous["sourceRevision"],
                       parentManifest=str(previous_receipt), parentManifestSHA256=previous_hash,
                       files=export.inventory(f.final_app))
        f.child["replacements"][0].update(sourcePatchSHA256=export.data_sha(delta(UPSTREAM, newest)),
                    sha256=export.data_sha(newest), oldSHA256=export.data_sha(NEW), applicationProofSHA256=export.sha256(self.proof))
        write_json(f.candidate, f.child)
        f.args.candidate_sha256 = export.sha256(f.candidate)
        self.save_acceptance()
        self.approval["appliedPatches"].append(previous_entry)
        self.save_delivery()
        with patch.object(export, "reconstruct_patch", wraps=export.reconstruct_patch) as reconstruct:
            with self.assertRaisesRegex(ValueError, "Application proof differs"):
                self.check()
            self.assertEqual(reconstruct.call_count, 1)  # Latest was fully verified first.


if __name__ == "__main__":
    unittest.main()
