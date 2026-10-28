# Native copy-notification prototype

This document records the native notification implementation and its staged
validation. Installation evidence is maintained by the Astralforge companion
report; the rendering-engine experiment is a separate, uninstalled change.

The notification now uses an AppKit overlay inside Gecko's ChildView rather
than a separate child panel. A sibling paint view keeps AppKit's private material sublayers
from covering the gradient; explicit label colors stay outside vibrancy.
The text field includes its drawing-cell inset without shifting the intended
12-point painted text padding. The optional ABI and DOM fallback remain.
A failed native replacement clears the previous Share target before fallback.

Validation on October 27:

- Native bundle compiled with warnings treated as errors; 221 source tests pass.
- Standalone RuntimeProbe uses the actual runtime Objective-C notification code.
  Its label and Share button are present in all five palette captures.
- Share opens the macOS picker; cancellation was directly observed. Nothing was
  shared. Copy Without Share removes the previous action. Timed Copy dismisses,
  and resizing removes the toast.
- Two background rows per Space differ from the earlier independently checked
  SwiftUI palette proof by at most 4.72 RGB levels. This comparison is against
  the proof, not a new Arc capture, and is not pixel-identical certification.
- A click-based pointer-retention attempt did not retain the toast. Computer use
  has no dedicated pointer-hover operation; genuine hover behavior still needs
  verification. Do not mark it passing from the unit tests or tracking code.
- Browser-level investigation reproduced `cgWindowNotFound` only after the
  native notification was added, and removing it restored accessibility.
  Gecko's `BaseWindow.mainChildView` expects ChildView to remain the last direct
  content-view child; the sibling overlay violated that invariant. The overlay
  now lives inside ChildView. RuntimeHostChecks covers host order, reuse,
  replacement, flipped coordinates and ordinary AppKit probe windows.
- The rebuilt synthetic-profile browser was directly captured with the full
  notification in all five Spaces. Copy shortcut input, window accessibility
  and normal timed dismissal worked without the previous capture failure.
  This launch also displayed its initial Stanford background, not white;
  that single observation does not certify every inactive startup.
- The native notification and Share picker are now exposed alongside Gecko's
  accessibility root. An on-demand NSArray projection reads the existing
  window hierarchy; it retains neither the window nor notification and adds
  no polling. Setting the modern children property to nil was rejected after
  direct testing showed it hid the browser controls after dismissal.
- The rebuilt browser exposes the full label and Share action in all five
  Spaces, and switching Spaces clears the previous notification. Share was
  opened and cancelled twice through accessibility; no service or recipient
  was chosen. Timed dismissal removes only the notification, leaving the
  browser controls accessible. Native regression checks also replace the
  browser root after dismissal and preserve intervening accessibility edits.
  VoiceOver speech and keyboard traversal have not been certified.
- A fresh Arc Main Space capture on the same black local fixture differed by
  3.92 and 3.64 RGB levels at two text-free background strips. Captures are
  resized JPEGs with no embedded ICC profile; this is not exact parity.
  Fresh attempts in the other four Arc Spaces did not capture a notification,
  even across consecutive frames. They are not valid color references and no
  conclusion about Arc's notification behavior is drawn from those misses.

Additional investigation on October 27:

- Removing the forced Aqua appearance produced identical sampled notification
  colors in Main Space and Stanford. That experiment was rejected; the isolated
  test app was restored to the validated native accessibility bundle.
- A native diagnostic confirmed that the computer-use drag attempt did not put
  the physical pointer inside the notification. It therefore provides neither
  a passing nor a failing test of real pointer hover. No tracking change was
  made from that result.
- A second valid Main Space Arc capture differs from the same candidate by
  at most 2.71 RGB levels in two text-free strips. These are different samples
  and a different capture from the earlier comparison, not evidence of a code
  improvement. Subsequent Arc captures without a visible toast remain invalid
  references; clipboard copying itself was separately confirmed.
- The restored candidate completed 25 sequential switches through all five
  Spaces with no native-background attribute changes, one submitted native
  frame per switch, and no additional idle frames. Timings include workspace
  animation and two animation-frame callbacks, not display presentation.

The regular browsers were also inspected in each Space and returned to Main.
The installed background handoff remains separate from this uninstalled toast
prototype. Command-bar page blur remains visibly different: Mozilla's newly
landed [bug 2079476](https://bugzilla.mozilla.org/show_bug.cgi?id=2079476)
addresses cross-slice backdrop sampling in Firefox 161,
while this fork is based on 158.0.1. It requires engine integration and native
validation; merely enabling a CSS blur is not a tested fix for this build.

The rollout scope is the notification palette, native Share action and tested
lifecycle behavior. Exact hover, animation, keyboard/VoiceOver and pixel parity
remain separate validation gaps and must not be represented as passing.

The private validation folder is `native-copy-toast-2026-10-27`. Web screenshots,
profile data and browsing history are excluded from this branch. RuntimeProbe
is a diagnostic app; its control layout is not part of the browser UI.


Additional integration and direct testing on October 28:

- Merged the installed window-continuity fix into this branch. Companion overlay
  0063 now follows 0062; its complete zero-fuzz rebuild changes only the three
  notification modules. The root archive and engine remain unchanged.
- A valid new Arc Stanford capture exposed the wrong dark Share-control fill.
  Read-only inspection of Arc's button styling confirms a white fill at 0.6
  opacity with dark text, or 0.2 with white text; it does not invert to black.
  The separate three-point inset shine fades over the upper quarter (0.2 or
  0.12 to zero). The foreground-colored half-point border uses 0.36 or 0.2,
  and hover/pressed overlays use black at 0.025/0.05. The candidate now draws
  those layers with the observed six-point radius. Its SF Symbol typography
  and continuous-corner rasterization remain uncertified.
- The rebuilt browser shows the full label and Share button in all five
  Spaces. The new Stanford reference confirms the darker inverted button is
  gone. Share opened and cancelled in the actual browser; no item was sent.
  New reference attempts in the other four Arc Spaces again missed the toast,
  including a distinct-clipboard test. They are not visual passes or evidence
  that Arc lacks feedback. Screenshot timing and activation remain unresolved.
- Delayed localization/native completion can outlive a Space switch or window
  close. Notifications now retain the originating Space and listen through the
  Space manager's actual change callbacks until completion, then unregister.
  Returning to the original Space cannot revive an old copy/Share target.
  An initial UI-event implementation passed the mock but FAILED the live
  round-trip check because normal switches do not emit that UI event; it was
  replaced. Both one-way and round-trip live checks now return no native or
  DOM notification. Rejected implementation and result remain in private logs.
- All 228 source tests and native host checks pass. The native build treats
  warnings as errors. The signed isolated application contains the exact
  source modules and updated library. No production app was changed by this
  prototype integration, and full parity/speed claims remain unsupported.

### Five-Space reference capture follow-up, October 28

The missing-reference problem was capture latency: a heavy live page took about
ten seconds to inspect, after the notification had disappeared. A black loopback
fixture reduced screenshot latency to about 1–2 seconds. Fresh Arc captures now
visibly contain the notification in all five Spaces, as do the same Zen candidate
captures. Corresponding text-free strips differ by 0.50–3.33 RGB levels (mean
absolute channel difference, 0–255 scale). The images are resized JPEGs without
ICC profiles, so these measurements support the palette correction, not exact
color or pixel equivalence. No constants were tuned to these compressed samples.

Arc automatically shows its Developer Mode toolbar on localhost and places the
notification ten points below the page's top edge. Zen lacks that toolbar; its
notification remains ten points inside the normal page frame. Developer Mode is
a separate feature gap, not a verified placement match in that mode.

The candidate's Share picker opened through accessibility and Escape cancelled
it without sending anything. Default timed dismissal changed native status from
25 (visible, timed, shareable) to 0, left no DOM notification and preserved browser
controls in the accessibility tree. One-way and round-trip delayed-copy Space
switches again left neither a native nor a DOM notification. All 228 source tests
passed again before rollout. Tab traversal returned to browser controls; this
does not establish keyboard access to Share or VoiceOver speech. Genuine pointer
hover remains untested because the available computer-use API has no hover action.
