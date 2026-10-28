# Cross-slice backdrop-filter backport

**Draft; standalone compiler checks passed; uninstalled.** These patches prepare Mozilla's cross-slice
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

The new path draws the needed primitives into backdrop captures, tracks which
lower slices contribute, and invalidates a capture when its sampled content
changes. It keeps the slice boundaries and avoids promoting sampled content
to separate compositor surfaces, where the backdrop could not read it.
Compositor rounded clips are applied to the captured source.

## Adaptations for Firefox 158

- Keep the older primitive-list parameters and `instance_to_draw` scratch
  layout; add capture storage without importing unrelated newer draw storage.
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
- Copy the updated upstream transformed-filter reference image exactly. Its
  old bitmap differs between versions, so a binary delta against the newer
  original would not apply.

## Checks completed

The affected original files are pinned to Firefox commit
`9378fbc58660847fbc02c3486a0ecd6049978e25`. The verifier checks their SHA-256
hashes, applies all 22 text patches and 40 file overlays in a temporary tree,
compares every result against its expected hash, and can parse all 19 affected
Rust files. It never touches a browser application or profile.

```sh
python3 tools/backdrop-engine/verify.py --download --syntax
```

For an offline check, pass `--base-cache /path/to/pinned-original-files` instead
of `--download`. That directory must contain the original `gfx/wr/...` paths.

Standalone WebRender compiler checks now pass on `aarch64-apple-darwin` with
the fork's pinned Rust 1.95.0 compiler, both for the default configuration and
with `capture,replay`. The same checks also passed with local Rust 1.99.1.
All 17 changed WebRender Rust implementation files in the compiled tree match
the overlay manifest. The two changed Wrench Rust files were parsed, but were
not compiled. See `validation.json` for the source fingerprint, commands and
log hashes.

The standalone workspace retains only WebRender as a member and uses the exact
pinned graphics dependency files without their Git history. The pinned
`webrender/res/Proggy.ttf` asset is included for capture/replay. These checks use
`CARGO_PROFILE_DEV_DEBUG=0` and `CARGO_INCREMENTAL=0` to limit disk use:

```sh
cargo +1.95.0 check -p webrender --offline --locked -j 2
cargo +1.95.0 check -p webrender --features capture,replay --offline --locked -j 2
```

Earlier attempts failed from disk exhaustion and then a missing font in the
reduced source checkout; these failures are retained in the validation record.
Successful checks emitted existing warnings from the pinned `gl_generator`
dependency. No Wrench test, Gecko build, hardware rendering comparison or
performance benchmark has run. A compiler pass does not establish rendered
output or integration correctness.

## Required before installation

1. Import these overlays into the pinned engine and compile both Gecko and
   Wrench, including the capture/replay configurations used by the tests.
2. Run Wrench's filter and compositor-surface reftests, `test_invalidation`,
   and `rawtest` with software rendering. Include the new scroll, clip growth,
   invisible/occluded content, scaled content, rounded clip, changing opacity,
   and overlay/underlay fixtures.
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
