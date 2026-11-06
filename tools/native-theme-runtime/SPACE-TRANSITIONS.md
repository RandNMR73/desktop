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

The existing 250 ms workspace spring is retained. Its full time curve against
Arc's native paging spring and a physical trackpad comparison remain unverified;
these checks do not certify complete animation or browser parity.
