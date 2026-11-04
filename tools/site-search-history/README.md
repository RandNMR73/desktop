# Typed site-search history

`ZenSiteSearchTerms.sys.mjs` prepares and scores typed keyword-history candidates.
It is not yet registered with the live provider. The installed empty-scope recent
list remains separate. Final Arc ranking, completion, asynchronous suggestion
merging, and provider integration are still under validation; this module alone
does not establish full parity.

Reference: read-only Arc 1.171.0 / ArcCore 156.0.8078.74 ARM64 inspection on
2026-11-03. The history relevance routine at `0xbd96f00` matches the Chromium
156.0.8078.74 `SearchProvider::CalculateRelevanceForHistory` arithmetic.
The inspected ArcCore binary SHA-256 is
`e77610c37dd92e506a7d996f0318a6e0ab46f0da960394817810d5ba15f976d4`.
The accompanying 1,632 synthetic cases execute that original routine in isolated
ARM64 emulation, substituting only the clock and the host's `libm pow`. The fixture
contains inputs and integer outputs, no executable bytes or browsing history.

The implementation also follows these primary-source behaviors:

- [URLDatabase](https://github.com/chromium/chromium/blob/156.0.8078.74/components/history/core/browser/url_database.cc): locale lowercase plus collapsed whitespace for prefix matching.
- [Keyword search term aggregation](https://github.com/chromium/chromium/blob/156.0.8078.74/components/history/core/browser/keyword_search_term_util.cc): aggregate URL records, ignore variants within five minutes of the retained representative, then order by recency before limiting.
- [SearchProvider](https://github.com/chromium/chromium/blob/156.0.8078.74/components/omnibox/browser/search_provider.cc): distinguish repeated phrases from one-visit phrases, retain the old aggressive score set while extending a phrase, preserve the exact previously searched term, and make scores unique.
- [Whitespace constants](https://github.com/chromium/chromium/blob/156.0.8078.74/base/strings/whitespace_constants.h): includes U+0085, excludes U+FEFF; JavaScript `\s` would be incorrect.

The caller must supply records for just the selected engine, application locale,
and the browser's URL classification. Dates are Unix milliseconds and visit counts
belong to complete URL records. No site names or example search strings influence
scoring. Nonfinite ages and invalid records are rejected defensively.

Word detection uses `Intl.Segmenter` and case conversion uses the supplied locale.
Representative punctuation, CJK, and locale cases are covered; exhaustive agreement
between Firefox's and Chromium's ICU versions is not claimed. Equal-recency ordering
also remains unproven because Chromium's partial sort does not promise stability.

Arc's final ordering must be checked separately: its browser-client provider mask
`0x16e360` excludes HistoryURL and HistoryQuick. The built-in `chrome://omnibox`
page uses a different provider set and can boost history search scores by merging
HistoryURL results, so its combined results cannot serve as the final Arc oracle.

Validation: 15 focused Node tests (including all 1,632 instruction-reference cases)
and 11 checks in a disposable Zen 1.23.4b profile. The latter repeated all reference
scores and representative Firefox ICU cases. Warm preparation/scoring of 50
synthetic history records measured 0.145 ms median, 0.204 ms p95 over 150 queries;
this excludes history access, final ranking, and painting. The fixture registered a
temporary resource alias to the source module and did not modify either installed
app or the everyday profile.
