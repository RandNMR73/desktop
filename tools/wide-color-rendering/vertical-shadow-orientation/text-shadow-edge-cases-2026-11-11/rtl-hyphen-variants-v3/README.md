# RTL blurred and underlined hyphen references

Both pairs match native Arc exactly in all sixteen tiles at DPR 2. The
lossless PNGs were captured through the DevTools full-size screenshot command.
The frame metadata confirmed loaded fonts and an unchanged 818 by 498 CSS-pixel
frame at (16, 60.5). The capture crop excludes the one-pixel frame border.

The references retain the direction-aware fragment stacking validated in
`../rtl-fragment-order-v2/`, with blur or underline added to both actual and
reference. `verify.py` rechecks fixture/capture hashes, nonblank tiles and zero
pixel differences. The provisional manifest is preserved with its original
label; the completed native validation is in `arc-reference-report.json`.

Candidate results are separate. Exact reference matches alone do not prove
candidate or whole-browser parity. The owned private window was closed and
the original Arc window restored; no Arc settings were changed.
