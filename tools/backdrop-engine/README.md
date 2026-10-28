# Cross-slice backdrop-filter backport

**Draft; Wrench software tests passed; uninstalled.** These patches prepare Mozilla's cross-slice
backdrop implementation for Zen's pinned Firefox 158.0.1 engine. They do not
establish Arc parity or a speed advantage. Do not merge or distribute a browser
containing them until the build and rendering checks below pass.

The command bar currently cannot blur remote page content across its separate
WebRender tile-cache slice. This is the engine limitation tracked in
[Mozilla bug 1799334](https://bugzilla.mozilla.org/show_bug.cgi?id=1799334).
Changing the panel's CSS color or removing every iframe slice boundary does
not supply the required rendering behavior; the latter also sacrifices scrolling
isolation.

This candidate combines the five prerequisite commits from
[bug 2079474](https://bugzilla.mozilla.org/show_bug.cgi?id=2079474), the hidden
picture fix from [bug 2084357](https://bugzilla.mozilla.org/show_bug.cgi?id=2084357),
and the four latest relanded commits from
[bug 2079476](https://bugzilla.mozilla.org/show_bug.cgi?id=2079476). The exact
commit IDs and original patch hashes are recorded in `manifest.json`. The reland
includes the occluded-slice correction following
[bug 2085788](https://bugzilla.mozilla.org/show_bug.cgi?id=2085788).

The non-atomic slice placement prerequisite from
[bug 2078970](https://bugzilla.mozilla.org/show_bug.cgi?id=2078970) is also
required. Its explicit-argument form from
[bug 2079473](https://bugzilla.mozilla.org/show_bug.cgi?id=2079473) is adapted
without the unrelated prepare-state cleanup. Both original commit and patch
hashes are recorded under `additional_upstream_adaptations` in the manifest.

The new path draws the needed primitives into backdrop captures, tracks which
lower slices contribute, and invalidates a capture when its sampled content
changes. It keeps the slice boundaries and avoids promoting sampled content
to separate compositor surfaces, where the backdrop could not read it.
Compositor rounded clips are applied to the captured source.

## Adaptations for Firefox 158

- Keep the older primitive-list parameters and `instance_to_draw` scratch
  layout; add capture storage without importing unrelated newer draw storage.
- Keep the backdrop chain's unresolved rendering node until `finalize_picture`,
  but use the element's known placement node to choose its non-atomic tile
  slice. The first Wrench run exposed an assertion failure when these two
  coordinate roles were conflated. Ordinary primitives use the same node for
  both roles. The placement assertion and separate scrolling slices remain.
- Remove the old resolve helpers that exist in 158, including their read-target
  reset and obsolete `ReadTarget` import. The new implementation removes the
  resolve operation itself.
- Insert tile-cache fields next to 158's existing fields; no unrelated YUV
  stability changes are included.
- Register all new tests at the available 158 test entry points. Tests absent
  from the older version are not invented as prerequisites.
- Preserve 158's existing tile-debug map. The two dirty-tile assertions use
  that map; their fixtures do not depend on promoted sub-slices. Overlay-count
  assertions read the existing `RenderResults.compositor_surface_overlays`
  counter instead of the newer profile-draining API.
- Apply deferred dirty checks to all sub-slices and ignore dirty rectangles
  retained from earlier frames. Without the latter, a clipped blur redraws on
  every unchanged frame after scrolling. The regression from
  [bug 2083950](https://bugzilla.mozilla.org/show_bug.cgi?id=2083950) is preserved.
- Copy the updated upstream transformed-filter reference image exactly. Its
  old bitmap differs between versions, so a binary delta against the newer
  original would not apply.

## Checks completed

The affected original files are pinned to Firefox commit
`9378fbc58660847fbc02c3486a0ecd6049978e25`. The verifier checks their SHA-256
hashes, applies all 23 text patches and 42 file overlays in a temporary tree,
compares every result against its expected hash, and can parse all 20 affected
Rust files. It never touches a browser application or profile.

```sh
python3 tools/backdrop-engine/verify.py --download --syntax
```

For an offline check, pass `--base-cache /path/to/pinned-original-files` instead
of `--download`. That directory must contain the original `gfx/wr/...` paths.

Wrench now builds and runs on `aarch64-apple-darwin` using the fork's pinned
Rust 1.95.0 and headless SWGL. All 65 affected files in its source tree match
the manifest, including the 18 WebRender and two Wrench Rust files. All 1,605
prepared inputs were verified against pinned upstream blobs or overlay hashes.
Wrench enables WebRender capture/replay as part of its dependency configuration.

The final candidate passes:

- 81 filter reftests, including six new cross-slice cases and the existing
  scale variants selected by the upstream manifest.
- 16 compositor-surface reftests.
- All 17 built-in invalidation methods and 11 manifest pairs. This includes
  unchanged-frame checks after scrolling a blur under a clip, retained content
  tiles, sampled-region changes, rounded clips, and compositor surfaces.
- All 18 raw test methods, including a backdrop becoming hidden after visible.

The workspace retains WebRender and Wrench as members. Its graphics dependency
files and fixture resources are pinned; the original Cargo lock only changes
the two graphics-generator packages to exact local paths. No assertions,
fixtures, or image tolerances were weakened. Build with `CARGO_PROFILE_DEV_DEBUG=0`
and `CARGO_INCREMENTAL=0` to limit disk use:

```sh
cargo +1.95.0 build -p wrench --features software --offline --locked -j 2
# From gfx/wr/wrench, using the resulting executable:
wrench --software --headless reftest reftests/filters
wrench --software --headless reftest reftests/compositor-surface
wrench --software --headless test_invalidation
wrench --software --headless rawtest
```

The first runtime attempt aborted in all four suites because the placement
prerequisite was absent. After fixing that, the invalidation suite exposed
repeated redraws from stale dirty rectangles. Both failures and their fixes
are retained in `validation.json`. A five-minute filter timeout was too short
for this unoptimized software build; the extended run passed without changing
tests. Earlier standalone compiler checks, disk-exhaustion and missing-asset
attempts remain recorded with their original source fingerprints.

These software results establish neither hardware browser output nor a speed
advantage. The full Gecko browser has not been built or installed.

## Required before installation

1. Import these overlays into the pinned engine and compile full Gecko.
   Standalone Wrench with capture/replay and its software suites now pass.
2. Verify the resulting browser retains the exact tested WebRender sources and
   run the integration checks for the actual packaged browser.
3. Run the relevant Gecko remote-iframe and chrome backdrop-filter tests.
   Check command panels over real remote page content on macOS with hardware
   rendering; a software document snapshot is insufficient.
4. Compare Arc and the candidate in all five Spaces, over light and dark
   content, while opening/closing panels, scrolling, switching tabs/Spaces,
   resizing, changing zoom and display scale, and with reduced motion.
5. Measure idle redraws, scrolling/frame latency, memory, tab switching and
   command-bar opening under matched conditions. Reject rendering improvements
   that cause unacceptable responsiveness regressions.

The native Space background handoff fix already installed in Zen is independent
of this draft. No production application was changed during this backport.
