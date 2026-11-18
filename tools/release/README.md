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
python3 -B -m unittest discover -s tools/release -p 'test_export_resource.py' -v
```
