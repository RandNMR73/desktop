# Site-search color lifecycle and rendering

A scope from Arc's preset list uses its stored opaque color. Other scopes look
up a history page using the host of the provider's empty-query search URL, then
use that page's favicon. An unavailable favicon keeps the last loaded palette
until the scope ends. No bundled provider icon or provider-specific fallback
color is substituted.

The native image path preserves pixel dimensions, draws into Device RGB ABGR,
samples every tenth pixel, and uses five-color modified median cut. It selects
the first palette entry with HSV brightness at least .15 (or the first entry),
subtracts .15 HSL lightness, and builds the semantic palette in sRGB. The focus
color is translucent; the text-selection color comes from the same input
palette. Preset colors bypass the focus derivation. This distinction explains
why a Google favicon produces a brown highlight rather than its extracted
orange. Empty scopes use the active Space's focus color for both label and row.

The optional `zen_site_search_palette_version()` / `zen_site_search_palette()`
ABI accepts encoded favicon bytes and returns the existing 112-double palette
layout. It performs no network or filesystem reads. Invalid data leaves output
untouched. Image dimensions are checked before decoding; the process cache is
bounded by both entry count and key bytes, and never caches a failed lookup.
Older libraries retain the last available scope color. Packaging must update
the native library alongside the browser module.

Read-only Arc 1.171.0 evidence (arm64 executable SHA-256
`e82d2a4245b6239860e41a149cb31c0c030e35b383456544c81f21d45ee03376`):

- `0x1021e1ea0`: preset lookup, empty submission, host passed to history lookup.
- `0x10220908c`: image palette extraction and .15-lightness darkening.
- `0x1021c0df8`–`0x1021c0e54`: loaded scope color builds the primary palette.
- `0x10222d5d8` and `0x10224ed60`: label/result use the raw color only when
  `isFromAutoActivatedList` is true; other scopes use semantic focus.
- `0x100d85a58`: luminance-bounded primary colors, followed by semantic blending.

`python3 tools/native-theme-runtime/test_site_search_palette.py` checks 64
independently run ColorThiefSwift distributions and four native PNG samples.
The reference revision and MIT attribution are retained with the quantizer.
`test_space_palette.py` checks that the separate P3 Space calculation stays
unchanged. `npm run test:astral` covers browser-module state and lifecycle.

Native keyboard tests confirm Google → Brave retains the derived color,
Escape clears it, a fresh Brave scope uses Space colors, and YouTube remains
red. All five Space fallbacks were captured. Google result-row screenshot
medians are Zen `[123,97,62]`, Arc `[123,97,64]`; this is close, not exact pixel
parity. The automation robot icon is confined to the test profile.

History selection now matches ICU word boundaries and minimum prefix lengths,
filters hidden pages, and orders by visible visits rather than frame or redirect
activity. A recent text match is checked first; older batches are bounded by
the best visible visit already found. The disposable-profile fixture in
`native-history-semantics.js` covers word/title matching, hidden and frame
visits, intermediate redirects, international domains, equal-date batch
continuation, and the command bar's final palette (14 checks). Its profile
path guard prevents it from clearing a normal browsing profile.

The independent system-ICU comparison passed 198 cases; the full source suite
passed 796 tests. A 50,000-page/100,000-visit synthetic database measured a
recent match at approximately 0.4 ms and an absent match at approximately
39 ms. The latter remains slower than the former substring-only lookup
(approximately 21 ms). These are lookup timings, not browser benchmarks.
See `history-semantics-validation-2026-11-03.json` for scope and hashes.

Remaining work includes validating the Chromium/Gecko international-domain
policies and unusual empty-token queries, direct favicon association instead
of root fallback, the two-level screenshot color difference, and vector
favicon handling. Gecko deliberately omits the page association for some
root icons; filtering for direct mappings alone would lose valid icons. This
does not establish complete browser parity or a performance improvement.

The apparent mouse-triggered popup disappearance was a capture omission,
confirmed by paired native captures of the owned test window. With
`includeChildWindows=false`, macOS returns only the backdrop; with it enabled,
the same window contains the correct scope, query and selected result. Trusted
pointer activation reaches the scope control, and both accessibility and
coordinate provider selection preserve the query/color. See
`pointer-capture-resolution-2026-11-03.json` and the two adjacent PNG crops.

`OwnWindowCapture.m` is a test-only macOS 14.4+ helper. It requests only the
current process's shareable content, then captures that process's main window
with and without children. It does not request broader screen-recording access
or ship in the browser. Build with AppKit and ScreenCaptureKit, call
`zen_test_popup_capture_start(outputDirectory)` in the owned test process, and
poll `zen_test_popup_capture_state()` until `pending` is false. Keep the library
loaded until completion.
