# Repeated Peek updates

This installed optimization avoids decoding an identical request when the
native host and coordinate system are unchanged. It has not been accepted as
an overall browser performance improvement.

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
the original three-point guard.

## Paired replay of recorded browser requests

A new recording preserves exact serialized requests, clear boundaries, and
relative event times. The installed browser's isolated headless fixture passed
212 checks across five Spaces and two sidebar layouts. It recorded 1,202 valid
requests, including 120 duplicates, and 204 clears. This is a scripted browser
workload, not a recording of the user's browsing.

`ReplayPeekControls.swift` loads both implementations in one process, each in
its own never-shown AppKit window. Each receives the same event, with call order
alternating; four repetitions preserve the original event cadence. Every clear
is replayed, and duplicate classification is independently checked against the
previous exact string after those clears. The fixture checks 95 phase-end
bitmaps and host placements; all matched exactly. These image comparisons are
against the previous Zen implementation, not Arc.

Across four 1,202-request repetitions, native sync totals fell by 1.84%, 3.98%,
3.88%, and 2.53%. Duplicate-request totals fell 89.4–91.2%. Changed-request totals
ranged from 0.59% slower to 1.46% faster. Individual phases remained variable,
including hide/show, so this establishes a small aggregate saving in the
recorded workload rather than a uniform improvement in every interaction.
Only two requests exceeded their scheduled time by more than 16ms, both in the
first pass that also performed image comparisons.

The timings exclude Gecko/JS/FFI, string preparation, pending SwiftUI work,
clear-call costs, GPU presentation and physical input latency. Ambient system
load was not controlled. They do not establish an overall browser advantage.
The complete native bundle was subsequently validated and installed, as
recorded below.

`request-replay-summary.json` records totals, per-phase results and all limits.
`request-replay-state.json` records compiler commands, exact input hashes and
process exit codes. The gzip archives preserve the complete trace and raw
paired samples; decompressed SHA-256 values appear in those reports.
`request-replay-fixture.patch` applies to the same Astralforge fixture as the
previous request-frequency patch, separately against the original file.

To reproduce the native replay from this worktree:

```sh
peek_replay_dir=$(mktemp -d /tmp/peek-replay.XXXXXX)
git show 1ea69a477951e7af6776627bc56247392f69ad8a:tools/native-theme-runtime/ZenNativePeekControls.swift > "$peek_replay_dir/baseline.swift"
xcrun swiftc -warnings-as-errors -O -emit-library -module-name PeekReplayBaseline "$peek_replay_dir/baseline.swift" -o "$peek_replay_dir/baseline.dylib"
xcrun swiftc -warnings-as-errors -O -emit-library -module-name PeekReplayCandidate tools/native-theme-runtime/ZenNativePeekControls.swift -o "$peek_replay_dir/candidate.dylib"
xcrun swiftc -warnings-as-errors -O -parse-as-library tools/native-theme-runtime/ReplayPeekControls.swift -o "$peek_replay_dir/replay"
gzip -dc tools/native-theme-runtime/peek-idle-sync-validation/request-replay-trace.json.gz > "$peek_replay_dir/trace.json"
"$peek_replay_dir/replay" "$peek_replay_dir/trace.json" "$peek_replay_dir/baseline.dylib" "$peek_replay_dir/candidate.dylib" "$peek_replay_dir/result.json"
```

The complete signed native bundle was also rebuilt. All theme resources match
the installed bundle byte for byte; only the native library and build metadata
change. `PeekLibraryBridge.swift` loads that exact dylib for the cache, geometry,
and successive-state fixtures. Its 21 coordinate cases and 72 placement samples
pass, and all 39 successive rendered states match the baseline bytes exactly.
`native-bundle-comparison.json` identifies the library and completed checks.

## Installation

Source PR 281 was merged at `4408dbb7d80f68dce43c799b83057b285ff8dfb5`.
The signed native library was installed and the normal browser restarted. Its
loaded library path and six installed payload hashes were verified. The engine,
browser archives, theme resources, and profile configuration links are unchanged.
A signed rollback app and cloned profile backup are retained locally.

Native CUA verification exercised Close with the sidebar open and Expand/Split
with the sidebar closed. All actions succeeded; temporary tabs were closed,
and the original page and closed-sidebar state were restored. The installed
record is `installation-verification.json`. This remains a small native-work
optimization, not certification of Arc timing or whole-browser superiority.
