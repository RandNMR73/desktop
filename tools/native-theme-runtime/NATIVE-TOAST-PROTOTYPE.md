# Native copy-notification prototype

This branch remains experimental and is not installed in regular Zen. The
separately merged Space-background handoff is the production build.

The notification now uses an AppKit view above Gecko rather than a separate
child panel. A sibling paint view keeps AppKit's private material sublayers
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
- The browser candidate launched on its synthetic profile, but computer use
  reported `cgWindowNotFound` after selecting its fixture tab. Its initial
  inactive capture also showed a white background. These remain unresolved;
  the standalone window does not establish Gecko integration or startup parity.

Do not install or merge until direct browser visibility, input, hover, animation,
all-Space Arc comparisons, accessibility and lifecycle checks pass. The installed
regular app and its native library were not replaced by this prototype.

The private validation folder is `native-copy-toast-2026-10-27`. Web screenshots,
profile data and browsing history are excluded from this branch. RuntimeProbe
is a diagnostic app; its control layout is not part of the browser UI.
