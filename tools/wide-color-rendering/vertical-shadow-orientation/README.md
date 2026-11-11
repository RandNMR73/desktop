# Vertical text shadows

The completed native candidate uses source revision
`1a3d792c5d59927c7eb55cd76f61f1c3d4faf878`. All 480 required tile comparisons
are exact: 80 core and 40 expanded tiles in each of four configurations
(software/compositor capture, default/P3 color, DPR 2). This includes the two
previously failing compositor blurred-hyphen comparisons. References, fixtures,
and zero-pixel tolerances are unchanged. The candidate remains uninstalled.

The fix includes displayed hyphen ink when recomputing overflow bounds,
matching the existing reflow metrics path. A diagnostic display-list capture
found a smaller right bound for the discretionary hyphen than for the
equivalent literal hyphen. Native build, syntax, exact patch reconstruction,
package/signature verification and all 1,638 frozen input checks pass. Results
are in `hyphen-overflow-bounds-2026-11-11/validation.json`.

The new engine was also combined with the current installed UI, preserving
its command-bar fixes, themes and native library. All 677 UI regression checks
pass across header hover, sidebar spacing, appearance, tooltips and Peek.
The first two runners stopped before their fixtures because a loaded-library
guard compared `/var` and `/private/var` paths as strings. Their reruns resolve
both paths and still verify the exact engine hash. These failed attempts are
retained in `hyphen-overflow-bounds-2026-11-11/current-ui-validation.json`.
The installed browser's six tracked hashes remain unchanged.

The source paints decorations on the separate hyphen fragment and includes
its advance in decoration clipping. Reversed main-text shadow bounds account
for the removed hyphen width. Native build, syntax, patch reconstruction,
package checks and the four-configuration core matrix passed. Results are in
`hyphen-decoration-bounds-2026-11-11/`.

The current source paints the separate hyphen before RTL originating
glyphs and after LTR glyphs. It uses the resolved text direction, independently
of sideways physical progression. Syntax, exact patch reconstruction, native
build and package verification pass. Results for this source are in
`rtl-hyphen-order-2026-11-11/`; the prior paragraph's decoration and bounds
results belong to `d85fbb181`.

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
  Source `d85fbb181` resolves software blur and both underline failures.
- `text-shadow-edge-cases-2026-11-11/rtl-fragment-order-v2/` retains a corrected
  RTL reference and lossless native Arc captures: eight exact tiles. The
  actual fixture and actual captured frame are unchanged. Source `d85fbb181`
  differs by 920 compositor pixels and 944 software pixels. Source `35d40055d`
  resolves both failures and also passes in P3 mode.
- `text-shadow-edge-cases-2026-11-11/rtl-hyphen-variants-v3/` adds lossless
  native Arc captures and a portable verifier for 16 RTL blur/underline tiles.
  All reference tiles match Arc exactly. Source `35d40055d` matches these
  references exactly in all four configurations. The old invalid RTL proposal
  now differs, as expected; it remains diagnostic and is not used for acceptance.

For that candidate, native build, C++ syntax, exact patch reconstruction, package/signature
checks, and 1,638 frozen build-input checks passed. Each test process verified
that it loaded the candidate engine. All six installed-browser hashes remained
unchanged. Performance experiments are excluded from this candidate.

Earlier implementation and result files are retained as historical evidence.
Remaining work includes fractional decorations, selected hyphens, SVG, color
fonts, emphasis, additional overflow cases, drawing cost, and physical-display
review of the combined candidate. Headless comparisons do not prove physical-display fidelity or
complete browser parity.
