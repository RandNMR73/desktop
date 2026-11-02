# Trackpad overscroll routing backport

Firefox 158.0.1 only considers the root content controller as a fallback
overscroll target when a new pan starts at a boundary. A scrollable child can
therefore lose its local elastic effect when its parent does not scroll or
disallows overscroll. This affects browser chrome lists as well as nested page
scrollers. The output direction mask can also become empty, suppressing the
whole gesture until the fingers lift.

The source patches backport Mozilla bug 1860662's two-pass target selection:
first find a controller with room to scroll, then search reachable controllers
from outside in for one that can overscroll. Keep only preceding controllers'
handoff restrictions. Return both directions when no target is selected.

The 158 method name `FindFirstScrollable` is retained so this backport does not
rename callers or change ABI. `nsTArray.h` is included explicitly. No browser
preference, motion curve, wheel behavior, or page CSS override is added.

Upstream implementation:
https://github.com/mozilla-firefox/firefox/commit/d470ef883173a59d3f6712752e8b842096e2fb6e

Upstream issue:
https://bugzilla.mozilla.org/show_bug.cgi?id=1860662

The registered `TestZenOverscrollHandoff.cpp` is adapted from Mozilla's APZ
regression tests (MPL 2.0), including per-axis restrictions, wheel/zero-delta
input, and reversal during a gesture. An additional case covers a sidebar
inside browser chrome with no root-content controller. Names have a Zen prefix;
calls retain the 158 method name. Run these with a full, non-artifact Gecko build:

```sh
./mach gtest 'ZenAPZ*'
```

A smaller standalone check compiles the *actual* function before and after the
patch against mock controller states and the upstream table:

```sh
python3 tools/overscroll-handoff/check_routing.py \
  --source /path/to/unmodified-firefox-158.0.1/gfx/layers/apz/src/OverscrollHandoffState.cpp
```

On 2026-11-02 this ran 164 checks: 53 failed before the patch and zero after.
A full release-mode engine build subsequently completed with PGO and LTO
disabled for validation. All 49 registered `ZenAPZ*` checks and all 51 existing
`*Overscroll*` checks passed. This is engine coverage, not confirmation of
identical visible displacement or physical trackpad behavior.

Before a local build, import the English Zen resources after importing patches:

```sh
python3 scripts/update_en_US_packs.py
```

The release workflow imports language packs separately. Omitting this local
step produces a build that launches but lacks Zen labels and shortcut keys.
The isolated validation app now includes all 14 English Zen resources. It is
not installed as the production browser. Optimized-build performance and
physical-trackpad visual verification remain required before release.

The headless browser/compositor overscroll suite also passes all 17 checks on
macOS, with the content sandbox enabled. Its existing headless pan handler
needed a test-only platform-guard correction: `HeadlessWidget` supports pan
gestures on macOS, but the shared helper rejected the platform before reaching
it. This covers nested scrollers, handoff restrictions, and recovery after pan
end; it does not substitute for physical-trackpad visual comparison.

For a separately staged test app, place dereferenced `_tests/modules` inside
the app's `Contents/Resources/test-modules`, use a bundle path without spaces,
and pass that directory as `--testing-modules-dir`. Use an isolated app with
empty enterprise policies so the harness does not install production add-ons.
The test entry point is:

```sh
./mach mochitest --headless --appname /path/to/ZenEngineHeadless.app/Contents/MacOS/zen \
  --testing-modules-dir /path/to/ZenEngineHeadless.app/Contents/Resources/test-modules \
  gfx/layers/apz/test/mochitest/test_group_overscroll.html
```

This patch does not make zero-range content elastic. Chromium 156 allows that
on macOS, while Gecko's `GetOverscrollableDirections` still requires a scroll
range. Nor does it establish identical Arc/Gecko displacement or return timing.
Those remain separate parity work.
