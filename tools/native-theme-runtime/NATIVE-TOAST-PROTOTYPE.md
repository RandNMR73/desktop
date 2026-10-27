# Native copy-notification prototype

This branch remains experimental and is not installed in regular Zen. The
separately merged Space-background handoff is the production build.

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
- A physical Share click set the native picker-open state, but Gecko's
  accessibility tree omits the native notification and its picker. Escape was
  used to dismiss it. No recipient or service was chosen. Accessible action
  integration remains unresolved and this build must not replace regular Zen.
- A fresh Arc Main Space capture on the same black local fixture differed by
  3.92 and 3.64 RGB levels at two text-free background strips. Captures are
  resized JPEGs with no embedded ICC profile; this is not exact parity.
  Fresh attempts in the other four Arc Spaces did not capture a notification,
  even across consecutive frames. They are not valid color references and no
  conclusion about Arc's notification behavior is drawn from those misses.

Do not install or merge until hover, animation, all-Space Arc comparisons,
accessible notification actions and remaining lifecycle checks pass. The installed
regular app and its native library were not replaced by this prototype.

The private validation folder is `native-copy-toast-2026-10-27`. Web screenshots,
profile data and browsing history are excluded from this branch. RuntimeProbe
is a diagnostic app; its control layout is not part of the browser UI.
