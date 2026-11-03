# Experimental macOS font metrics

The text comparison exposed a general layout difference: Zen rounded font ascent
and descent upward, while Arc used Core Text metrics rounded to the nearest
device pixel. The same discrepancy appears in Ahem, system-ui, Arial, Georgia,
Helvetica, Times, and Courier. Author metric overrides also produced excess line
spacing in the pinned engine.

`gfx.font_rendering.arc_metrics` is disabled by default and requires a restart.
When enabled on macOS, the experiment uses Core Text vertical metrics with
Blink's font-size precision, metric rounding, legacy family adjustment, and
half-leading placement. Font-face overrides are applied before rounding, and
underline extent no longer enlarges the logical descent. Glyph overflow and
decorations require native regression checks before enabling the preference.

The [native comparison report](native-comparison-2026-11-03.json) records 576
cases per browser: eight fonts, twelve sizes, three CSS zoom levels, and two
line-height settings. The separate Core Text reference matches Arc's font
ascent, descent, and height in all 576 cases. With Blink's intermediate fixed-point font-size conversion and integer
half-leading calculation, the reference also matches all 576 complete line
geometries. These are reference measurements, **not results from the new engine
implementation**. The current engine patch does not yet reproduce those
fractional line-height conversions.

All six changed C++ translation units compiled in isolation. The seven engine
patches roundtrip exactly against the pinned source. The 144 Ahem and font-face
override cases have a macOS WPT fixture, metadata enabling the experimental
preference at device scale 2, and native Arc reference measurements. WPT lint
and metadata parsing pass; browser execution with the new code remains pending.

Serve [native-fixture.html](native-fixture.html) with the WPT Ahem font available
at `/fonts/Ahem.ttf`, wait for `document.fonts.ready`, and call
`collectFontMetrics()` to reproduce the measurement grid. Run the WPT through
the normal Mozilla harness after building the engine. On macOS, reproduce the
reference calculation with `python3 compare-native.py --arc ARC.json --zen
ZEN.json --ahem /path/to/Ahem.ttf --output comparison.json` using the native
measurement records.

Before release, verify the linked candidate with the preference both off and
on, resolve fractional zoom placement, and check tiny fonts, variable fonts,
vertical text, printing, decoration clipping, browser chrome, and text paint
references. The active SVG candidate build and installed browser were not
modified by this experiment.
