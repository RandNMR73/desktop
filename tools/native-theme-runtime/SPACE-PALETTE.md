# Live Space palettes

Editing a Space previously invalidated its imported palette, leaving menus,
command selections, download controls, Library icons and Little's Space picker
with colors from the original import. Dock icons also recalculated from clipped
8-bit colors. These controls now resolve the primary handle's current Display
P3 color through one native calculator. A new Space needs no saved name or ID.

The optional `zen_space_palette_version()` / `zen_space_palette()` ABI returns
four primary colors and twelve semantic colors per appearance as 112 doubles.
Inputs are bounded sRGB or Display P3; outputs retain extended-sRGB components.
Invalid input leaves the output untouched. Calculation has no Arc dependency,
window access, timers or I/O. A 128-entry process cache uses the primary color
and color space; texture, intensity and secondary handles reuse the result.
Unchanged imports use their exact stored palette, bound to UUID and complete
saved theme. Older libraries retain their existing fallbacks.

The Space lifecycle updates only the relevant control elements. Unchanged
styles are not rewritten. Late Library creation, app appearance changes,
accessibility fallback and window closure are covered. Dock updates during
color-pad gestures do not rebuild the dock or invoke its resize routine.
Little's picker guards asynchronous completion against changes and closure.

## Independent reference

Read-only inspection of Arc 1.171.0 (89666), arm64 executable SHA-256:
`e82d2a4245b6239860e41a149cb31c0c030e35b383456544c81f21d45ee03376`.

- Primary builder `0x100d85a58`: luminance ranges [.85,.95], [.3,.5],
  [0,.5], [0,.1] for tintedLight, midTone, shaded, shadedDark.
- Luminance `0x1009ab2a0`: threshold .03928, weights .2126/.7152/.0722
  in the input RGB space. HSL conversion `0x1009a9574`; shifts
  `0x1009a9ae0` / `0x1009a9be4`; reconstruction `0x1009ab8c0`.
- Semantic builder `0x100d86004`; blend `0x100d73800` uses straight-alpha
  extended-sRGB composition. AppKit reads of BasePrimaryDark/Light in
  ARCClients_BaseAssets.bundle return white/black in both appearances.
- Editor `0x1017a8fe4` passes its primary handle to the primary builder.
  Noise, intensity and other handles do not participate.

Run `python3 tools/native-theme-runtime/test_space_palette.py` on macOS.
It compiles the standalone calculator and compares 560 channels with five
independently saved Arc palettes. Maximum error is 0.000001432 (saved inputs
and outputs are rounded). It additionally checks 432 synthetic colors in
both input spaces, deterministic results, wide-gamut retention and malformed
ABI requests. The saved palettes remain exact through the import fast path.
The owned browser fixture checks five Spaces in both app appearances, edits,
restoration, new Space identity and dock colors. Node tests cover lifecycle,
cache eviction, old-library fallback and stale/invalid input handling.

## Limits

This establishes palette arithmetic and its live UI bindings, not pixel parity
of every material or control. The opaque sidebar command panel still uses its
existing calibrated six-percent neutral lift. Menu hover/divider mapping still
uses the existing P3 composite. Native popup composition, empty/custom-theme
fallbacks, texture artwork and browser-wide performance comparisons need more
work. An uncached calculator timing is not a browser performance benchmark.

## Space heading icons

The icon next to the Space name now uses `maxContrastColor` at full opacity,
through the existing live palette binding. The prior sidebar mask used a fixed
40-percent neutral fill; on the third Space this made the campfire pale pink
instead of Arc's bright tinted white. SVG icons and the configuration's legacy
shape masks share the same color. Dimensions and footer hover behavior do not
change. Unavailable native palettes retain the source fallback.

Read-only Arc captures across all five Spaces support this mapping. A packaged
browser check covers both appearances, SVG fills, legacy masks, dimensions and
two arbitrary P3 edits (42 checks). Before the change, only the ten dimension
checks passed. The third Space's background already agrees within screenshot
rounding at the sampled interior region. These checks do not establish complete
window parity; initial multiwindow captures had different focus states.
