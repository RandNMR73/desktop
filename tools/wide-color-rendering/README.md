# Experimental macOS Display P3 rendering

## Current integration status — November 7, 2026

PR195 now includes the installed Space-swipe/search release (`e8057891f`).
All 1,189 source tests pass after the merge and selection-paint follow-up.
The current 37 native patches reconstruct against the pinned Gecko base.
The integrated release build has compiled the Rust style engine and regenerated
its bindings; C++ compilation and final linking are still in progress. This
integration has not been installed. Earlier native results below describe
their recorded candidates.

A fresh test of the **installed engine**, with P3 enabled only in a disposable
profile, matches 11 of 13 whole-page image references exactly. The ordinary
output run matches 10. P3 corrects the root-alpha reference; rounded background
edges still differ, and the text, text-shadow and Canvas P3 interiors still
clip. The text work in this draft is absent from that installed engine.
Borders, SVG fills/strokes, blurred box shadows and their visited/repaint
fixtures match in the P3 audit. Visited-style privacy passes and the fixture
is stopped. These are content screenshots, not physical-display measurements
or proof of wide-gamut output. See the
[installed-engine audit](installed-engine-audit-2026-11-07.json).

The next native candidate must combine this branch with the current release
and repeat the text/SVG/fallback comparisons. SVG selection inheritance and
transformed shadows remain unresolved, and Canvas P3 is still unimplemented.
Both the P3 and macOS font-metric preferences remain disabled in production.

### SVG selection state

The draft now keeps independent initial-paint flags for SVG fill and stroke.
Equal-value assignments retain the previous flag, including an `initial`
assignment after inherited noninitial black. Style copies preserve both flags,
and differences request repaint even when the paint values are equal. These
rules reproduce the state distinctions observed in the saved Arc inheritance
cases; comparing only the final black/none values cannot do so.

Ten tests compile and execute the actual Mako-generated setters with isolated
paint-value stand-ins. The changed native style translation unit passes the
release compiler's syntax check. Neither check regenerates the Rust/C++ ABI
or validates a linked browser. To reproduce the setter check:

```sh
python3 tools/wide-color-rendering/verify_svg_paint_state.py \
  --engine /absolute/path/to/prepared-gecko-checkout \
  --output /absolute/path/to/new-validation-directory
```

Two new WPT reftests contain 48 clipped glyph-interior cases, with references
derived from saved native Arc observations. A fresh capture using the installed
engine in a disposable profile matches 7/24 paint cases and 9/24 inheritance
cases. Both unselected controls match. The mismatches are expected: highlight
property filtering and inheritance still need to supply the correct state to
the new drawing path. These references are compatibility tests, not a claim that all
the observed equal-value quirks are required by the web standard. See the
[case references](svg-selection-reference-cases-2026-11-07.json) and
[validation record](svg-paint-state-validation-2026-11-07.json).

### SVG selection drawing

The draft now carries separate selection fill and stroke styles through each
selected text segment and its shadow mask. SVG drawing uses those styles for
paint, opacity, stroke geometry and color resolution; initial paint retains
the originating element's paint. The segment state is cleared before drawing
decorations or the next unselected segment. Selected SVG text uses the path
renderer, including text with no normal fill or stroke.

Selection gradients and patterns have their own URL-keyed observer collection,
so they do not replace the normal fill/stroke resource observers. Resource
changes, removal and later insertion can therefore invalidate the painted
frame. The collection is released with the frame or when its effects reset.

All three affected native translation units pass release-compiler syntax
checking with the current draft headers and sources. All 32 native patches
apply to the pinned engine and reconstruct the checked source exactly. These
checks do not validate a linked browser, regenerated bindings, selection
inheritance, or rendering parity. The draft is **not installed**.

A new repaint reftest covers mutated patterns and gradients, inserted and
removed paint servers, and selected/unselected glyphs sharing one text frame.
The installed-engine baseline fails all five selected samples and passes both
unselected controls. This is failure evidence, not a result from the new code.
The successful capture is headless; the first windowed attempt timed out while
focusing its test window. See the
[drawing validation record](svg-selection-paint-validation-2026-11-07.json).

### SVG selection inheritance

The draft enables highlight fill/stroke declarations and resolves their paint
through the corresponding ancestor highlights, including ancestors with no
matching rule. The walk is iterative. A derived cascade parent retains the
originating element's custom properties and non-SVG values while taking SVG
paint from the parent highlight; the visited style remains separate.

Painting and CSSOM share this resolver. Its document cache uses element identity,
pseudo identity and originating style, and is cleared when the undisplayed
restyle generation changes. Persistent caching is bypassed during a style
refresh. The older ComputedStyle entries remain available for restyle comparisons,
but highlight resolution does not read ancestor-dependent values from them.
Existing highlight invalidation already requests a document-wide selection
repaint; the cache must supply fresh paint when that happens.

Release compilation of `style`, `geckoservo`, `gkrust-shared` and `gkrust` passes
with actual regenerated bindings. The C++ style-set translation unit also
passes a syntax check against those bindings. The full native build is still
running, so there is no linked-candidate rendering result yet.

The new inheritance-repaint fixture covers ancestor class changes, CSSOM rule
edits, initial/black state, originating-element variables, reparenting and a
new ancestor rule. Its installed-engine baseline matches 2/8 samples, including
the unselected control; six mismatches expose the missing behavior. These are
new regression cases derived from cascade/state rules, not new Arc captures.
See the [inheritance validation record](svg-selection-inheritance-validation-2026-11-07.json).

Next, exercise the combined native candidate against all 48 saved Arc selection
cases and both repaint fixtures. General highlight color/currentColor inheritance
beyond SVG paint, overlapping highlights, stroke edges, transformed shadows,
privacy and default-output behavior still need integration coverage.

An additional baseline runs nine existing upstream highlight pages against the
installed engine in a disposable headless profile. Twelve of 30 CSSOM assertions
pass: 15 failures concern unsupported pseudo types, and three expose missing
highlight inheritance. Three of six rendered references match exactly. The
remaining differences cover inherited selection colors, root highlight defaults,
and overlapping highlight colors. These baseline failures must be compared with
the pending candidate; they are neither new-code results nor fresh Arc captures.
The fixture stopped successfully. See the
[highlight regression baseline](highlight-regression-baseline-2026-11-07.json).

## Experiment history

This branch starts a wider-gamut output path to address the measured difference
between Arc and Zen on Display P3 content. It is incomplete and disabled by default.
The initial candidate was built and tested separately; its code is also present
but disabled in the installed physics/search release. The composition changes
below are built and checked in a separate native candidate. Remaining painting
paths are incomplete, so do not enable `gfx.color_management.native_p3` in
managed preferences yet.

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
eight reftests and their references. Root image references repeat their tagged
pixel instead of stretching a single pixel across the viewport.

## Native composition follow-up

The initial candidate at `120afed29` matched Arc's flat color samples in six of
eight cases when P3 output was enabled. The corrected harness explicitly selected
a normal tab and verified the visible URL; initial empty-tab root-alpha captures
and an intermediate hidden-tab run are excluded from normal-page conclusions.
These are Sky sRGB JPEG samples, not wide-gamut preservation or full pixel proof.

Two remaining differences led to the changes in this branch:

- Arc retains visited RGB even when the visited color has zero alpha, while
  always using unvisited alpha. Both integer and float paint paths now follow
  that rule. A third visual case checks that zero unvisited alpha stays invisible;
  a script test checks that computed styles and selectors still conceal history.
- Chromium's root painter precomposes the root color and base background in
  extended sRGB before output conversion. P3 output now uses that composition
  space rather than blending display-space components. Opaque colors and
  transparent backstops retain their existing values. The new opaque root-alpha
  PNG is independently calculated with CoreGraphics; ordinary element alpha
  continues to use the existing rendering path.

The pinned Chromium reference is
[`Color::Blend`](https://chromium.googlesource.com/chromium/src/+/a5de7e8894913ee20caf97ca5e0935a6ddf37e8c/third_party/blink/renderer/platform/graphics/color.cc),
called by
[`ViewPainter::PaintRootElementGroup`](https://chromium.googlesource.com/chromium/src/+/a5de7e8894913ee20caf97ca5e0935a6ddf37e8c/third_party/blink/renderer/core/paint/view_painter.cc).
Visited color selection follows
[`ComputedStyle::VisitedDependentColor`](https://chromium.googlesource.com/chromium/src/+/a5de7e8894913ee20caf97ca5e0935a6ddf37e8c/third_party/blink/renderer/core/style/computed_style.cc).
Separate effects on the root and out-of-P3 colors still need runtime verification.
These changes do not establish parity.

Before linking, seven PNG sample/profile checks, lint for 25 fixture files and
779 existing source tests passed. Both changed unified translation units passed
syntax checks through a virtual source overlay without changing the active build.
After merging current `astral`, 786 source tests passed.

The combined candidate at `b77993ed` then built successfully with profile-use and
ThinLTO. With experimental P3 output, the eight original background cases now
match their independent reference interiors exactly and the prior same-version
Arc samples within one 8-bit channel value. Root alpha changed from the previous
incorrect element-style blend to the expected root blend. Both visited-color
cases match, and the zero-unvisited-alpha control remains white. Normal output
still clips P3 colors and does not match the Arc root-alpha reference.

The actual privacy testharness completed successfully in both output modes. A
first P3 visited screenshot happened before history registration and is excluded.
Fresh profiles then inserted only the exact localhost fixture URL into Places,
awaited `hasVisits`, and navigated normally before capture. Those seeded runs
verified the visited colors and privacy checks without forcing rendering state.
The complete WPT screenshot runner has not run; native interior samples are not
a full reftest pass. See the
[linked candidate results](linked-composition-validation-2026-11-02.json).

## Remaining painting-path controls

The `paint-paths.html` reftest adds eleven Display P3 cells for text, borders,
outlines, outer/inset shadows, SVG fill/stroke, gradients, Canvas 2D, a paused
background animation and text shadows. A twelfth sRGB Canvas cell is a control.
Its reference uses the independently tagged PNGs above, and Ahem font loading is
completed before the test becomes ready.

Native Arc 1.171.0 and the installed Zen release were checked with the same
fixture. All eleven orange cells agreed with their image references within each
browser, but Arc's JPEG interiors were RGB `(254, 77, 0)` while default-output
Zen's were `(234, 74, 38)`. The blue control agreed at `(0, 0, 236)`. This is an
observed output difference, and also demonstrates why a reference match on
Zen's current output surface cannot establish wide-gamut preservation. These
samples do not prove full pixel or display-profile parity.

Zen also reports `srgb` for a Canvas 2D context requested with `display-p3`, and
reports false for the P3 gamut media query. The new fixture passed WPT lint;
the merged source passed 786 existing tests. See the
[painting-path control record](paint-path-control-2026-11-02.json).

In the linked P3 candidate, the gradient, paused background animation and sRGB
control agree with the image references. The other nine cells still clip the
color before output conversion. These failures are recorded in the linked
candidate results; P3 remains disabled in production.

## Border, shadow and SVG follow-up

The next experimental change retains device-color floats for solid, dotted and
dashed borders, outlines, outer/inset box shadows, SVG fill/stroke, paint-server
fallback colors and inherited marker context paint. Raster shadow masks and their
cache keys carry the converted color without another sRGB conversion. Border
color comparisons use the retained floats. The default output path continues to
use its existing color resolution; visited SVG colors retain unvisited alpha.

`paint-details.html` adds twelve cells for currentcolor, alpha, SVG fallback and
marker context paint. `paint-details-repaint.html` changes ten of these between
P3 colors that both clip to the same sRGB red. Their references use the existing
independently tagged PNGs. In native Arc, all 22 sampled interiors agree with the
references exactly in Sky's sRGB JPEG captures. This establishes the fixture
baseline, not a pass for the new Zen implementation or full pixel equivalence.

The eleven source patches apply exactly to the pinned engine base. Four affected
unified C++ units pass the release toolchain's syntax checks, the 30 fixture text
files pass WPT lint, and 786 existing source tests pass. See the
[paint-path validation record](paint-path-validation-2026-11-02.json) for object
compilation and the remaining runtime checks. These changes have not been
installed or enabled in production.

Two further fixtures exercise nonzero outer/inset blur, alpha, repainting,
and visited colors in borders, outlines and SVG. Arc matches their 18 additional
sampled interiors exactly, including the invisible unvisited-alpha controls.
The expanded script privacy test passes in both output modes of the previous
`b77993ed` candidate with seeded localhost history. Those runs also confirm
fixture readiness, but do not test the new implementation or rendered pixels.

Raster light/dark shading for inset, outset, ridge and groove borders still uses
the legacy sRGB shade calculation. Text, text shadows and Canvas 2D remain
unmigrated. New browser comparisons must cover both output modes, nonzero blur,
visited colors, Boost filters, printing and the new repaint fixtures before this
part of the experiment can be considered validated.

## Text color follow-up

The text experiment retains absolute colors for ordinary text, WebKit text fill,
authored selection/highlight foregrounds and backgrounds, text shadows and text
strokes.
Resolved print, contrast and Boost overrides remain authoritative. Device-color
alpha is retained through glyph painting, stroke rasterization and selection
rectangles. The decoration and SVG callback follow-ups are described below.

It also corrects ordinary text-shadow `currentColor` resolution to use CSS `color`
when WebKit text fill differs, including transparent fill. This correction applies
in both output modes; the extra shadow-color lookup is skipped when no shadow is
present. `text-shadow-currentcolor.html` supplies a separate sRGB regression with
an opacity case, independent of the experimental output preference.

`text-paint.html` covers sixteen text, shadow, repaint, selection and highlight
cells. Each cell clips independently so a selection rectangle cannot overlap the
next sample. All sixteen Arc interior samples exactly match the independently
tagged image references. The earlier Zen P3 candidate clips the text colors and
omits the currentColor shadow with transparent fill. These are baseline failures,
not runtime results for the new code. The initial unisolated Arc selection
background overlapped a neighboring cell; that capture does not justify changing
the selection alpha calculation.

`text-stroke.html` adds eight explicit/currentcolor, alpha, opacity, repaint,
partial-selection and sRGB-control samples. All eight Arc interiors match the
independent image references exactly. The previous Zen candidate fails all seven
wide-color cases while its sRGB control matches. Both native output modes also
reproduce the missing currentColor shadow; Arc matches both shadow cases against
an explicit-color shadow reference. The reference isolates color resolution from
the separate compositing difference between a text shadow and a background box.
These comparisons cover sampled interiors, not glyph edges or full reftests.

The eleven text patches round-trip exactly against the pinned engine base. Four
affected C++ units pass release syntax and object-compilation checks using
isolated source overlays. All 42 fixture text files pass WPT lint and the 786
existing source tests pass. See the
[text validation record](text-validation-2026-11-02.json) for exact results and
remaining checks. The combined `cc4074f6b` baseline has since been linked and
compared natively in both output modes. In P3 mode, 69 of 70 text sample centers
match Arc; text opacity and glyph-edge differences remain. It is not installed.
See the [linked validation record](text-linked-validation-2026-11-03.json).

`text-decoration.html` adds twenty underline, overline, strike, emphasis,
selection, repaint and fill/stroke fallback samples. `text-decoration-visited.html`
adds twelve direct-link cases with visited/unvisited alpha differences. All 32
Arc interior samples match their independent references. The fallback follows
[Chromium's decoration color resolution](https://github.com/chromium/chromium/blob/a5de7e8894913ee20caf97ca5e0935a6ddf37e8c/third_party/blink/renderer/core/style/computed_style.cc#L2466),
resolving each history style independently before retaining the unvisited alpha.
Computed-style privacy coverage now includes decoration, emphasis, text fill and
text stroke properties. Initial nested inherited-color probes are retained as
experimental evidence; the committed visited fixture applies colors directly.

Arc clips decoration-only text shadows
through sRGB while ordinary glyph shadows retain wide colors. The independent
shadow reference uses the analytically clipped sRGB color and matches Arc.
[Chromium's drop-shadow filter](https://github.com/chromium/chromium/blob/a5de7e8894913ee20caf97ca5e0935a6ddf37e8c/cc/paint/paint_filter.cc#L391)
confirms its integer-color conversion. The experimental Zen implementation now
retains separate glyph and decoration shadow colors. WebRender switches shadow
groups around underlines/overlines, glyphs/emphasis, and strikes; raster fallback
uses the same three shadow phases. The clipped color is converted back into the
native output space without an additional byte-quantized output transform.

`text-decoration-shadow.html` adds twelve isolated shadow interiors for the three
decoration lines, blur, alpha, opacity, repeated shadows, currentcolor, glyphs,
emphasis and an sRGB control. All twelve match the native Arc references. Arc's
half-opacity decoration shadow matches the 8-bit alpha value 128/255; a reference
using an unquantized CSS opacity of 0.5 differs and is retained in the local
evidence. Initial whitespace-only underlines and emphasis did not paint and were
replaced by glyphs positioned outside the sampled area. The strike control keeps
a nonbreaking space to isolate its decoration from the glyph shadow.

Both changed unified units compile with the release compiler. Native tests now
cover the linked text baseline's 70 sampled interiors and identify remaining
opacity and edge differences. Overlapping shadow groups and raster/WebRender
equivalence remain under investigation.

## SVG text callback follow-up

SVG text uses a separate callback path for strokes, paint servers and some
opacity cases. The callback retains device-color floats, follows paint order
when choosing shadow geometry, and preserves pattern/gradient alpha masks.
Shadows ignore fill/stroke opacity but retain paint-server alpha. These changes
apply in both output modes; wider color output remains disabled by default.

The optimized `7b591ae` candidate built, packaged and passed signature checks.
Native captures cover 52 SVG cases in each output mode. P3 output improved Arc
sample-center matches from 21/52 to 41/52 and full candidate/reference tiles
within one channel value from 14/52 to 35/52. Default output improved those
counts from 8/52 to 23/52 and from 16/52 to 36/52. All eight shadow-opacity
cases match. The 122 existing text/paint samples retain their prior center
measurements and full-tile differences; visited-style privacy passes in both
modes. These are focused native captures, not complete page or browser parity.
See the [linked SVG validation](svg-linked-validation-2026-11-03.json).

Remaining native failures include pattern color-space, blurred stroked shadows,
underline placement, authored selection fill/stroke, shifted pattern/gradient
masks, zero-opacity stroke geometry, and paint-order edges.

The next correction sends SVG shadow callbacks to the actual drawing surface,
including the separate blur surface, and moves paint-server coordinates with
the shadow. It also keeps stroke geometry available for zero-opacity shadows
without making the normal stroke visible. Both affected C++ units compile and
all three patches reproduce their validated overlays. This follow-up is not
linked or installed. Existing fixtures cover the observed failures; translated,
scaled, rotated, non-scaling-stroke and thick blurred masks require additional
native verification. See the
[shadow-context validation](svg-shadow-context-validation-2026-11-03.json).

## Fallback bitmap opacity

The native text-stroke opacity mismatch comes from applying inherited opacity
inside an eight-bit Skia bitmap before compositing it. Applying alpha to the
stroke color or to a separate compositor filter matches Arc; forcing opacity
out of the bitmap with a transparent decoration also removes the mismatch.

The follow-up applies inherited opacity through the WebRender image color after
rasterization. It keeps existing bounds, clipping and invalidation behavior and
avoids the intermediate Skia opacity layer. No performance improvement has been
measured. The patch round-trips against the pinned source and its unified release
unit compiles; it has not been linked or installed.

`fallback-opacity.html` and its repaint variant each compare 48 combinations of
sRGB/P3, translucent paint, overlapping fill/stroke, large glyphs, and six opacity
values against compositor-filter references. Arc matches every full tile
exactly. The linked Zen baseline differs by more than one channel value in 13
of 48 tiles. References render fully opaque cases directly, avoiding the extra
rounding Arc itself introduces with an unnecessary `filter: opacity(1)` layer.
The six new fixture files pass WPT lint. The
[fallback validation record](fallback-opacity-validation-2026-11-03.json) retains
both native baselines, capture hashes and the required follow-up checks.

A separate glyph-metric probe measures a 64 CSS-pixel Ahem line box in Arc and
64.5 in Zen. This contributes to the different clipped stroke edge; no font
metric workaround or page-specific CSS adjustment is included.

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
- Extend the isolated candidate comparisons across ordinary sRGB and Display P3
  fixtures in Arc and Zen across all painting paths, alpha/compositing cases,
  Spaces and command menus. Verify ordinary sRGB colors do not become saturated.
- Re-train and validate the final optimized build before any production install.

The conversion check and object compilation establish only the foundation.
They do not establish Arc visual parity, complete wide-color support or a
performance improvement.
