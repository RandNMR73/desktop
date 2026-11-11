# Vertical text shadows

The latest native candidate uses source revision
`5218bb1f030a7620416a56f9be35f12d44f4697b`. It is not installed or released.
Later commits record evidence without changing the tested native source.

Mixed upright and sideways glyphs retain their resolved shadow orientations.
Ordinary mixed text preserves orientation-run paint order, while highlighted
text finishes its shadows before painting foreground ink once. Originating
glyph shadows are separate from decoration shadows and ink. Adjacent glyph
runs with the same font and orientation share a glyph-shadow layer even when
their CJK decoration classification differs; actual font and orientation
boundaries remain separate.

The candidate passes all 64 required reference tiles in each of four owned
headless configurations: software and compositor capture, both in default and
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
- `decoration-glyph-groups-2026-11-10/validation.json` contains the current
  four-configuration candidate results, exact source/engine hashes, and the
  unchanged diagnostic failures. The prior software decoration failure of
  772 pixels is resolved.

The native build, C++ syntax, exact patch reconstruction, package/signature
checks, and 1,638 frozen build-input checks passed. Each test process verified
that it loaded the candidate engine. All six installed-browser hashes remained
unchanged. Performance experiments are excluded from this candidate.

Earlier implementation and result files are retained as historical evidence;
their pending or failing states are not the current candidate result. Required
checks still include fractional and fallback-font decorations, blurred shadows,
soft hyphens, SVG, color fonts, emphasis, overflow, drawing cost, and integration
with the current daily-browser interface. Headless comparisons do not prove
physical-display fidelity or complete browser parity.
