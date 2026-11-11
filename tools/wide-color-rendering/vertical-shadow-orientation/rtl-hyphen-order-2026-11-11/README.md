# Direction-aware hyphen painting

Native source `35d40055d74cd8371b392d802748e06fd460ebf7` built and packaged
successfully. All 1,638 frozen inputs were checked. The candidate engine is
`39b853025f1468319103fbe93b954896e1d396bd9257de50155a70f3740b6d6b`.
All six installed-browser hashes remained unchanged; this candidate is held.

The core 80 required tiles remain exact in four configurations: default/P3
color and compositor/software capture, at DPR 2. The expanded matrix adds
40 required tiles in each configuration:

| Arc-validated reference | Default compositor | Default software | P3 compositor | P3 software |
| --- | ---: | ---: | ---: | ---: |
| LTR blurred hyphens | 12 | 0 | 19 | 0 |
| LTR underlined hyphens | 0 | 0 | 0 | 0 |
| RTL hyphens | 0 | 0 | 0 | 0 |
| RTL blurred hyphens | 0 | 0 | 0 | 0 |
| RTL underlined hyphens | 0 | 0 | 0 | 0 |

Values are differing pixels. Each row contains eight writing-mode tiles.
Both remaining mismatches are in the horizontal LTR blur tile, with maximum
channel difference 1. No tolerance was relaxed. Across core and expanded
matrices, 478 of 480 required tile comparisons are exact; this is rendering
fixture coverage, not a percentage of whole-browser parity.

Painting the separate hyphen before RTL originating glyphs resolves the prior
920-pixel compositor and 944-pixel software RTL failures. The added RTL blur
and underline references match native Arc in 16 tiles; their lossless captures
and verifier are in `../text-shadow-edge-cases-2026-11-11/rtl-hyphen-variants-v3/`.
The old invalid RTL proposal is retained as a diagnostic. Its new mismatches
are expected because it does not reproduce Arc's fragment order.

Every browser fixture completed normally and confirmed the loaded engine.
Only the two compositor runs with required blur mismatches returned failures.
`validation.json` retains all report hashes, fixture hashes and per-tile results,
including failed diagnostics. These are owned headless comparisons, not
physical-display validation. Current daily-interface integration, remaining
rendering cases and drawing-cost checks are still required before installation.
