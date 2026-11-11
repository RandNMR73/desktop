# Vertical text shadows

The last fully tested native candidate uses source revision
`5218bb1f030a7620416a56f9be35f12d44f4697b`. It is not installed or released.
The current source adds corrections for fallback-font and discretionary-hyphen
shadow paint order. Its native build and pixel checks are still pending; the
prior candidate's results below must not be attributed to the new source.

Mixed upright and sideways glyphs retain their resolved shadow orientations.
Ordinary mixed text preserves orientation-run paint order, while highlighted
text finishes its shadows before painting foreground ink once. Originating
glyph shadows are separate from decoration shadows and ink. Adjacent glyph
runs share a glyph-shadow layer across CJK decoration classification changes.
The new source also keeps horizontal and sideways shadow layers together across
font boundaries, preserving independent upright fallback groups. Discretionary
hyphens with shadows paint as separate fragments after preceding foreground ink.

The last fully tested candidate passes all 64 prior required reference tiles in
each of four owned headless configurations: software and compositor capture, both in default and
P3 color modes, at device-pixel ratio 2. Every required comparison has zero
differing pixels. Fixtures, references, and zero-pixel tolerances were unchanged.
The 64 tiles cover ordinary shadows, highlights, overlapping and separated
shadow layers, partial highlights, translucent foreground, translucent shadows,
and the original single-font decoration control.

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
  reference, are retained. The new source addresses these newly exposed failures.

For that candidate, native build, C++ syntax, exact patch reconstruction, package/signature
checks, and 1,638 frozen build-input checks passed. Each test process verified
that it loaded the candidate engine. All six installed-browser hashes remained
unchanged. Performance experiments are excluded from this candidate.

Earlier implementation and result files are retained as historical evidence.
Required checks include the new 16-tile suite and the inherited 64-tile matrix
on the new native build, fractional decorations, blurred shadows, selected
hyphens, SVG, color fonts, emphasis, overflow, drawing cost, and integration with
the current daily-browser interface. Headless comparisons do not prove
physical-display fidelity or complete browser parity.
