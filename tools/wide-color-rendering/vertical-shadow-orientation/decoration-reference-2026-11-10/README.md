# Decoration shadow reference

The single-font control matches native Arc 1.172.1 (90370) exactly in all eight writing-mode tiles at DPR 2. Captures use Arc’s native DevTools full-size screenshot command in a disposable private window; the original browser window was restored. The magenta frame interior is [34, 123, 1666, 1115] in physical pixels. All comparison tolerances remain zero.

The font uses two original geometric glyphs with equal integer advances. Its generator and the actual/reference pair live in `src/testing/web-platform/tests/css/css-text-decor/astral-decoration-shadow-order/`. The actual uses CSS text-shadow; the reference uses independently positioned colored glyph and underline copies. The WPT actual file corrects the rel=match filename; painting inputs and font bytes match the captured control.

Run `python3 verify.py` with Pillow installed to verify the six capture hashes, recompute all 24 tile comparisons, and confirm that the committed control font and painting inputs match the capture. Serve the repository root over localhost and open this directory's `compare.html` to inspect the single-font actual/reference pair. The wrapper resolves the committed WPT files directly. The Arial and Ahem source-file hashes describe retained local diagnostic inputs; only their captures, not those diagnostic inputs, are included here.

Fresh Arial captures differ in 29 pixels, primarily at underline endpoints. The earlier independently retained capture differed in 41 pixels. Ahem with system fallback also exposes paint-group differences in horizontal and sideways text. Those cases remain diagnostics; the exact single-font control does not establish parity for fractional geometry or fallback fonts.

The preceding native engine (f13135207) fails this new control: software 3,352 differing pixels, compositor 2,994. The proposed originating-decoration phase fix has passed the native syntax check, but its linked build and pixel validation are pending. It is not installed. Highlight decorations, emphasis, SVG, blur, fallback fonts, soft hyphens, overflow and drawing cost remain to be checked.

The source implementation follows the originating-shadow-before-decoration sequence visible in Chromium’s `TextFragmentPainter::Paint`; direct Arc images are the primary behavioral evidence. Source inspected: https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/paint/text_fragment_painter.cc
