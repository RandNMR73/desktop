# Vertical text shadows

The draft changes shadow offsets according to each resolved glyph orientation.
It is not installed or approved for release. The native build uses revision
`31c4f3c3f6e3add1238232b874f208036c604e59`; later commits add test evidence.

Native Arc captures validate five reference pages, each with eight writing-mode
cases: ordinary shadows, highlight-only shadows, overlapping shadow layers,
separated shadow layers, and partial highlights. All 40 tile comparisons are
pixel-identical within Arc at device-pixel ratio 2. References use positioned
colored glyph copies rather than `text-shadow`. Capture hashes, fixture hashes,
and measured tile bounds are in `arc-stress-validation.json`.

The captures establish two distinct paint orders. Ordinary mixed vertical text
paints the shadows and ink of each orientation run in sequence. Partial
highlights paint the shadow runs before the text ink. These details matter when
adjacent glyphs or multiple shadow layers overlap.

`mixed-shadow-decoration` remains a diagnostic, not a passing reference. Arc
rotates underline-shadow offsets with the line direction even when the glyphs
are upright. The closest reference still has small pixel differences in four
cases; `arc-decoration-order.json` records all tested orders. The latest source
rotates decoration offsets independently of glyph orientation, shifts software
decoration clips with the shadow, and includes the rotated extent in overflow.
This follow-up has only passed syntax and patch reconstruction checks; it has
not been included in a native build. `decoration-implementation.json` records
its exact source hashes and remaining validation.

The ten WPT files for the five validated references pass lint. Native candidate
pixel tests, blurred shadows, software drawing paths, soft hyphens, and color
fonts remain unverified. Headless Gecko comparisons are distinct from native
Arc captures and cannot establish physical-display parity by themselves.

The first compiled candidate completed successfully. At DPR 2, both default and
P3 modes pass the two basic reference pages (16 tiles). Only 26 of the 40 tiles
in the five validated pages match exactly. Multiple-layer order and partial
highlights still differ; the decoration diagnostic also fails. The candidate
is not installed. See `native-candidate-validation.json`.
