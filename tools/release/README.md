# Export a validated local macOS assembly

`export_local.py` creates an unpublished arm64 disk image from an already
validated native candidate. This is the local packaging path when the hosted
build service is unavailable. It neither compiles an engine nor installs or
publishes an application.

```sh
python3 tools/release/export_local.py \
  --source /absolute/path/to/desktop \
  --candidate /absolute/path/to/native-candidate.json \
  --build-state /absolute/path/to/build-state.json \
  --build-inputs /absolute/path/to/build-inputs.json \
  --revision FULL_INTEGRATED_COMMIT \
  --output /absolute/path/to/new-export-directory
```

The input records come from the native candidate's build and validation run.
The exporter requires a successful completed build, matching input fingerprints,
matching build identity, component ancestry, unchanged release code, the recorded
candidate file hashes, and a valid application signature. A failed preflight
does not create the output directory. The output directory must not already
exist; preserve a failed export for diagnosis before choosing another directory.

The exported app omits local updater enrollment, archive-backup records, native
theme resources containing Space identities, and icon-build metadata. The
installed Astralforge updater restores the enrolled machine's theme, icons,
policies and update configuration during preparation. Use this image through
that updater; copying the bare app does not restore those local resources.

`astral-build.json` records separate release, frontend, native and Gecko base
revisions. The legacy `platform.ini` source stamp is retained because the local
archive-patch catalog uses it to identify its resource baseline. It must not be
presented as the revision of all assembled components. Both resource archives
and the engine are byte-for-byte unchanged in the image. The exporter verifies
the compressed image, mounts it read-only, rechecks those hashes and the strict
signature, then writes its SHA-256 sidecar and public provenance record.

During subsequent preparation, macOS deep signing can replace the engine's
linker signature and resize `__LINKEDIT`. Whole-file engine hashes can therefore
change without a code change. Validation must check the signature and compare
all non-signature bytes, allowing only the signature payload, its length and
the `__LINKEDIT` file/VM lengths to differ. Archive hashes must still match
exactly.

Before publication, exercise the disk image with the installed banner helper
using isolated state and an owned app, including download verification, theme
and icon restoration, final signing and repeated preparation. Publish only a
revision integrated into `astral`, attach the image, checksum, `platform.ini`
and `build-provenance.json`, and describe it as a validated local assembly.
Hosted CI rejection is not a passing build. Keep unfinished renderer or
performance experiments out of the release. A local preparation test also does
not prove a published release's discovery, restart, cancellation or rollback.

The published Astral4 image has also passed real GitHub discovery, download and
preparation through the enrolled helper. Separate checks cover cancellation and
the banner's collapsed, hover and keyboard-focus states in five Spaces with both
pinned and floating sidebars. These checks used owned fixtures; the normal-profile
restart and rollback remain unverified. The original local record describes the
earlier unpublished test, while the follow-up records the subsequent delivery.

See [the local validation record](validation-2026-11-07.json),
[the published delivery record](published-validation-2026-11-07.json), and
[the fork maintenance policy](../../ASTRAL.md#workflows).

## Export validated resource changes on an existing engine

`export_resource.py` is a separate, explicit path for a reviewed resource
derivative. The strict native-build exporter above is unchanged. This command
does not compile, install, enroll, restart or publish an app.

```sh
python3 -B tools/release/export_resource.py \
  --source /absolute/path/to/desktop \
  --candidate /absolute/path/to/final-derivative-manifest.json \
  --candidate-sha256 REVIEWED_MANIFEST_SHA256 \
  --engine-candidate /absolute/path/to/original-engine-candidate.json \
  --build-state /absolute/path/to/original-build-state.json \
  --build-inputs /absolute/path/to/original-build-inputs.json \
  --revision FULL_INTEGRATED_COMMIT \
  --output /absolute/path/to/new-export-directory
```

Add `--preflight-only` to validate without creating the output directory. The
release revision must be integrated into `origin/astral` (or an explicitly
selected `--integration-ref`). A squashed candidate commit is accepted only if
the complete `src`, `configs`, `surfer.json` and `tools/native-theme-runtime`
trees equal the integrated revision. This is source equality, not an ancestry
claim about the candidate branch.

Preflight follows the pinned parent manifests to the original diagnostic
derivative. It checks all recorded app files, exact source bytes for each
changed archive member, archive member order, the original successful engine
build, and unchanged engine bytes. Unaccounted source or resource changes fail.
The four specifically reviewed training/test-only changes have exact path and
SHA-256 pins in `NON_PACKAGED`; extensions such as `.py` and `.toml` are never
blanket exemptions. These source changes are explicitly recorded as **not
applied to the reused engine**. Future changes require their own review and pins.

A new JavaScript resource module may be appended only when a parent receipt
explicitly records its absent previous hash. Existing archive members must keep
their order, and all added bytes must match the integrated source. A matching
`MODULE_ADDITIONS` entry pins the exact before/after `moz.build` bytes and the
resource-to-source mapping. This permits the reviewed declaration, including
later source-validated edits to that module, without exempting other build
changes. Public provenance lists the appended modules and applied packaging
declarations separately from unapplied training/test changes.

`nativeBaseRevision` and `engineRevision` identify the reused Astral17 engine.
`optionalNativeLibrary` separately identifies the later Downloads helper and
its exact source hashes and assembly receipt. The exporter removes that local
library and the enrolled theme configuration from the public app. The enrolled
runtime must restore the recorded helper hash, along with the machine's theme,
icons, policies and update enrollment. A bare copy of the image is insufficient.

The owned clone restores the normal `app.zen-browser.zen` identity and Zen name.
Only ad-hoc signature payload and its three size bookkeeping fields may differ
in the main executable; its signature offset and all other executable bytes
must match the engine candidate. The exporter signs the outer bundle, verifies
the image read-only, and checks the entire mounted file inventory. It retains
the legacy resource stamp and records release/frontend, engine build and optional
helper provenance separately in `astral-build.json` and `build-provenance.json`.
Neither metadata record claims a fresh engine build, fresh PGO training or a
performance improvement.

The output must be new and outside the input apps and source checkout. Packaging
commands operate on owned outputs, are monitored every 250 ms, stop their own
process group after 300 seconds or a resource-limit breach, and retain logs on
failure. The limit is 2 GiB of counted output allocation with more than 2 GiB
filesystem space remaining. Allocation counts can include shared APFS blocks
and a mounted image; they are conservative, not a physical-storage measurement.
These limits are sampled, not an OS quota. A failed final sample cannot leave a
successful `export-result.json`. Input hashes are rechecked after packaging.

Before publication, run the real updater CLI against the exported image using
owned app/state/cache fixtures. Check the restored helper hash, exact archive
hashes, engine bytes apart from signing, preserved selected icon, enrollment,
repeat preparation and unchanged source app. Then publish only the reviewed
integrated revision and the image, checksum, `platform.ini` and public provenance.
Local staging and public release are separate actions; this exporter does neither.

Focused receipt and source guards (no browser or signing):

```sh
python3 -B -m unittest discover -s tools/release -p 'test_export*.py' -v
```

## Apply a reviewed engine-source patch to a resource module

The allowlist `APPLIED_PATCHES` currently permits only the native
`UrlbarProvidersManager-sys-mjs.patch` mapping to its root-archive JavaScript
module. This changes a resource, not the compiled engine. Literal source/module
equality remains mandatory for all existing direct-source mappings.

An `owned-applied-patch-derivative` diagnostic manifest stays immutable with
`exportEligible: false`. To export it, pass both `--accepted-delivery FILE` and
`--accepted-delivery-sha256 REVIEWED_SHA256`. The separate receipt has this shape:

```json
{
  "schemaVersion": 1,
  "kind": "accepted-applied-patch-delivery",
  "approvedForResourceExport": true,
  "candidateManifestSHA256": "FINAL_DIAGNOSTIC_MANIFEST_SHA256",
  "sourceRevision": "FINAL_DIAGNOSTIC_SOURCE_REVISION",
  "integrationRevision": "EXACT_EXPORT_REVISION",
  "appliedPatches": [{
    "manifestSHA256": "APPLIED_EDGE_MANIFEST_SHA256",
    "sourceRevision": "APPLIED_EDGE_SOURCE_REVISION",
    "runtimeAcceptance": {"path": "/absolute/runtime-acceptance.json", "sha256": "SHA256"},
    "runtimeReview": {"path": "/absolute/runtime-independent-review.json", "sha256": "SHA256"},
    "applicationProof": {"path": "/absolute/runtime-application-proof.json", "sha256": "SHA256"}
  }]
}
```

`approvedForResourceExport` is the explicit release authorization, supplied and
hash-pinned by the reviewer after runtime and exporter review. The runtime
acceptance is an immutable evidence document; the exporter does not interpret
its prose as permission. It checks the acceptance's source/tree and evidence
pins, the successful independent runtime review's source and candidate/proof
pins, and the application proof's exact old/new source/module mapping. Each
applied edge requires its own accepted entry; missing, duplicate and unused
entries fail. A later valid replacement cannot hide an invalid earlier edge.

For each applied edge, preflight authenticates its immediate parent and reads
the old/new patches from pinned Git revisions. In new private scratch it
reverses the old patch, verifies an exact old-patch round trip, then applies the
new patch and compares the complete result with the candidate archive member.
The original patch must also equal that of the declared source base. Only a
single regular textual modification to the allowlisted path is accepted;
multiple files, path escapes, file operations, mode changes, binary patches and
unsupported metadata fail before Git runs. No three-way or whitespace repair
is used. Git receives no inherited repository/configuration environment.
Each command has a 10-second timeout; inputs are at most 256 KiB each and the
private scratch has a checked 2 MiB bound. Scratch is removed on completion or
failure; failures raise with diagnostics, while successful command transcripts
and exact old/upstream/new hashes are recorded in public provenance without
local paths.

Both resource archives must preserve their complete member order, compression,
metadata and preload membership across each applied edge. Every changed member
must be declared, and all other member bytes must match the immediate parent.
The existing full-chain, integrated-source, engine, native helper, signature,
bundle and packaging guards still apply. Preflight creates no output app or
package; this acceptance path does not publish or install anything.

## Data-only compatibility for the enrolled updater

Revisions containing `overlay-compatibility-baseline.json` automatically emit
`overlayCompatibility` in their existing build provenance and packaged
`astral-build.json`. The baseline records the reviewed integrated Astralforge
patch-prefix digests and complete member coverage for both archives; its
catalog source revision and hashes retain provenance. Preflight requires that
baseline revision to precede the export revision and its engine/source stamp
to match. It computes new member hashes from the already source-validated app,
including explicit absent members, and binds whole-archive and native-helper
hashes. No archive is rewritten to add this metadata.

This is a no-op recognition contract for a separately reviewed updater reader,
not executable updater code or a remote patch. The reader must bind the
checksum-verified image to the tag-resolved repository/source revision, verify
actual core hashes and unchanged engine provenance, validate the local overlay
prefix/member set, and require compatible local theme/icon helpers before
restoration and signing. A new contract never bypasses failed hash validation.

Older source revisions without the committed baseline keep their previous
export format. Existing runtimes require one reader/enrollment bootstrap;
afterward compatible resource-only releases can use the normal banner without
per-release catalog copying. Changes to the baseline itself require source
review. New engine/native-library requirements remain a separate compatibility
decision, and this metadata makes no performance claim.

For these packages `sourceEquivalence.integrationRevision` is the exact export
revision; `integrationRefRevision` separately records the ref head that proved
its integration. The consumer binds the former to the resolved release tag.
