# Font fallback and discretionary hyphen shadows

Native Arc captures validate the two revised references exactly in all eight
writing modes each, at device-pixel ratio 2. The test uses original control
fonts with deliberate overlapping shadow colors; it does not rely on installed
system fonts. Captures came from DevTools' lossless full-size screenshot command
in an owned local-page Incognito window. The original browser window was restored.

The fallback reference keeps horizontal and sideways shadow layers together
across font boundaries, while upright fallback groups remain independent.
The hyphen reference paints an explicitly positioned inline hyphen separately
from the preceding letters. Arc's discretionary hyphen matches that fragment
paint order, including its shadow overlapping earlier foreground ink.

The prior candidate, native source `5218bb1f0`, fails the corrected fallback
reference by 772 pixels in software capture and passes it in compositor capture.
It fails the corrected hyphen reference by 180 pixels in both paths. These are
new failures outside the previously passing 64-tile matrix. `validation.json`
records those results and their engine hashes; no newer candidate result is
implied by this evidence.

The initial reference proposals and captures are retained. In Arc they differ
by 2,916 pixels for fractional font size/position, 772 for the original fallback
grouping, and 180 for the original continuous hyphen reference. The fractional
case remains diagnostic. The revised references change the independently
positioned layers to reproduce observed Arc behavior; no tolerances were widened.

Run `uv run --no-project --with pillow python verify.py` in this directory to
recompute both the retained failures and the 16 exact revised reference tiles.
The verifier also checks the published WPT files against the captured proposals.
Full browser parity, rendering cost, selection-specific hyphens, and other
rendering edge cases are not established by these tests.
