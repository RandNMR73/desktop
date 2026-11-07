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

## Gesture-end presentation ownership

Gecko's `SwipeTracker::ProcessEvent` dispatches a successful `MozSwipeGesture`
and schedules `SwipeFinished` on the next main-thread task. That sends
`MozSwipeGestureEnd` while the consumer's Space spring is still running. This
event ends input tracking; it does not mean the consumer's presentation has
settled. A cancelled swipe instead receives native return samples before end.

The swipe handler now reserves presentation ownership before entering the
asynchronous Space-switch queue. Gesture end removes input attributes and the
popup listener, but leaves the background opacity, layout and scrollbar to the
running switch. An unrelated keyboard switch taking over a gesture receives
the same protection. Duplicate end signals are ignored; standalone completion
gestures still navigate, as required by Gecko's event contract. Ownership
belongs to the original gesture state so its eventual completion cannot modify
a newer gesture. Idle cancellation retains its normal cleanup.

Before this correction, all six reproduced successful releases reset DOM
background opacity to 1 with the incoming strip still 35–64% away from its
destination. That violates Arc's progress-driven background/strip relationship
documented above, even though a subsequent spring frame may repaint it. The
new checks dispatch gesture events through the browser's real event listener
and assert presentation continuity at release, including synchronous cleanup
before the queue starts. This does not establish physical trackpad input,
release-velocity or gesture-interruption parity; those remain separate audits.

## Physical release contract (full native validation pending)

The swipe-interruption audit reproduced a new gesture being rejected in all
five Spaces, with both pinned and floating sidebars, while the previous spring
was running. Removing the `isChangingWorkspace` condition alone is insufficient:
the manager also refuses strip updates while `#spaceVisual` owns presentation.
That state must be handed to the gesture at its current position, and stale
queue/animation callbacks must remain unable to repaint it.

Read-only tracing establishes these additional Arc 1.171.0 arm64 rules:

- The gesture path calls `0x100a23be0` before changing the presented position.
  Its call to `0x100b8f204` uses both Boolean arguments false. That routine
  matches Motion `ValueAnimation.stop(resolveImmediately:postValueChanged:)`:
  disable animation without replacing the current value or firing completion.
  The following public velocity setter clears velocity. Custom settling-session
  cancellation is a separate branch and is not used by this sidebar controller.
- `VelocityTracker` initializes a 100-millisecond history window at
  `0x100b1ee44`. The timestamp's milliseconds enum case is resolved through the
  chained import at `0x1041dfd40`. Sampling appends value/time at `0x100b1ef74`;
  trimming at `0x100b1f6cc` removes samples older than 100 ms. The getter at
  `0x100b1f19c` uses the difference between last and first remaining samples,
  divided by elapsed seconds. Fewer than two samples, elapsed <= 0, or elapsed
  >= 100 ms produces zero. Phase 8 advances the clock and reads velocity; it
  does not append a new stationary sample at finger release.
- Release chooses a destination at `0x100a22b88`. Below 5 points/second in
  absolute velocity, its compact-map closure `0x100a23224` produces the
  absolute distance to each page origin, then `0x100a26a18` sorts ascending.
  Otherwise it takes the last origin <= presentation (`0x100a1f828`) for a
  negative velocity, or its successor for a positive one. It bounds the
  destination to one page either side of the starting item and available pages.
  No containing page, or a missing starting item, returns the first page.
- `0x100a21524–0x100a21540` keeps release velocity when `(position > target)`
  differs from `(velocity >= 0)` and otherwise passes zero. The comparisons at
  equality are intentional; replacing them with a product-of-deltas test loses
  the native equality behavior. Cancellation is a separate zero-velocity path.

`ZenSpaceSwipeInput.mjs` implements the ordinary release selection and velocity
rules. The sidebar now adopts the current presentation when a new gesture starts,
invalidates prior paint callbacks and queued selections, and passes the sampled
release velocity to the same Space spring. The native input patch adds a
Chrome-only `swipeConsumerHandlesRelease` opt-in. A consumer sets it on start
and each movement update. On finger release, an opted-in consumer receives
`MozSwipeGesture` with the final progress even below the navigation threshold.
The event retains the release timestamp; it receives no artificial final
movement sample and no native return animation. The usual later
`MozSwipeGestureEnd` still closes tracking. Handing an edge action back to Gecko
clears the opt-in on its movement update. A Chrome-only `swipeProgressOffset`
rebases that handoff to the selected Space's origin once. Movement spent reaching
that origin is excluded from the edge UI, success threshold and native return.
Existing navigation without this opt-in remains unchanged.

The ordinary selection animation now captures both CSS gradient layers and
reapplies the pair after theme preparation. Previously that preparation could
replace both layers with the destination before interruption; adopting the
correct pair then produced a color jump. Native and CSS theme progress remain
synchronized when the strip changes animation owner.

`test_swipe_release.py <patched-gecko-root>` compiles the actual patched
`SwipeTracker::ProcessEvent`, threshold methods and consumer configuration
against widget/scheduler fakes. Eighteen cases cover ordinary navigation,
below-threshold and stationary release, reversal, unbounded progress, end-event
delta, edge-action handback and origin rebasing in both directions, cancellation
and subsequent gestures. The old
event loop fails the owned-release case; the patched loop passes. Eight math
tests exercise the velocity window, destination, resistance/inverse and direction
edges. Queue and input tests cover stale, queued and reentrant ownership.

The native patches apply without fuzz and reproduce the tested files. These
checks establish the local event-loop and math behavior, not generated WebIDL
binding compatibility, a complete Gecko build or physical trackpad parity.
The disposable-browser scripts `check-space-swipe-takeover.js` and
`check-space-swipe-edges.js` cover five Spaces in pinned/floating sidebar modes,
interrupted selection, zero movement on takeover, release, reversal, cancel,
queued/keyboard takeover, reduced motion and Library/New Space entry. Their
SimpleGestureEvents deliberately emulate the new fields because the candidate
still has the installed XUL. The edge script also emulates the offset handshake
that the separate compiled native harness verifies. These are integration checks,
not physical-input evidence. The final package passes all 20 takeover cases and
four edge-entry cases; the source suite passes 1,187 tests. Compare visible page positions and compositing
weights: offscreen pages may be repositioned, reversed layer pairs complement
alpha, and numerical roundoff is not a visual discontinuity.

`check-space-swipe-native.js` sends macOS scroll-event phases through
`sendNativeMouseScrollEvent`, without defining synthetic gesture fields. It
checks fast and stationary releases, interrupted selection, cancellation,
reversal and explicit selection in pinned/floating modes. Run groups separately
when the fixture's script timeout is shorter than the full five-Space matrix.
On the installed engine, the twelve-case two-mode baseline reproduces rejected
interruption, stationary-release navigation and stale selection overriding an
explicit command. Cancelled pans also leave tracking active, contaminating the
next gesture. The test records that failure before sending an end phase to
clean up; cleanup never changes a failed result into a pass.

The cancellation fix handles `PANGESTURE_CANCELLED` before sampling movement,
stops tracking and queues exactly one normal finish notification. It applies
to ordinary navigation, Space-owned swipes and edge-action handoff. Three
additional compiled cases fail on the previous loop and pass with the fix.
The new engine still needs this headed native-input matrix; the baseline is
evidence of the old failures, not verification of the replacement or physical
trackpad feel.

The installed browser still uses the previous release path. Remaining work is a
full native build, headed native-input and physical-trackpad checks, and
installation together with the corresponding Astralforge build/config changes.
The native build remains below its existing disk-space preflight; its guards
have not been reduced.
