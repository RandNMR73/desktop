# Space background transitions

The native theme renderer now follows the same progress as the workspace strip.
A trackpad drag blends the current and adjacent Space; reversing the drag reverses
the blend. Click/keyboard switches drive it alongside the existing strip spring.
A cancelled or completed transition restores the selected theme without hiding
either the main surface or the floating sidebar surface.

The main and floating renderers share one bounded pair of validated paints and
one progress value. The second Metal draw blends premultiplied RGBA into the first
with constant-alpha factors. This preserves extended color, gradient geometry,
window-coordinate texture sampling and translucent theme strength. The whole
sidebar never fades out to expose the website behind it. Edited dynamic themes
and imported static fields use the same path. Reduce Motion skips the blend.
There is no idle display loop. Obsolete animation callbacks cannot restart it.

The workspace module runs in the window module scope; theme ownership lives in
the shared system module. Use the same ChromeUtils import as updateNativeTheme
when accessing the owner, rather than importing a second owner map.

## Reference and validation

Read-only Arc 1.171.0 arm64 reflection identifies
WindowThemeBackgroundConfiguration.transitioning as the tuple
`from, to, progress, shouldCrossfade` (type reference 0x103b9b968).
PagingTransitionConfiguration contains floorItem, ceilItem and progress. The
background view computes the complementary old opacity at 0x10153d998–0x10153d9a8.
This establishes progress-driven blending, not an independently timed fade.

TestThemeBlend.m reads the actual Metal output of an owned test window: 720 pixel
component checks cover four theme pairs, intermediate values and reversal, with
maximum absolute half-float rounding error 0.000427247. Browser checks cover all
five Spaces in pinned and floating modes, manual swipe progress/reversal, rapid
queued switches, surface continuity and final blend removal. The source suite
passes 1,078 tests. Configuration archive and native installer tests also pass.

## Paging spring

Read-only tracing of the same Arc build identifies WindowLayoutController's
lazy PageSwipeController at `0x100214e6c`, stored through field-offset global
`0x10453a1a0`. Its initializer `0x100a1ee64` leaves the optional settling handler
nil; the WindowLayoutController wiring has no setter for it. Its Combine assign
at `0x100218730` targets a Bool key path, not the optional handler. The normal
selection path reaches `0x100a20274` through `0x100a1f038`. At
`0x100a20464–0x100a204c0`, the nil-handler path selects response .4 and damping
ratio 1; .25 is reserved for a controller with a custom settling handler.
`0x100b6ae50` converts response and ratio to `(2π/response)²` stiffness and
`4π×ratio/response` damping. The background configuration and sidebar paging
configuration share progress at `0x10021ec4c` and `0x10021ece0`.

Zen now drives visible tab strips, Essentials and both theme surfaces from one
normalized spring with those physical parameters. It no longer truncates the
tail after a duration-derived 300 ms watchdog. The production Motion solver is
checked against the closed-form critical-damping solution at 10 ms intervals;
the theme and strip remain synchronized after a partial drag. Reduced motion
skips the transition, and obsolete callbacks cannot repaint a newer Space.

## Screen-point settlement

The installed Arc binary identifies this implementation as the open-source
`Motion.SpringAnimation` (not SwiftUI's FluidSpring). Its critical branch at
`0x100b70914–0x100b70964` uses the analytic exponential position and derivative.
The superclass initializer writes .01 to `resolvingEpsilon` at
`0x100b9040c–0x100b9041c`; the pager's lazy constructor at
`0x100a23914–0x100a23aa0` does not override it. Page origins are index times
`effectiveSidebarWidth` (`0x10021e67c–0x10021e68c`), and the presentation callback
normalizes that position by the same width (`0x10021e7b4–0x10021e7bc`). The
threshold therefore applies in screen points, not normalized pages.

Zen converts .01-point position and velocity tolerances to the animated unit.
The initial 0→1 timeline accounts for the remaining distance after a partial
swipe; interrupted page-coordinate timelines account for the current strip
width. Tabs, Favorites and theme surfaces continue to share one timeline.
The 2-second timeout remains a fault watchdog, not normal completion.

`SpaceSpringReference.swift` generates `space-spring-reference.json` using
unmodified [Motion sources](https://github.com/b3ll/Motion/tree/c9a57f9d2b9d0a1e1b905753175e75a422d381d5)
with Swift Numerics 1.0.3. Add the reference as a SwiftPM executable depending on
Motion, then run it and retain the cases in the reference JSON. It calls `tick`
directly, without starting an animation driver or interacting with Arc.
The 24 cases cover 180/228/340-point widths, .001/.35/1/2-page distances, and
60/120 Hz. Source tests compare both full-page and partial-swipe timelines to
these independently generated native positions and completion frames.

At 228 points, a one-page move previously snapped its last .15 point at about
.617 s; the native reference settles at 1 s. The corrected traces agree within
2.3e-13 points across the recorded cases. This validates the calculation and
stopping units; it does not measure compositor frame scheduling or certify
physical trackpad feel.

## Selection interruption

The selection setter `0x100a1f038` compares the requested item with its previous
selection and returns unchanged when they match (`0x100a1f2b0–0x100a1f2f0`).
A changed selection calls settle with a nil optional velocity at
`0x100a1f244–0x100a1f24c`. Settle maps nil to zero at
`0x100a20540–0x100a20548` and calls the public velocity setter `0x100b82404`.
That setter calls `0x100b89de0`, which negates the SIMD velocity and writes
the field at metadata offset `0x140` (`0x100b8a198–0x100b8a1c8`).
ValueAnimation's reflected field vector starts at `0x130`; its third field
is `_velocity`. This independently identifies the write as velocity, rather
than a target or current-position reset. The animated path keeps `_value`.

Zen now distinguishes a new destination from a repeated one when continuing
the shared page timeline. A new selection retains the presented position and
resets velocity to zero, avoiding a brief movement away from the new selection
on a rapid reversal. A repeated destination retains its sampled velocity.
`SpaceSelectionReference.swift` applies the observed selection policy to the
same unmodified native Motion source used above. Its reference cases cover
reversal, continuing forward and repeated selection at two interruption times,
three widths and two frame rates. The source test compares positions and
settlement frames against that independent native reference.

This proves the selection policy and spring calculation. Physical gesture
release and compositor timing remain separate audit items. The gesture-release
caller can pass an explicit velocity; its behavior must not be inferred from
the selection reset.

## Repeated plain selections

The queue shares adjacent, pending plain selections of the same destination.
It returns the existing promise without reserving a new sequence or completing
the running animation. Thus a repeated dock command or keyboard shortcut leaves
the original spring, its velocity and its theme timeline untouched. Sharing
ends when the task settles, fails, or another request intervenes: A→B→A still
selects the final A. Reservation is published before invoking animation
completion callbacks, so reentrant input follows the same ordering.

Initialization, forced refresh, swipe settlement, explicit tab requests and
unknown options retain separate queue entries. Their extra work must execute.
A plain selection of an already settled Space does not start a zero-distance
animation; a partial swipe back to the same Space still settles normally.
Queue tests exercise shared results and errors, running animations, intervening
destinations and reentrancy. Headed browser checks exercise the dock's actual
command handler, shortcut entry point, settled selection, partial return,
explicit tab selection and forced refresh in pinned and floating sidebar modes.
