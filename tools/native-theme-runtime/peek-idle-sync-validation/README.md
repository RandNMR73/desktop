# Repeated Peek updates

This candidate avoids decoding an identical request when the native host and
coordinate system are unchanged. It is not installed and has not been accepted
as an overall browser performance improvement.

The hidden native fixtures passed 73 host checks, 72 painted-placement checks,
and all 39 successive bitmap comparisons against the baseline. Removing the
geometry guard intentionally caused eight placement failures. Native window
replacement, flipping, detachment, ambiguity, and resizing with unchanged JSON
are exercised by the checked-in fixtures.

Four alternating baseline/candidate/candidate/baseline benchmark runs retain
all 3,840 measured native calls and 3,840 offscreen raster samples. An unchanged
request fell from a median of run medians of 90.687 to 3.646 microseconds. Hover
updates improved 4.37%; rail motion and confirmation width were 2.76% and 3.75%
slower respectively in this small comparison. Raster results were mixed and
did not improve overall. Ambient load was not controlled. These numbers exclude
Gecko, JS/FFI, pending SwiftUI work, GPU presentation, and physical input latency.
The browser already schedules this bridge by events rather than polling while
idle, so this is a saving per redundant call, not continuous idle CPU savings.

Use the README in the parent directory to rebuild and run the fixtures. The
baseline source is `ZenNativePeekControls.swift` at
`1ea69a477951e7af6776627bc56247392f69ad8a`. `performance.json` records exact
implementation and benchmark hashes; raw runs preserve individual timings.
Local bitmap evidence remains in the task validation directory; the 39 exact
comparisons in `correctness.json` report the completed local check.

## Cache invalidation follow-up

`TestPeekControlCache.swift` compares 21 native coordinate changes with a newly
created rail using the exact same request. Both the baseline and guarded
candidate pass every pixel/frame comparison, with visible ink required.
Removing the geometry guard fails 18 cases. The results and source hashes are
included here. This covers translation, scaling, flipping, resizing, rotation,
and nonuniform coordinate units; it does not establish Arc presentation timing.

A real headless Gecko controller run passed all 212 integration checks across
five Spaces and both sidebar layouts. Of 1,175 valid requests, 117 (9.96%)
repeated the preceding request without a recorded clear. This is workload
composition, not saved time. `request-frequency-fixture.patch` applies to a
copy of Astralforge's `tools/zen-bench/fixtures/peek-native-controls.js`; run the
existing `smoke_peek_native_controls.py` against that copy to record a fresh
trace. The full local trace is retained outside the repository.

An alternative geometry snapshot was also tested but not adopted. Its four
raw timing runs and patch are retained as `geometry-experiment.*` and
`benchmark-v3-*`. Background load changed substantially between baseline runs;
the measurements do not support installing the alternative or claiming an
active-animation improvement. The product implementation in this PR is still
the original three-point guard and remains uninstalled.
