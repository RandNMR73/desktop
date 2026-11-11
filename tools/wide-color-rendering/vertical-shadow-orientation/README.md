# Vertical text shadows

The last completed native candidate uses source revision
`d85fbb181a46161ae972c79a145fb957409949ef`. Its core 80-tile matrix
passes in all four configurations. Additional underline and software blurred
hyphen failures are resolved. A 12-pixel compositor blur difference and the
newly validated RTL fragment-order failures remain, so it is not installed.

The source paints decorations on the separate hyphen fragment and includes
its advance in decoration clipping. Reversed main-text shadow bounds account
for the removed hyphen width. Native build, syntax, patch reconstruction,
package checks and the four-configuration core matrix passed. Results are in
`hyphen-decoration-bounds-2026-11-11/`.

The current follow-up source paints the separate hyphen before RTL originating
glyphs and after LTR glyphs. It uses the resolved text direction, independently
of sideways physical progression. Syntax and exact patch reconstruction pass;
its native build and pixel checks are pending. The completed results above
belong to `d85fbb181`, not this follow-up.

Mixed upright and sideways glyphs retain their resolved shadow orientations.
Ordinary mixed text preserves orientation-run paint order, while highlighted
text finishes its shadows before painting foreground ink once. Originating
glyph shadows are separate from decoration shadows and ink. Adjacent glyph
runs share a glyph-shadow layer across CJK decoration classification changes.
The new source also keeps horizontal and sideways shadow layers together across
font boundaries, preserving independent upright fallback groups. Discretionary
hyphens with shadows paint as separate fragments in the resolved text direction.

The last completed candidate passes all 80 required reference tiles in
each of four owned headless configurations: software and compositor capture, both in default and
P3 color modes, at device-pixel ratio 2. Every required comparison has zero
differing pixels. Fixtures, references, and zero-pixel tolerances were unchanged.
The 80 tiles cover ordinary shadows, highlights, overlapping and separated
shadow layers, partial highlights, translucent foreground, translucent shadows,
the original single-font decoration control, fallback fonts, and discretionary
hyphens without blur or decorations.

Reference evidence is separate from candidate evidence:

- `arc-stress-validation.json` records native Arc validation of the original
  40 shadow/highlight tiles. The references use positioned colored glyph copies
  instead of `text-shadow`.
- [Astralforge #411](https://github.com/RandNMR73/Astralforge/pull/411) records
  native Arc validation of the 16 transparency reference tiles.
- `decoration-reference-2026-11-10/` contains native Arc 1.172.1 (90370) captures
  of the eight decoration-control tiles and a portable pixel verifier. All
  eight match exactly. Arial and fallback-font alternatives remain diagnostics.
- `decoration-glyph-groups-2026-11-10/validation.json` contains that candidate's
  four-configuration candidate results, exact source/engine hashes, and the
  unchanged diagnostic failures. The prior software decoration failure of
  772 pixels is resolved.
- `text-shadow-edge-cases-2026-11-11/` adds two native Arc-validated reference
  pairs, 16 exact tiles, for fallback fonts and discretionary hyphens. The prior
  candidate fails the fallback pair in software capture by 772 pixels and the
  hyphen pair in both paths by 180 pixels. Its compositor fallback result is
  exact. Original failed proposals, including the still-unresolved fractional
  reference, are retained. Source `1e8bc767f` resolved these failures in all
  four configurations; historical results are in
  `fallback-hyphen-shadows-2026-11-11/validation.json`.
- `text-shadow-edge-cases-2026-11-11/hyphen-variants/` retains three additional
  proposals and lossless native Arc captures. Blur and underline references
  match Arc in 16 tiles. The RTL proposal does not match Arc and remains
  diagnostic. Source `1e8bc767f` failed blur by 12 compositor pixels
  and 1,074 software pixels, and underline by 2,832 pixels in both paths.
  The current candidate resolves software blur and both underline failures.
- `text-shadow-edge-cases-2026-11-11/rtl-fragment-order-v2/` retains a corrected
  RTL reference and lossless native Arc captures: eight exact tiles. The
  actual fixture and actual captured frame are unchanged. The candidate
  differs by 920 compositor pixels and 944 software pixels.

For that candidate, native build, C++ syntax, exact patch reconstruction, package/signature
checks, and 1,638 frozen build-input checks passed. Each test process verified
that it loaded the candidate engine. All six installed-browser hashes remained
unchanged. Performance experiments are excluded from this candidate.

Earlier implementation and result files are retained as historical evidence.
Remaining work includes the compositor blur and RTL fragment-order failures,
fractional decorations, selected hyphens, SVG, color fonts,
emphasis, overflow, drawing cost, and integration with the current daily-browser
interface. Headless comparisons do not prove physical-display fidelity or
complete browser parity.
