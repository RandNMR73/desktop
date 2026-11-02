# Trackpad overscroll routing and short-content elasticity

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
preference, motion curve, wheel behavior, or page CSS override is added by the
routing backport itself.

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

Incremental builds also need the static preference generator to return its
preprocessor include dependencies. Without that, changing Zen's included
settings does not regenerate C++ preference accessors. The dependency repair
passes all three generator tests, and the generated make dependency file now
contains `zen-static-prefs.inc`.

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

## Content that fits the viewport

Arc 1.171.0 embeds Chromium 156.0.8078.74. Its non-Android elastic overscroll
controller permits a zero scroll range. Gecko 158 instead required a scroll
range before applying the effect. The additional Axis/APZ controller patches
separate overscroll eligibility from ordinary scrollability. User-scrollable
zero-range controllers can bounce; hidden/clipped axes, zero-size viewports,
and a visible browser-chrome root cannot. CSS `overscroll-behavior: none` still
suppresses the effect. Wheel input and history-swipe scrollability queries
retain their existing behavior. Zen enables the new preference on macOS.

The sidebar's scrollbox also keeps `overflow-y: auto` and vertical containment
when it has no overflow. Without containment, main-thread target confirmation
redirected the short-list gesture to the stationary chrome root. This uses the
compositor's existing elasticity without fake scroll range, extra padding,
JavaScript animation, or a forced `will-change` layer. The pinned-only scrollbar
rule is retained.

Validation on macOS arm64:

- The new 13 controller cases had five failing tests before the engine change;
  all pass afterward. Six additional cases verify handoff and chrome-root
  isolation. The combined `ZenAPZ*:*Overscroll*` run passes 114 distinct tests.
- The zero-range browser helper initially failed both auto/contain bounce
  assertions. The registered browser suite now passes all 38 checks with the
  normal content sandbox enabled.
- A fresh, isolated profile running the packaged default bounces at both edges
  of a two-pin sidebar with exactly zero scroll range and no scrollbar. No test
  stylesheet or preference override is needed. Longer ordinary-tab and
  pinned-only lists also bounce and recover; pinned-only lists hide the thumb.

Chromium reference:
https://github.com/chromium/chromium/blob/156.0.8078.74/third_party/blink/renderer/platform/widget/input/elastic_overscroll_controller.cc

These checks establish working elasticity in the isolated test build, not
identical Arc/Gecko displacement, return timing, or physical-trackpad visuals.
Empty nested web scrollers with default overscroll behavior also still depend
on Gecko's main-thread scroll-target eligibility. Those cases and optimized
release performance remain separate validation work. The production app has
not been replaced by this validation build.
