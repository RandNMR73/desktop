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
Selection cancellation releases owner handles; both outstanding handles and
queued workers are bounded at 32. Inputs are at most 1 MiB / 512×512 pixels.
Gecko polls only active work, stops on close/unpin/selection change, and uses an
8 MiB / 64-entry cache shared between browser windows. Unselected Favorites do
not initiate rendering. No idle polling is introduced.

The displayed CSS artwork override wins over a page favicon. Favicon events can
arrive before Gecko updates the tab image attribute, so the incoming icon is
recorded explicitly, including removal. Stale image decoding and native work
cannot apply to a different selection. Unsupported platforms retain the neutral
fallback; this implementation does not promise native Core Image parity there.

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
