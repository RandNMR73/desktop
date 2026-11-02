# Space color pad: draft implementation

Opening an imported theme previously divided fractional saturation by 100,
used a fixed 380-point pad, and shifted the rendered dots by another 10 points.
The candidate instead maps the original Display P3 colors into the actual pad
dimensions. Opening or dismissing the editor does not rewrite the saved theme.

This is a draft, not a complete Arc editor or an installed production change.

## Reference

Read-only inspection of Arc 1.171.0 (89666), executable SHA-256
`e82d2a4245b6239860e41a149cb31c0c030e35b383456544c81f21d45ee03376`:

- `SpaceStyleColorPadState`, `0x1017a76c8`: hue determines angle; normalized
  radius is `.99 * clamp((lightness - low) / (high - low), 0, 1)`.
- Inverse conversion, `0x1017a79ec`: angle determines hue; radius interpolates
  the lightness range; saturation remains fixed. Output is Display P3 HSL.
- Automatic range, `0x1017a9bb4`: `[max(.01, L - .25), min(.97, L + .25)]`.
- Initialization, `0x1017a87f0`: saturation is at least `.01`; explicit dark
  range is `[.01, .425]`, light range `[.575, .97]`, expanded to contain the
  original primary color. Automatic appearance remains separate from the
  browser's global chrome appearance.

The installed harmony change already supplies analogous `+40/-40` and
complementary `150/210` three-color relationships. Two-color relationships use
`+40` and `180`. This draft preserves those relationships in the new coordinates.

`ColorPadPaletteProbe.swift` converts the imported extended-sRGB colors using
AppKit at resource-build time. The browser accepts bundled editor colors only
when both the Space UUID and complete saved theme match. Edited colors retain
their P3 values alongside the legacy 8-bit fallback. Late native resource
results cannot modify a closed, switched, reopened, or already edited picker.

## Validation

The five primary colors from the Swift probe exactly match an independent
Objective-C AppKit reference. The portable conversion fallback is separately
checked within `3e-4`, since it is not the macOS color-management implementation.
The reference inputs and values are in
`scripts/tests/fixtures/theme-color-pad-appkit.json`.

The owned headed browser fixture checks all five Spaces: read-only opening,
rendered handle centers, fixed-saturation radial edits, P3 persistence, and two
harmony families through repeated 1/2/3-color changes and reopening. Mouse and
click events in these checks are programmatic DOM events, not certified native
pointer gestures. An initial maximum-color button assertion failed once and
could not be reproduced in the two subsequent full runs; its cause remains
unresolved. Native context-menu inspection also lost the menu before activation.

The coordinate-only checkpoint passed 647 source tests and 23 final targeted
tests. Its live rendering follow-up passes 651 source tests and 61 final
targeted checks, with five packaged source members matching this source tree.
See [live native rendering](DYNAMIC-THEME.md) for its separate evidence.

## Work remaining before installation

- Match Arc's editor layout, pad and handle sizes, preset catalog and controls.
- Connect per-Space appearance changes to the range model.
- Replace the legacy preset and empty-theme paths with the same color model.
- Match derived text, control and icon palettes after edits; the background
  now renders the saved P3 model natively, while some UI still uses legacy RGB.
- Correct selection and dragging of secondary handles; the legacy path still
  contains an incomplete primary-ID swap and does not persist selection.
- Verify physical dragging, popup composition and resizing, and investigate
  the one intermittent button-state failure.

No full visual parity or browser-wide performance advantage is claimed.
