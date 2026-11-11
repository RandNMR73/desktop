# Hyphen decoration and reversed shadow bounds

Native source `d85fbb181a46161ae972c79a145fb957409949ef` built and packaged
successfully. All 1,638 frozen inputs were checked. The separate candidate
engine is `5faf8ab159d6a43d39fe5654470fc7236217e254ec33688a58319a51e3ccff8e`.
All six installed-browser hashes remained unchanged; this candidate is held.

The core 80 required tiles pass with zero differing pixels in all four
configurations: default/P3 color and compositor/software capture, at DPR 2.
The additional default-mode results are:

| Arc-validated reference | Compositor differing pixels | Software differing pixels |
| --- | ---: | ---: |
| Blurred hyphens | 12 (maximum channel difference 1) | 0 |
| Underlined hyphens | 0 | 0 |
| Revised RTL hyphens | 920 | 944 |

The previous candidate's missing underlines (2,832 pixels in each path) and
clipped software shadow (1,074 pixels) are resolved. The compositor blur
mismatch and RTL fragment ordering remain. The old RTL diagnostic still
self-matches but is not an acceptance test: it did not match native Arc.
The revised reference in `../text-shadow-edge-cases-2026-11-11/rtl-fragment-order-v2/`
matches native Arc exactly in all eight writing modes.

Every browser fixture completed normally and confirmed the loaded engine.
The probe failures represent retained pixel mismatches, not fixture startup
errors. `validation.json` contains report hashes, fixture hashes, pixel counts
and per-tile results. No tolerance was relaxed. These are owned headless
comparisons, not proof of complete browser or physical-display parity.
