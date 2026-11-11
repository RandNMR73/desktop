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
