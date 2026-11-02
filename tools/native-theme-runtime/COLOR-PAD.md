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

## Appearance refresh without color writes

The top appearance buttons dispatch `didSetAutomaticAppearance`,
`didSetLightAppearance` and `didSetDarkAppearance` delegates (constructors
`0x1017bb774`, `0x1017bb724`, `0x1017bb6d4`). A separate reducer action remaps
the color range. Their complete parent relationship remains under investigation;
the earlier assumption that the buttons simply change a per-Space range was
incorrect.

Zen's existing global preference observer called the color-save path, even
with the editor closed. It could serialize stale handles into the active Space.
The observer now refreshes rendering from saved themes and invalidates all
Space gradient caches without reading or writing editor controls. Gradient
calculation takes the rendered theme's intensity and no longer replaces the
editor's harmony or lightness. Unsaved edits to another Space survive changes
in either browser window.

Two regression cases fail against the preceding source revision and pass now.
The full suite passes 661 tests. An owned headed fixture passes 45 appearance
changes across all five Spaces, including closed, open/edited and inactive-Space
editors; a two-window fixture passes three more global changes. P3 values,
handle identity, coordinates and pending edits survive, and closing saves once.
This validates data preservation, not final Light/Dark rendering parity. That
renderer limitation is addressed by the follow-up in [live rendering](DYNAMIC-THEME.md).

## Preset catalog and P3 selection

Arc's `SpaceStyleColorPickerView` catalog constructor (`0x1017bdd34`) creates
45 entries in five pages: nine Brand solids, the same nine with two analogous
companions, then nine each of Pastel, Drab and Greyscale. The Brand entries come
from `ARCClients_BaseAssets.bundle`; the other named colors come from
`ARC_SpaceStyleEditor.bundle`. An offline AppKit probe resolves all 36 distinct
assets in Display P3. Aqua and Dark Aqua yield identical preset values. Zen
stores those precise values, rather than using legacy 8-bit swatches and
unrelated fixed handle coordinates.

The selection reducer (`0x1017aab28`, continuation `0x1017ab730`) resolves the
primary to P3, sets the companion count and wheel, floors pad saturation at
0.01, and resets the automatic range around the new primary. A forced range
is retained. Noise, texture and intensity remain unchanged. Zen's selection
now follows that path and cancels a pending metadata load or drag. It preserves
exact white/black endpoints and out-of-range preset values until a subsequent
pad gesture. New/empty themes can start with any preset. Reopening retains P3.

The preset strip uses 24-point swatches (`0x1017bebb0`) and 5.5-point gaps
(`0x1017bc590`), giving a 260-point nine-swatch page. Gradient previews run
from top-leading to bottom-trailing at 0.85 opacity (`0x1017be8d8`). The
strip is 32 points high; swatches scale to 1.075 on hover and 0.9 when
pressed (`0x1017beaac`). The catalog supplies the
same primary and +40/-40 degree companions used by the editable wheel.
Native toolbar buttons expose labels and keyboard activation.

Five additional source tests cover the catalog and asset references, gradient
relationships, all selections, forced ranges and selection before native
metadata resolves. Full source suite: 674 passing tests. Headed validation
and packaged-archive evidence are recorded in the companion Astralforge PR.
Preset animation springs and the separate popup's final pixels are not yet
certified.

## Editor geometry and fractional paging

Read-only inspection of Arc 1.171.0's SwiftUI view bodies fixes the pad at
340 × 340 points, with an 8-point corner radius. The outer VStack has 16-point
section spacing and top/leading/bottom/trailing padding of 8/8/16/8. Its content
is therefore 356 × 508 points. The appearance row is 48 points high with
32-point buttons and 8-point gaps, inset 16 points from the pad's top. The
advanced row combines a 224 × 44 slider and 80-point dial, separated by 16
points and padded by 8 horizontally. Its 336-point width is centered.

The continuous preset row reserves hover and edge-mask space: a 274.6 × 32
viewport, 7.3-point insets, 32-point arrows, and a 265.5-point page pitch. The
last includes the gap between pages; dividing total scroll width by five
misaligns the swatches. Paging now uses the difference between fractional page
origins and clamps endpoints. A regression case exercises both directions,
extra endpoint commands and wheel interception.

Gecko's default popup padding would clip the right side of the fixed-width
content. The panel removes that padding and reserves the content width, with
its own one-point border (358 × 510 measured in the disposable build). That
outer border is Gecko geometry, not a verified native Arc popup measurement.
The remove button precedes add, matching Arc's accessibility order.

The source suite passes 675 tests. Companion evidence records rendered layout,
five-Space preset/editing checks and complete overlay reconstruction. These
measurements do not establish final popup pixel parity: the legacy wave/dial
drawing, extra harmony button, icons, materials and springs still need work.

## Work remaining before installation

- Match the remaining controls, wave/dial drawing and native popup composition.
- Match handle hover/position springs, shadows and final rasterization.
- Trace global appearance delegation and the separate forced color-range action.
- Match the remaining appearance-dependent semantic control palettes.
- Replace the remaining empty-pad gesture path with the same color model.
- Match derived text, control and icon palettes after edits; the background
  now renders the saved P3 model natively, while some UI still uses legacy RGB.
- Verify physical dragging, popup composition and resizing, and investigate
  the one intermittent button-state failure.

No full visual parity or browser-wide performance advantage is claimed.
