# Experimental Mac elastic scrolling

The `apz.overscroll.arc_physics` preference is **off by default**. This change is
not ready to enable in a release. The engine integration and its eight APZ test
cases have compiled, but the integrated tests and browser comparisons have not
yet run.

The controller uses accumulated input force, a 10-point activation threshold,
5% resistance, and a quantized exponential return. It retains input velocity
across the first transition into momentum and starts the return clock at the
triggering native event. Native timing and backing scale travel with the pan
event, so Retina scale is distinct from browser zoom. Existing APZ handoff and
CSS overscroll restrictions still determine which scroll container can respond.

The standalone models are compared with the unchanged Chromium controller and
exponential implementation at revision
`a5de7e8894913ee20caf97ca5e0935a6ddf37e8c`. The headers under `controller-shim`
and `upstream-shim` supply small dependency interfaces for those reference
sources. They do not replace the reference gesture or exponential algorithms.
The input test also compares velocity calculations with the arithmetic
instruction sequence inspected in Arc 1.171.0's arm64 ArcCore 156.0.8078.74.
Its arm64-specific test is skipped on other architectures.

Run the standalone comparisons from the repository root:

```sh
python3 tools/arc-elastic-physics/validate.py
```

The script accepts `--cxx`, `--sysroot`, and `--output`. It writes temporary
binaries outside the repository and removes them afterward. These checks do
not establish browser or physical-trackpad parity. The engine tests are named
`ZenAPZArcElasticPhysics.*` and belong in a rebuilt `xul-gtest` library.

## Visible Mac input fixture

`cocoa_fixture.py` starts a separate browser on a disposable profile, seeds its
sidebar from Astralforge, and serves local pages with measurable edge markers.
It requires a matching Astralforge checkout with `tools/zen-bench` and the native
theme resources in the test app. The app bundle and existing profiles are not
modified. Start the original-physics control with:

```sh
python3 tools/arc-elastic-physics/cocoa_fixture.py \
  --app '/path/to/Zen Candidate.app' \
  --config-repo /path/to/Astralforge \
  --output-dir /path/to/cocoa-results
```

Add `--physics` to test this patch, and `--sidebar-tabs 32` for a long sidebar.
The fixture reads one JSON command per line; `stop` closes its owned process.
For a top-boundary pull, send these commands individually, capturing the visible
window after `reset`, after the first `pan`, and after the final release settles:

```json
{"operation":"navigate","page":"long"}
{"operation":"reset","output":"before.json"}
{"operation":"pan","phase":1,"dy":400,"output":"held.json"}
{"operation":"snapshot","output":"held-content.json"}
{"operation":"pan","phase":4,"dy":0}
```

Positive native deltas pull past the top; negative deltas pull past the bottom.
`phase` uses Core Graphics scroll phases: begin 1, change 2, end 4, cancel 8.
For the bottom, reset with `"bottom":true`. Use `"target":"sidebar"` on reset,
pan and snapshot commands to inspect sidebar APZ state. `short`, `nested-none`
and `nested-contain` are additional pages. A nested pan requires `"target":
"nested"` and a `"point":[x,y]` inside that element in page CSS coordinates.
The `zoom` command accepts `"value":0.8`, `1`, `1.25` or `1.5`.

The fixture uses `sendNativeMouseScrollEvent` on the owned top-level widget.
On Mac, this passes through Cocoa's `scrollWheel` handler. The headless
`sendNativeTouchpadPan` path does not test Cocoa and must not be used to establish
native scale or timing parity. Synthetic native input also does not establish
physical-trackpad or momentum-event parity.

The control evidence in `cocoa-control-validation-2026-11-02.json` verifies the
fixture on source `120afed` with the Arc preference disabled: trusted pixel
input, measurable page and sidebar stretch, return to rest, zoom, lower
boundaries, and nested `contain` versus `none`. These are control results, not
runtime validation of the new controller. The integrated candidate must repeat
them and check its own displacement and timing against the reference.

Before enabling the preference:

- Run the engine tests and existing overscroll/handoff regression suites.
- Verify real browser input, interruption, cancellation, scroll snap, layout
  changes, nested scrollers, display changes, and browser zoom.
- Finish handling rotated or reflected scroll containers, which currently use
  the original scrolling model.
- Compare Arc's native sidebar separately; Chromium's page controller does not
  prove that AppKit sidebar motion uses the same behavior.
- Confirm the installed Arc runtime setting for event-delta axis selection.
  Both source branches are tested by the standalone comparison.

The native source baseline includes the existing `native_macos_popovers_fix.patch`
and `expose_tiled_attribute_to_all_platforms.patch` under
`src/external-patches/firefox`. Reconstructing both Cocoa files with the complete
patch stack matches the active engine exactly. Keep those patches when applying
the physics changes.

The adapted gesture controller carries the Chromium and Apple license notices
in its header. The reference source licenses are retained here as well.
