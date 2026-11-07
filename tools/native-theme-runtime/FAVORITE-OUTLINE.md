# Favorite selection outlines

Selected Favorites derive their outline from the image actually displayed in the
app tray. There is no hostname-to-color table. Multicolor artwork retains its
spatial colors; custom icons and Calendar's daily artwork use the same renderer.
The earlier neutral inset border remains only while the image is unavailable or
when the optional macOS native renderer is absent.

## Read-only Arc reference

Arc 1.171.0 (89666), arm64, was inspected without modifying its bundle or data.
The reference is `AppTrayVisualEffectImageProvider`, not a dominant-color picker:

- `0x101d18114`: CIImage from CGImage, CIGaussianBlur radius 5, then
  CIColorControls saturation 1.5, brightness 0.05, contrast 0.85. CIContext uses
  its default color space and creates the CGImage from the expanded output
  extent. Cropping or clamping before the blur changes the result.
- `0x101d18504`: draw that filtered image centered in a 47×47 NSImage. Its
  destination dimensions are `47 / 5 × logicalIconSize` on each axis. The normal
  logical size is 16; app-tray artwork can use 40. The source bitmap dimensions
  and logical icon size are separate inputs.
- `0x101d0d840`, `0x101d0ff98`, `0x101d20c0c`: stretch the image to the selection
  view bounds and mask with an even-odd SwiftUI continuous rounded rectangle:
  outer corner size 12, inner corner radius 10 inset by 2. This is a 2 pt ring,
  not a CSS round-rect stroke. `FavoriteOutlineShape.swift` exports the matching
  outer path for the selected tile's fill.

The supplied Drive screenshot and live Arc selection show its green/blue/yellow
outline. Live Arc also showed Slack's multicolor outline after its icon loaded;
the supplied gray Slack capture is not evidence for a permanent gray exception.
The original screenshot's transient state cannot be conclusively attributed.

## Runtime and limits

A bounded serial native queue performs Core Image work off Gecko's main thread.
It copies input data before returning and never calls Gecko from the worker.
Incoming artwork prewarms selected and unselected Favorites. Duplicate requests
share work; selection prioritizes queued work without cancelling other icons.
Inputs are at most 1 MiB / 512×512 pixels, with five-second decode/render bounds.
The shared data cache holds at most 64 entries / 8 MiB. Each browser window keeps
at most 64 decoded border images resident and clears them on shutdown.

The CSS border remains attached with zero opacity while unselected. Selection
only reveals that existing image. Replacing artwork retains the previous painted
border until the replacement is decoded; explicit removal/unpin clears it. A
per-tab desired/applied key prevents stale work from replacing newer artwork.
The displayed CSS artwork wins over a page favicon, including custom icons and
Calendar's daily artwork. No hostname palette or network lookup supplies colors.

The previous implementation decoded each border and then cleared Image.src,
releasing those pixels before its selected-only CSS first requested them. The
2026-11-06 follow-up retains that decode and the CSS image request together.
Twelve saved real icon assets pass preparation/selection checks in pinned and
floating modes. This does not measure every physical first-paint latency.

## Validation, 2026-11-01

- All 622 source tests passed, including cache sharing, icon replacement/removal,
  stale completion, unpinning, custom artwork and shutdown.
- The native executable passed bounded-queue, cancellation, invalid-data,
  transparency, retina-size, monochrome and spatial multicolor checks.
- The owned headed profile passed 120 paint/fallback checks for 12 icons across
  all five Spaces, plus 10 icon-change/artwork/lifecycle checks.
- Cold request-to-ready time was at most 106.46 ms in that run; subsequent Space
  passes were at most 14.97 ms. These are fixture timings, not a comparative
  whole-browser performance benchmark.
- CUA inspection confirmed Drive and YouTube borders and continuous corners.
- Full and incremental configuration overlays reconstruct every candidate
  archive entry exactly; reapplication is a no-op.

The native filter and shape parameters are directly recovered, but arbitrary
site artwork may differ from Arc's privately packaged high-fidelity assets.
Pixel-identical rendering for every icon, display density and inactive/dimmed
state, and browser-wide Arc parity, are not certified by these tests.

## Reuse across controller lifetimes, 2026-11-06

A window without a local decoded image previously ignored an existing shared
border and loaded, rasterized and filtered the original favicon again. Queued
work now checks the shared cache before loading the source and decodes the
cached PNG through the same bounded, cancellable completion path. The cache
key still includes artwork, logical size, display scale and CSS filter.

`browser-favorite-cache.js` exercises two controller lifetimes with the real
Gecko image decoder and native Core Image renderer. The installed baseline
reloads all six cached source icons; the candidate reloads none, produces
identical border bytes, and reduces median cached request-to-ready time in this
run from 23.65 ms to 6.55 ms. These are fixture readiness timings, not physical
click-to-paint or whole-browser performance measurements.

`favorite-cache-validation.json` records 1,137 passing source tests, 44 archive
checks, and 216 selected states for 12 real icons in pinned/floating sidebars.
The new tests cover sharing, cancellation, icon replacement, scale/filter
separation, decode failures, timeouts and asynchronous decode completion.

## Immediate selection feedback, 2026-11-06

Prepared outlines still waited for Gecko's `visuallyselected` state. In the
floating sidebar all 12 measured selections had zero border opacity immediately
after selection, even though the image was ready. Gecko deliberately delays that
state while waiting for the destination page to present.

Favorite styling now follows a separate `zen-favorite-selected` marker updated
synchronously on selection. The previous Favorite loses its marker immediately;
Gecko's page-presentation state is untouched. Peek retains its Favorite owner's
highlight, transfers it away on promotion, and restores it on close. Promotion
keeps the child selected, so the owner's attribute-change event covers that path
without requiring an additional selection event or scanning every tab.

`favorite-selection-validation.json` records all 24 prepared selections and
192 following animation frames passing in pinned/floating modes. Six trusted
synthesized clicks also reveal the current outline and hide the previous one
synchronously. `browser-favorite-selection.js` reproduces those click checks
with generated artwork and verifies Peek open, promotion and close in a fresh
headed fixture. All 1,141 source tests and 44 archive tests passed.

These checks establish synchronous style feedback, not physical display
latency, complete Arc timing parity, or cold artwork readiness.

## Restore prepared borders across launches

The restored-session audit found all 12 Favorites visible before any border was
ready. The first recorded browser paint still had zero prepared borders; later
image loading, serial native rendering and decoding finished after the sidebar
was already available. Moving the controller earlier alone did not resolve it.

The optional macOS cache now retains rendered PNGs in the profile's local cache
directory. Preparation begins at the document startup hook, before `gBrowser`
exists, and decodes cached border images concurrently. The normal controller
adopts those decoded images after workspace restoration. A warm restart of the
owned fixture has all 12 borders ready at its first visible frame and first
browser paint; every border is byte-identical to the freshly generated result.

Only embedded artwork and packaged favicon assets are persisted. Remote URLs
alone are not stable pixel identities. Keys retain artwork, logical size, display
scale and filter, and the file version includes engine and bundle identities.
The cache is limited to 64 entries / 8 MiB, validates PNG dimensions before
decoding, writes atomically, and falls back to the existing renderer when absent,
stale, malformed or unwritable. Private windows neither open nor write this
cache. New artwork still needs its first render; this does not eliminate the
initial preparation of a never-seen icon or prove physical click/display timing.

Eight new unit tests cover pixel identity, version changes, bounds, corruption,
private windows, closed windows, decode failure and shutdown flushing. In headed
restart checks, replacing one saved favicon preserves the other 11 prepared
borders and regenerates only the changed artwork; an obsolete cache version
falls back to fresh rendering. All 1,156 source tests pass with serial execution.
The default parallel Node 20 runner spun while processing worker output and was
stopped; its partial run is not counted as passing.

`tools/favorite-startup-cache/verify_startup.py` reproduces the two-launch audit
using a copied app and temporary profile. It adds only a startup observer to the
copy and restores the configured 12 Favorites without network access. For each
case, supply a separate new output directory:

```sh
python3 tools/favorite-startup-cache/verify_startup.py \
  --app '/path/to/candidate/Zen.app' --config-repo '/path/to/Astralforge' \
  --output-dir '/path/to/evidence/unchanged' --case unchanged
```

The other cases are `artwork` and `stale`. The records describe browser frame
and paint observations, not a physical display recording or an Arc timing match.
