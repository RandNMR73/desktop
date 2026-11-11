# Vertical text shadows

The current native candidate uses source revision
`1e8bc767f3930b1fbfdd2ee9b7341b80681c299b`. Its expanded 80-tile matrix
passes in all four configurations. Additional blurred and underlined hyphen
checks still fail, so the candidate is not installed or released.

Mixed upright and sideways glyphs retain their resolved shadow orientations.
Ordinary mixed text preserves orientation-run paint order, while highlighted
text finishes its shadows before painting foreground ink once. Originating
glyph shadows are separate from decoration shadows and ink. Adjacent glyph
runs share a glyph-shadow layer across CJK decoration classification changes.
The new source also keeps horizontal and sideways shadow layers together across
font boundaries, preserving independent upright fallback groups. Discretionary
hyphens with shadows paint as separate fragments after preceding foreground ink.

The current candidate passes all 80 required reference tiles in
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
  reference, are retained. The current source resolves these failures in all
  four configurations; results are in
  `fallback-hyphen-shadows-2026-11-11/validation.json`.
- `text-shadow-edge-cases-2026-11-11/hyphen-variants/` retains three additional
  proposals and lossless native Arc captures. Blur and underline references
  match Arc in 16 tiles. The RTL proposal does not match Arc and remains
  diagnostic. The current candidate still fails blur by 12 compositor pixels
  and 1,074 software pixels, and underline by 2,832 pixels in both paths.

For that candidate, native build, C++ syntax, exact patch reconstruction, package/signature
checks, and 1,638 frozen build-input checks passed. Each test process verified
that it loaded the candidate engine. All six installed-browser hashes remained
unchanged. Performance experiments are excluded from this candidate.

Earlier implementation and result files are retained as historical evidence.
Remaining work includes the additional blur and underline failures, a valid
RTL reference, fractional decorations, selected hyphens, SVG, color fonts,
emphasis, overflow, drawing cost, and integration with the current daily-browser
interface. Headless comparisons do not prove physical-display fidelity or
complete browser parity.
