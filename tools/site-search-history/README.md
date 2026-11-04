# Typed site-search history

`ZenSiteSearchTerms.sys.mjs` prepares and scores typed keyword-history candidates.
`ZenSiteSearchHistory.sys.mjs` reads the selected engine's retained Places records,
and `ZenUBSiteSearchHistoryProvider.sys.mjs` connects them to the command bar.
Local-only scopes use the default-enabled native command-ranking adapter when
ABI 8 is available. The preference `zen.urlbar.site-search.typed-history` can
disable it. Engines with enabled remote suggestions keep their built-in provider.
The empty-scope recent list remains enabled independently of native matching.
Complete candidate eligibility, lower-result ordering, remembered choices, and
remote suggestion merging are still under comparison; exact parity is not claimed.

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

The local Search provider considers fifteen recent prefix candidates and retains
up to three history suggestions, plus the literal query. These budgets are applied
before command ranking and do not grow with the popup's row limit. This follows
`SearchProvider::DoHistoryQuery` / `ConvertResultsToAutocompleteMatches` and
[the default provider budget](https://github.com/chromium/chromium/blob/156.0.8078.74/components/omnibox/browser/omnibox_field_trial.cc).
An exact history winner still counts as history at this stage; the later Swift
conversion to search-what-you-typed does not exempt it.

Correction to the earlier provider analysis: `0x16e360` at ArcCore `0x431b660`
is the 1,500,000-microsecond stop timer, not the provider mask. The mask is returned
by `0x2b19540` and includes HistoryURL and HistoryQuick. Combined browser results
can inherit relevance from duplicate navigation matches, and navigation matches
can consume the shared result budget before the scoped filter removes them.
Live `chrome://omnibox` diagnostics confirm both effects. The local adapter now
combines Search candidates with the seven keyword-mode HistoryQuick candidates,
merges duplicate destination relevance, culls the shared eight-result batch, then
filters navigation rows before command ranking. Diagnostics precede Arc's Swift
command ranking, so their order alone is not evidence of final displayed order.

`ZenSiteSearchNavigation.sys.mjs` implements the navigation contribution using
word-boundary/topicality scores, the newest ten visits, typed/bookmark weights,
integer-day recency buckets, host specificity, float32 arithmetic, and the
strictly descending provider scores. Each cursor variant has an independent
500-record pool; records failing the later raw-term check still contribute to
host specificity. The reference inputs include the keyword but use the original
query cursor position. Live diagnostics with that cursor setting reproduced all
21 captured HistoryQuick integer scores and candidate identities across three
queries. These private captures remain outside the repository.

Primary sources are Chromium 156.0.8078.74's
[ScoredHistoryMatch](https://github.com/chromium/chromium/blob/156.0.8078.74/components/omnibox/browser/scored_history_match.cc),
[URLIndexPrivateData](https://github.com/chromium/chromium/blob/156.0.8078.74/components/omnibox/browser/url_index_private_data.cc),
[HistoryQuickProvider](https://github.com/chromium/chromium/blob/156.0.8078.74/components/omnibox/browser/history_quick_provider.cc),
and [Chromium's ICU word-break tailoring](https://chromium.googlesource.com/chromium/deps/icu/+/b2a3b8b%5E%21/).
The title-word limit is twenty (the source's older ten-word comment is stale);
overlapping occurrences are retained until after scoring.

The Places reader includes visible retained document history, reads individual
visits only for selected candidates, and excludes default-engine search URLs.
It does not persist a second history cache. This avoids stale suggestions after
deletion. The standalone prototype and packaged tests cover ordinary HTTP(S)
scope inputs; exhaustive ICU/unescaping equivalence, every combined provider,
equal-score tie behavior, remote suggestions, and final command ordering remain
under comparison. This is not a complete parity certificate.

Validation: 15 focused Node tests (including all 1,632 instruction-reference cases)
and 11 checks in a disposable Zen 1.23.4b profile. The latter repeated all reference
scores and representative Firefox ICU cases. Warm preparation/scoring of 50
synthetic history records measured 0.145 ms median, 0.204 ms p95 over 150 queries;
this excludes history access, final ranking, and painting. The fixture registered a
temporary resource alias to the source module and did not modify either installed
app or the everyday profile.

## Provider integration validation

The typed reader uses Places' reversed-host index, then SearchService's submission
parser to isolate the engine. It retains searches older than fourteen days,
aggregates URL variants, and reads current history on each query. A deleted search
therefore has no separate cache to clear. Private and preview scopes never activate
this provider. The typed integration prepares Chromium candidates, then applies the command
ranking and native text features described in `../command-ranking/README.md`.

`browser-typed-validation.js` runs in a disposable Marionette chrome context whose
profile directory starts with `zen-search-typed-`, with the configured YouTube and
Amazon engines. It clears only that guarded fixture's history and tests fifteen
checks through the real Places database and command bar. The packaged candidate
passed all fifteen on 2026-11-04. Physical keyboard automation additionally checked:

- Down to the literal result preserves the typed text with no selected suffix.
- Down to another history result selects only its completion suffix, as observed
  in Arc's live scoped command bar.
- Backspace removes the suffix and dismisses history suggestions, leaving only
  the literal search, as observed for two different Arc history queries.
- Enter submits the full selected query to the selected engine and closes scope.
  The fixture's network proxy intentionally rejects external page loads; the
  destination URL, not remote page rendering, was verified.

Firefox's URL-autofill duplicate filter previously compared two absent URLs and
discarded every other search result. The muxer patch now requires a real URL and
deduplicates a search completion by its full suggestion, preserving the distinct
literal query. The input patch preserves the query prefix during arrow navigation;
actual activation still submits the full suggestion. Source patches were applied
to reconstructed upstream files and matched the packaged candidate byte for byte.

Reference clarification: `BrowserSearchResult` fields at +0x28/+0x30 are a cached
deletion identity, not completion text (`deletable` branch at `0x1004d4590`). The
search archetype's completion getter (`0x101d71214`–`0x101d71384`) returns its title
payload. The typed model supplies that title explicitly; deletion IDs do not take
part in completion or matching.

Normal input uses the same completion path as the fixture query. The input patch
allows scoped terms through Firefox's remote-search autofill gate and passes the
input event type into the query context. Deletion dismisses history results; typing
again restores them. Scoped paste can complete as in the reference. URL placeholders
are cleared at this boundary, so a previous engine's placeholder is never reused.
