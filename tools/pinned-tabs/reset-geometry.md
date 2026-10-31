# Changed pinned-tab geometry

Navigating within a pinned tab used to move its title from x=44 to x=49⅓ points. The reset control now occupies 28 points, preserving both the title origin and the favicon at x=18. Its left corners use the row’s 12-point radius.

Arc 1.171.0 (89666), binary SHA-256 `e82d2a4245b6239860e41a149cb31c0c030e35b383456544c81f21d45ee03376`, provides the read-only reference. `TabCellView`’s slash factory at `0x100369ba4` sets a 4 × 15-point view. `SlashView` drawing at `0x100a445d8` uses a 2-point round stroke from (1,1) to (width−1,height−1) in AppKit coordinates. The CSS mask maps that path into top-down coordinates. The `TabCellSlash` asset resolves to black at 0.3 opacity in Aqua and white at 0.3 in Dark Aqua. The regional corner-radius getter at `0x102a68d0c` returns 12.

Native Arc inspection used an owned localhost pin before and after navigation and in the favicon region. The title remains aligned; the separator lies between favicon and title. The fixture was unpinned and closed afterward, and Home / X plus the original Little Arc Settings window were restored.

This change concerns geometry and the separator. It does not certify all regional hover behavior, hover wording, split/group combinations, full pixel equivalence, or a speed advantage. The existing hover subtitle and reset actions are unchanged. Validation artifacts are maintained in Astralforge’s `tools/zen-bench/results/pinned-reset-geometry-2026-10-30`.
