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
cases; `arc-decoration-order.json` records all tested orders. The decoration follow-up
rotates decoration offsets independently of glyph orientation, shifts software
decoration clips with the shadow, and includes the rotated extent in overflow.
This follow-up has only passed syntax and patch reconstruction checks; it has
not been included in a native build. `decoration-implementation.json` records
its exact source hashes and remaining validation.

The ten WPT files for the five validated references pass lint. Native candidate
pixel tests, blurred shadows, software drawing paths, soft hyphens, and color
fonts remain unverified. Headless Gecko comparisons are distinct from native
Arc captures and cannot establish physical-display parity by themselves.

The first compiled candidate completed successfully. Its default screenshot
path uses software `drawSnapshot`, even though the window compositor reports
WebRender. At DPR 2, both default and P3 software snapshots pass 26 of the 40
validated tiles. Multiple-layer order and partial highlights still differ;
the decoration diagnostic also fails. See `native-candidate-validation.json`.

A separate default-color run enables `remote.screenshot.use_readback` in an
owned headless profile. Reading the composed WebRender image passes 32 of the
40 validated tiles, including both multiple-layer pages. Partial highlights
still fail in all eight modes. Nonempty images were checked, and the engine,
fixture and capture hashes are recorded in `compositor-candidate-validation.json`.
This does not establish physical-display or P3 compositor parity. The first P3
attempt was rejected because toolbar initialization changed the viewport height
between actual and reference; its failed evidence remains preserved.

Independent paint-order variants show that the software candidate paints each
shadow layer across the full span, rather than finishing shadows and ink per
orientation run. The new source groups contiguous glyph orientations in the
software ordinary-text path, keeps a soft hyphen on the final group, and
preserves continuous decoration handling. It has passed a compile-only check
and patch reconstruction; native pixel tests are pending. The existing Arc
references are unchanged. `software-paint-order-implementation.json` records
the diagnosis, exact source hashes and limitations. Neither draft correction
is installed.
