# Typed site-search history

`ZenSiteSearchTerms.sys.mjs` prepares and scores typed keyword-history candidates.
`ZenSiteSearchHistory.sys.mjs` reads the selected engine's retained Places records,
and `ZenUBSiteSearchHistoryProvider.sys.mjs` connects them to the command bar.
Explicit engine scopes use the default-enabled native command-ranking adapter
when ABI 8 is available, including engines that support remote suggestions. The
preference `zen.urlbar.site-search.typed-history` can disable it. Ordinary searches
without an explicit engine scope keep their built-in providers.
The empty-scope recent list remains enabled independently of native matching.
Untitled history visits do not create recent-search labels from their URLs.
They still consume the matching-page budget; a later visit with a title makes
the search eligible again. This is covered by the packaged-browser regression
in `../site-search-recents/browser-untitled-validation.js`.
It requests the five newest matching history pages in the fourteen-day window,
then parses and deduplicates their search terms. Duplicate and empty terms use
that five-page budget; the reader does not backfill from older pages. This is
separate from the typed-provider budgets described below. Read-only inspection
of Arc 1.171.0 on 2026-11-04 traces the explicit site-search limit of five at
`0x1021dff28`, its non-nil `InputWithContext.maxResults` at `0x1021e032c`, the
`SearchContext` copy at `0x102b83aa4`, and the history request's `setMaxResults:`
at `0x102b77f5c`, before result conversion at `0x102b77f88`.
Complete candidate eligibility, lower-result ordering, and upstream remote-result
influence on shared candidate budgets remain under comparison; exact parity is
not claimed.

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

The explicit engine scope subsequently excludes that exact history result.
Arc's conversion at `0x102b799a0` uses Swift's locale-independent lowercase
comparison; the scope predicate at `0x101d70e68` accepts only Chromium
SearchHistory and SearchOtherEngine. Rank assignment at `0x102b78fdc` follows
that filter. Finally `0x102b795ec` appends a SearchOtherEngine literal if none
survived, with an empty feature dictionary. The adapter preserves this sequence:
an exact history winner or a crowded shared result batch cannot remove the typed
search, and the replacement receives the scorer's missing-signal defaults instead
of the discarded result's rank and relevance. History deduplication still uses
the application locale; Swift equality separately handles canonical Unicode forms.
`browser-scope-fallback-validation.js` covers the packaged module and real command
bar against a disposable Places database, including immediate history deletion.

A separate read-only ARM64 arithmetic comparison on 2026-11-04 matched all 140
scores across 20 candidate batches, including 120 synthetic vectors. It executes
the original configuration constructor (`0x101d50630`), normalization
(`0x101d583bc`), category scoring (`0x101d55828`), and final weighted mean
(`0x101d9b9b4`). The fallback configuration block also matched all 51 numeric
configuration fields. Candidate extraction, population statistics, and applicable
boosts were supplied inputs; this does not establish equivalence of the live
provider pipeline. Lower typed-result ordering remains unresolved.

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

### Navigation candidate filtering

The database filter now keeps Unicode titles/URLs, escaped URLs and IDN hosts
eligible for the full matcher. It also accounts for both cursor variants instead
of requiring the unsplit keyword in every page. The previous ASCII keyword-only
filter dropped a Unicode case-fold match and a cursor-split title match that the
existing full matcher accepts. This affected the candidate pool before relevance
merging and final command ranking.

For ordinary ASCII pages, one trailing query word per cursor variant rejects
impossible matches before visit/bookmark metadata is read. This is a conservative
filter: word boundaries, the independent 500-page pools, host specificity and
scores still come from the existing matcher. There is no persistent history cache.

`browser-navigation-filter-validation.js` compares the packaged reader with an
unfiltered eligible-page scan. The 89 checks cover the two previously dropped
matches, three locales, IDNs, escaped terms, punctuation, a pool larger than 500
pages, bookmarks, hidden/future visits, deletion, cancellation and identical final
candidate order/relevance. The installed baseline fails the Unicode regression.

The synthetic benchmark has 20,000 pages and 100,000 visits, with seven alternating
before/after runs per query. Sparse and missing queries reduce database rows sent
to the matcher from 20,000 to 20 and zero respectively. Dense-case timings vary
under the current system load; a uniform timing improvement is not established.
See `navigation-filter-validation.json` for measurements and limits. This change
does not resolve the separate first-whole-query ordering or initial flash gaps.

```sh
python3 tools/site-search-history/test-browser-navigation-filter.py \
  --app /path/to/Zen.app --config-repo /path/to/Astralforge \
  --report /tmp/zen-navigation-filter/results.json --benchmark
```

The driver creates a new guarded profile and a separate disposable SQLite
database. `--source-modules` registers the source modules only inside that fixture;
omit it to verify the packaged application.

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
input event type into the query context. Removing only the completion dismisses
history for the unchanged query; deleting typed text refreshes matching history.
Scoped paste can complete as in the reference. URL placeholders
are cleared at this boundary, so a previous engine's placeholder is never reused.

### Deleting typed text versus an inline completion

The query context records whether a deletion left the previous search string
unchanged. This catches removal of the selected completion suffix without treating
every Backspace or Delete as a request to dismiss history. The previous query is
read before `startQuery` updates it; programmatic queries without a deletion event
do not inherit the flag. Ordinary deletion still disables inline completion.

In the native Arc command bar on 2026-11-04, deleting a typed unmatched suffix
restored matching history, whereas removing the selected completion left the
literal query alone. The prior Zen package reproduced the mismatch through trusted
keyboard input in a disposable profile. The updated package passed 30 behavior
checks across YouTube, Amazon and Google, plus trusted-event verification and the
existing 15-check typed-history and 18-check scope-routing fixtures. Tests cover
repeated Backspace, forward Delete, arrow-selected completions, restoring completion
by typing, and clearing the query back to recents. This does not resolve the separate first-query ordering
or initial flash verification gaps.

```sh
python3 tools/site-search-history/test-browser-deletion.py \
  --app /path/to/Zen.app --config-repo /path/to/Astralforge \
  --report /tmp/zen-site-search-deletion/results.json
```

The driver seeds only a new `zen-search-typed-` profile and uses the existing
network-isolated benchmark harness. The fixture refuses ordinary profiles.

## Case-sensitive completion

The native Arc command bar preserves uppercase and mixed-case input when its
history suggestions begin with lowercase letters. Lowercase input completes with
a selected suffix. Returning to the default row restores that distinction.
Selecting a later row fills its complete term, placing the caret at the end when
the term does not begin with the typed prefix. Enter uses the
selected scoped history result even when it has no inline completion, provided
its engine and original query still match the active scope.

On 2026-11-05, the installed baseline failed the first trusted-keyboard regression
by adding a suffix to uppercase input. The updated package passed 31 checks across
YouTube, Amazon and Google: uppercase, mixed-case and lowercase input, retained
history choices, arrow selection, full selected-search submission, and trusted
input events. The fixture uses synthetic history in a disposable profile and a
network proxy that rejects external page loads. This does not resolve the separate
first-query ordering or initial flash comparison gaps.

```sh
python3 tools/site-search-history/test-browser-case.py \
  --app /path/to/Zen.app --config-repo /path/to/Astralforge \
  --report /tmp/zen-site-search-case/results.json
```

### Whole characters and explicitly selected results

The completion boundary uses whole Unicode characters and canonical equivalence,
as Swift's `String.hasPrefix` does. Raw JavaScript prefixes can end inside an
accented letter, a flag, an Indic character or a joined emoji. The default result
leaves such input unchanged. Arrow-selecting a later result displays its full
term, selecting only a matching suffix or placing the caret at the end otherwise.
Empty scopes continue to show their prompt when moving among recent searches.
This changes input presentation; history eligibility and ranking remain unchanged.

Read-only Arc 1.171.0 inspection traces the completion observer at `0x102230358`:
it passes a nonmatching completion to the field only for a nonzero highlighted
index. The field routine at `0x10223c004` writes the complete suggestion, checks
Swift's prefix predicate at `0x10223c04c`, and uses NSString UTF-16 lengths for
selection at `0x10223c0b0`–`0x10223c118`. Native UI checks on 2026-11-05 confirm
uppercase and mixed-case input remain unchanged on the default row, fill the
complete term with no suffix selection on the next row, and restore typed input
on return. Lowercase input selects the matching suffix in both rows. No reference
search was submitted or history modified.

`CompletionPrefixReference.swift` generates the 830 synthetic cases in
`completion-prefix-reference.json` using the same macOS Swift runtime. The cases
cover combining accents, reordered marks, canonical forms, letter case, emoji
modifiers, flags, joined emoji, Indic and Hangul clusters, and CRLF. Both Node and
the packaged Firefox helper are compared with those outputs. This is a bounded
character comparison, not proof of every future ICU/Unicode version.

The installed baseline fails the trusted-keyboard arrow-selection regression.
It also completes inside an accented character in a separate disposable-profile
probe. The new browser driver exercises initial completion, trusted arrow keys,
returning to the default row, Backspace, Enter destinations and empty recents for
YouTube, Amazon and Google. Unicode queries are set through the actual provider;
these cases do not simulate an IME. The existing ASCII case and deletion suites
remain applicable. Opening-flash and first-whole-query ranking differences are
still unresolved.

```sh
python3 tools/site-search-history/test-browser-completion.py \
  --app /path/to/Zen.app --config-repo /path/to/Astralforge \
  --report /tmp/zen-site-search-completion/results.json
```

## Explicit scope and remote-capable engines

Read-only Arc 1.171.0 inspection on 2026-11-04 confirms the explicit scope filter
excludes live suggestion archetypes. `BrowserSearchResultType.searchSuggest` and
`searchSuggestEntity` (raw tags 1/3) convert at `0x102b799a0` to
`ChromiumArchetype.chromiumSearchSuggestion` (tag 2); exact lowercased title/query
equality instead converts to search-what-you-typed (tag 0). Neither passes the
explicit-engine predicate at `0x101d70e68`, which accepts only tags 3 and 6.

The same live `quantum computing` query produced ten ordinary Arc results,
including live completions, but only its literal query after `google.com` + Tab.
The scoped result stayed unchanged after settling and on a fresh repeat; no
search was submitted. Zen previously bypassed its history-ranking adapter for
remote-capable engines when suggestions were enabled. Those scopes now use the
same history/literal path as local-only engines. No global search preference is
changed, and private, preview, disabled-history, and disabled-adapter fallbacks
remain intact. This proves displayed suggestion eligibility, not equivalence of
remote results' possible influence before Arc's shared candidate-budget filter.

`browser-routing-validation.js` exercises a bundled engine with a suggestion
endpoint and both suggestion preferences enabled, through real Places records
and the command bar. It covers recent order, typed history, completion suffix,
literal fallback, deletion, and provider/privacy routing.

Packaged validation passed all 18 routing checks, 15 local-engine regression
checks, and 12 keyboard/remembered-choice checks with Google. The latter used
the existing choice validator with the engine name changed to Google after the
actual Cmd+T / site / Tab / query / Down / Enter sequence. See
`scope-routing-validation.json`. All 975 source tests also passed.
