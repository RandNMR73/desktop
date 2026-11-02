# Experimental macOS Display P3 rendering

This branch starts a wider-gamut output path to address the measured difference
between Arc and Zen on Display P3 content. It is incomplete, disabled by default,
and has not been linked into or installed as a browser release. Do not enable
`gfx.color_management.native_p3` in managed preferences yet.

## Current scope

The experiment adds a Display P3 output profile and matching macOS IOSurface and
solid-layer color-space tags. `ToDeviceColor(StyleAbsoluteColor, frame)` can retain
the original gamut instead of first clipping it to an 8-bit sRGB `nscolor`.
Frames with Boost color filters retain the existing filter path.

Ordinary and table background display items now retain device-color floats,
including their invalidation geometry. Background resolution can return the
original gamut after applying visited-link color selection; visited alpha is
always taken from the unvisited style. The existing sRGB return value remains
available to callers that have not migrated. Printing overrides and custom
scrollbar colors pass through the same background decision logic.

Background raster fallback and `background-clip: text` use the retained device
color too. The sRGB-only uniform-color optimization is skipped for experimental
P3 output so it cannot replace the retained color with a clipped value.
Canvas/root backgrounds now carry the same device colors through body
propagation, alpha composition, scrolled and stationary backgrounds, and the
no-frame-tree fallback. Solid-color display items and anonymous find-highlight
regions retain device colors and use float invalidation too. Compositor color
animation still needs separate migration and validation.

The opt-in requires macOS, full color management, and no `force_srgb` override.
The new preference is read at startup. Existing output behavior is retained when
it is disabled. The current experiment is for an isolated test profile with
fixed color-management settings for the entire browser session.

## Independent conversion check

On an Apple Silicon Mac, run with a fresh output directory:

```sh
python3 tools/wide-color-rendering/verify_output_profile.py \
  --engine /absolute/path/to/prepared-gecko-checkout \
  --output /absolute/path/to/new-validation-directory \
  --rustc /absolute/path/to/rustc
```

This compiles the checkout's actual qcms library and compares its sRGB-to-P3
conversion against macOS CoreGraphics. It also checks exact alpha preservation
and P3 identity transforms. It does not drive or capture either browser.

The November 2, 2026 run passed 4,096 RGB comparisons with a maximum difference
of one 8-bit channel value, plus 20,480 identity/alpha cases. See
[the recorded conversion result](profile-reference-2026-11-02.json).

The modified C++ and Objective-C++ translation units compiled with the existing
release clang 22.1.8 toolchain and macOS 26.5 SDK. Modified functions triggered
expected stale PGO-profile warnings; this is compile validation, not a new
optimized release or an end-to-end rendering test.

When compiling individual unified targets, force the generated input as newer
with `make -W Unified_….cpp target.o` (or the `.mm` equivalent). An isolated
target invocation can otherwise report an old object as up to date without
recompiling included files. Verify the resulting object's modification time.

## Background rendering tests

The [WPT fixtures](../../src/testing/web-platform/tests/css/css-color/astral-wide-background/)
compare CSS backgrounds with independently tagged PNG swatches. They cover
ordinary and table backgrounds, currentcolor, alpha, rounded clipping,
visited-link alpha and repainting between two P3 colors that both clip to sRGB
red. The PNGs contain exact RGBA samples and an explicit Display P3 ICC/CICP or
sRGB tag; they do not derive their expected colors from the browser's conversion
implementation.

Regenerate the reference images on macOS with:

```sh
xcrun clang++ -std=c++17 -O2 tools/wide-color-rendering/create_reference_images.mm \
  -framework CoreGraphics -framework CoreFoundation -framework ImageIO \
  -o /tmp/zen-p3-reference-images
/tmp/zen-p3-reference-images \
  src/testing/web-platform/tests/css/css-color/astral-wide-background/resources
python3 tools/wide-color-rendering/verify_reference_images.py
```

Five additional pairs cover root color, body propagation, root alpha, root
repainting and transparent iframe composition. These bring the fixture set to
eight reftests and their references.

The PNG sample/profile checks, WPT lint and 779 existing source tests passed.
The affected layout translation units compiled. The WPT rendering tests
have **not run in a linked candidate**. Run them with both the default output
and experimental P3 output before enabling the preference; a pass on an sRGB
output surface alone cannot prove preservation of out-of-sRGB colors. Check
native Arc/Zen captures too, since image and CSS paths can share output bugs.

## Required before enabling

- Preserve `StyleAbsoluteColor` through remaining text, borders, shadows, SVG,
  animation and Canvas 2D paths. Several of these still
  discard the gamut before reaching `ToDeviceColor`.
- Audit gradient preprocessing, tagged images, readback and print/PDF output.
- Keep visited-link alpha rules, printing overrides and Boost application intact.
  Audit invalidation and uniform-color optimizations for P3-only color changes.
- Make profile selection and native surface tags remain consistent across
  runtime preference changes, new content processes and test mode overrides.
  The current opt-in checks live mode/force-sRGB settings while output profiles
  and pooled surfaces are cached; runtime changes are not supported yet.
- Check consumers of output ICC bytes, since the built-in CICP profile does not
  currently populate the output-profile byte buffer.
- Link and run an isolated candidate. Compare ordinary sRGB and Display P3
  fixtures in Arc and Zen across all painting paths, alpha/compositing cases,
  Spaces and command menus. Verify ordinary sRGB colors do not become saturated.
- Re-train and validate the final optimized build before any production install.

The conversion check and object compilation establish only the foundation.
They do not establish Arc visual parity, complete wide-color support or a
performance improvement.
