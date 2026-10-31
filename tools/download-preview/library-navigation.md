# Library navigation reference

The read-only Arc 1.171.0 reference and addresses are recorded in
`arc-library-navigation-reference.json`. Its `ARC_HomeButton.bundle` contains
the six original animations. The source now uses SVG frame strips exported by
lottie-web 5.13.0; the player is a build dependency only. Unlike the earlier
Python conversion, this export preserves offset paths, masks, and strokes.

To rebuild, obtain lottie-web 5.13.0 from its official upstream repository,
then run `export-library-frames.py` with `--arc` (installed reference app),
`--app` (owned candidate Zen app), `--bench` (Astralforge's `tools/zen-bench`),
`--lottie` (upstream `build/player/lottie.js`), and `--out` (export directory).
It starts only a disposable profile and writes `<name>-frames.json`. Pass that
directory to `build-library-sprites.py`. The installed reference is not modified.

`library-navigation-headed.js` checks all five Space palettes, label styling,
selection timing and final poses, repeated selection, reduced motion, close
cleanup, and pressed geometry in a disposable profile. Hover checks use DOM
pseudo-state locks; they do not establish physical pointer behavior. The native
reference has no hover icon playback: `isHovered` is not read by the icon view.

Selection plays frames 1 through 35 inclusive, or 1 through 45 for Boosts, at
60fps. The previous icon keeps playing when deselected; closing clears every
pose. Primary and secondary colors are `maxContrastColor` and `cutoutColor`,
with 70%/0% opacity while inactive. SwiftUI's primary label color was separately
rendered with ImageRenderer and resolves to black/white at 85% opacity before
the selected/unselected multiplier.

This change does not establish complete Library parity. Responsive item
geometry, native continuous corners, interrupted spring velocity, header/footer
content, Media folder access, and full browser performance remain open.
