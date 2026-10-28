# Gradient capture rendering

The live page displays correctly in Arc and Zen, but Zen's software snapshot
turns thin repeated lines into broad dark bands. The same defect affects the
built-in Gecko screenshot implementation, independent of the new capture UI.

`nsCSSGradientRenderer::Paint` normalizes the software gradient line to the
first/last stops. Its direct sRGB branch also normalizes the stops, but its
color-managed/interpolated branch previously passed positions in the original
box coordinates. For a repeat every 80 pixels in a 2000-pixel element, this
compresses the gradient into 4% of each repeat and extends the final color over
the rest. It also omitted the supplied paint opacity.

The patch normalizes a copy of the input stops before interpolation, so the
interpolation sampling density follows the normalized period as well. It applies
paint opacity to the emitted colors. Already-normalized gradients avoid the
copy. WebRender's existing live-page path and the original stop array are
unchanged. The existing Zen frame-aware color conversion remains intact.

## Evidence and limits

- The unmodified 158.0.1 engine fails 36/40 gradient cases with color management
  enabled. With color management disabled at process startup, all 20 sRGB cases
  pass; the interpolated Oklab cases still fail except for degenerate gradients.
  This preference change was diagnostic only and was restored afterward.
- Tests cover 1x/2x capture, short/tall repeats, negative origins, transparency,
  stops outside the box, degenerate periods, radial/conic gradients, color ramps, and opacity
  relative to an independently rendered solid-color layer. They inspect real
  `drawSnapshot` pixels rather than mock capture data.
- Arc's native full-page capture of the small diagnosis fixture retains the
  expected line spacing. Initial raw samples (white 255, black 1, translucent
  gray 218) came through Gecko's clipboard conversion, which discarded Arc's
  native display profile. They must not be interpreted as sRGB color errors.
  A separate capture saved through Preview retains the profile; after converting
  it to sRGB, sampled red, blue and gray backgrounds match Zen. A green-channel
  and edge-antialiasing difference remains. This color-profile qualification
  does not change the independently observed gradient-position defect.
- The pinned overlay applies cleanly. **The corrected C++ engine has not been
  compiled, installed, or verified in a running browser.** The baseline files
  deliberately record failures; they are not passing results for this patch.
- A full engine build is required. A UI-only bundle update cannot apply this
  change. Desktop Actions dispatch currently returns “Actions is disabled for
  this repository”; local free space is below the full-build requirement.

## Validation

Verify only the pinned patch application:

```sh
python3 tools/capture-gradients/verify_overlay.py --download
```

After importing the overlay and compiling the engine, run the registered browser
test with color management set before startup:

```sh
cd engine
./mach mochitest zen/tests/capture/browser_gradient_snapshot.js --setpref gfx.color_management.mode=1
```

Repeat from a fresh process with `--setpref gfx.color_management.mode=0` for the
direct sRGB control. The test explicitly requests Oklab as well, so it exercises
the corrected interpolation path even without color management. Inspect the
native capture in Arc and the rebuilt Zen before promoting the app.

For color comparisons, preserve native image metadata when saving the Arc
reference, then convert both images to the same explicit color space before
sampling. Do not compare untagged clipboard-converted RGB bytes directly with
a tagged display-profile image. Keep personal display profiles and reference
images outside the repository.

This addresses capture fidelity; it does not certify full Arc parity or faster
overall browsing.
