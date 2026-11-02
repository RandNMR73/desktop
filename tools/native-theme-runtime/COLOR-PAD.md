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

## Handle gestures

Arc's model sets `isSelected` only for index zero (`0x1017a7874`). It has no
mutable selected index or select-knob action. Nevertheless, every knob has a
zero-distance drag with `GestureMask.all` (`0x1017b7668`). Its handler
(`0x1017b7834`) adds pointer translation to the grabbed knob's original center
and sends the same primary-color action. A secondary grab therefore adopts
that color and derives the companions again; it does not swap knob identities.
The background gesture (`0x1017b771c`) sends its location continuously.

The candidate now follows those semantics, preserves off-center grab offsets,
and removes the broken ID swap and right-click deletion. Mouse release,
window blur and closing the editor clear the gesture. A post-drag click cannot
apply the edit twice. Arc's 40/24-point circle frames and centered 5/3-point
white strokes produce 45/27-point outer diameters. Hover scale is 1.1 about
the center and is shared across the handles, as in Arc's view state.

This checkpoint passes 658 source tests, including six gesture cases. An
owned headed fixture exercises all three handles in each of five Spaces,
continuous background edits, stable IDs, right-click preservation, close
during drag, native rendering retention and exact saved P3 reopening. It
also measures the packaged CSS dimensions and hit-testing state. Native
Space-menu activation opens the editor, but the available window screenshot
omits its separate popup. These checks do not certify physical dragging,
popup pixels, hover timing, shadows or animation parity.

## Work remaining before installation

- Match Arc's editor layout, pad size, preset catalog and controls.
- Match handle hover/position springs, shadows and final rasterization.
- Connect per-Space appearance changes to the range model.
- Replace the legacy preset and empty-theme paths with the same color model.
- Match derived text, control and icon palettes after edits; the background
  now renders the saved P3 model natively, while some UI still uses legacy RGB.
- Verify physical dragging, popup composition and resizing, and investigate
  the one intermittent button-state failure.

No full visual parity or browser-wide performance advantage is claimed.
