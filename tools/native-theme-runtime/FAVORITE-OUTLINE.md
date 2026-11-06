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
