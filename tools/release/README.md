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
