# Experimental Mac elastic scrolling

The `apz.overscroll.arc_physics` preference is **off by default**. This change is
not ready to enable in a release. The browser builds and visible Cocoa input
checks pass for the boundaries listed below. All eight new APZ
tests and 74 existing overscroll/handoff regression tests pass in the rebuilt
engine test library. See `engine-runtime-validation-2026-11-02.json`.

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
`phase` uses Core Graphics scroll phases: begin 1, change 2, end 4, cancel 8,
and may-begin 128 (zero delta). May-begin can interrupt an ongoing return;
cancel it afterward to release the hold.
For the bottom, reset with `"bottom":true`. Use `"target":"sidebar"` on reset,
pan and snapshot commands to inspect sidebar APZ state. `short`, `nested-none`
and `nested-contain` are additional pages. A nested pan requires `"target":
"nested"` and a `"point":[x,y]` inside that element in page CSS coordinates.
The `zoom` command accepts `"value":0.8`, `1`, `1.25` or `1.5`.

For return-animation captures, replace the final pan with
`{"operation":"release","delayMS":3000}` and capture the visible window while
the delayed release fires. Query `{"operation":"release-state"}` afterward to
retrieve the scheduled, dispatch and callback times. Capture request intervals
must be retained when comparing frame positions with the return model; this
does not supply compositor presentation timestamps.
Add `"interruptAfterMS":40` to schedule a may-begin event shortly after the
release. This records both dispatch times and avoids protocol round trips
outlasting the return. Capture the remaining held stretch, then send a cancel
phase to let it settle.

Save the final release query as `release-state.json`, and a `capture-times.json`
array containing `frame`, `filename`, `requestedAt` and `returnedAt` for each
saved screenshot. Times use epoch milliseconds. Analyze the red marker at
device-pixel column 1000 (or supply another column) with:

```sh
swift tools/arc-elastic-physics/analyze_cocoa_return.swift /path/to/cocoa-results 1000
```

Capture the settled state last: the analyzer reports displacement relative to
that frame. Its capture intervals provide coarse observations of the return,
not exact animation timing or a performance benchmark.

The fixture uses `sendNativeMouseScrollEvent` on the owned top-level widget.
On Mac, this passes through Cocoa's `scrollWheel` handler. The headless
`sendNativeTouchpadPan` path does not test Cocoa and must not be used to establish
native scale or timing parity. Synthetic native input also does not establish
physical-trackpad or momentum-event parity.

The control evidence in `cocoa-control-validation-2026-11-02.json` verifies the
fixture on source `120afed` with the Arc preference disabled: trusted pixel
input, measurable page and sidebar stretch, return to rest, zoom, lower
boundaries, and nested `contain` versus `none`. These are control results, not
runtime validation of the new controller.

`cocoa-native-validation-2026-11-02.json` records the subsequent integrated
candidate with the preference enabled. At 2x backing scale, a 400-point native
pull moves the page 40 device pixels; a second pull reaches 80. Short pages,
lower boundaries, nested `contain`/`none`, and 125% zoom preserve the expected
displacements. Both short and long sidebars stretch and settle, including
cancellation at the long sidebar's lower edge. The page return captures show
80, 6, then 0 pixels, with observation intervals retained. These coarse frames
do not verify exact return timing. A timed may-begin interrupt also preserves
22 pixels of remaining stretch until cancellation releases it. Momentum,
physical input and Arc's native sidebar remain separate validation requirements.

Before enabling the preference:

- Keep the engine tests and existing overscroll/handoff regression suites passing.
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

## Native layout follow-up

The visible Cocoa candidate also passed scroll-snap, scaled-container and content
mutation checks. A 400-point pull moved the nested marker by 40 device pixels in
both the normal snap container and a container scaled to 75%; both returned to
their original marker, with the outer page unchanged. After bouncing, the next
scroll snapped to the second section at exactly 350 CSS pixels.

Shrinking content while held at its lower boundary clamped the scroll range to
zero; growing it restored ordinary scrolling. Removing the content during a
held pull and cancelling also returned to a zero range and offset. A container
rotated by five degrees stretched and settled using the existing Gecko fallback.
That check establishes recovery, not Arc curve parity for rotated containers.
See [the recorded layout results](cocoa-layout-validation-2026-11-02.json).

The fixture supports `nested-snap`, `nested-scale`, and `nested-rotate` routes.
Its `mutate` operation accepts `grow`, `shrink`, or `remove` for the page's main
content or the nested container's content. These are owned local fixture changes.
