# Command-result ranking

The scoped site-search provider uses this arithmetic and the native matcher for
local history results. Other command-bar providers retain their existing ranking.
This is not a claim of complete Arc result-ordering parity.

## Reference

Read-only inspection of the locally installed Arc arm64 executable on
2026-11-03, SHA-256
`e82d2a4245b6239860e41a149cb31c0c030e35b383456544c81f21d45ee03376`.
No executable code, user history, or captured private URLs are included here.

The reference's ASE2 default configuration is constructed at `0x101d50630`,
with the same values used by its fallback at `0x101d4fb74`. Swift reflection
provides the configuration field names and order. Its boost constructor at
`0x101d8d004` reads 14 weights and scores from constant tables. These defaults
are reproduced as numeric configuration, with `save.items.level` named
`save.items.saveLevel` to agree with the feature name.

The scoring path establishes:

- Before normalization, `addMissingFeatures()` (`0x101d54600`, called from
  `0x101d4d300`) fills all 21 features. Its helper (`0x101d547fc`) also replaces
  NaN measurements. The default table at `0x1037c94f0`, read by `0x101d90774`,
  supplies match positions of 30, navigation age of 5,184,000 seconds (60 days),
  most-visited rank 20, global rank 505, Chromium rank 11, and save level 8.
  All other missing features default to zero. Consequently, absent measurements
  participate in normalization and constant categories retain their weights.
- `Normalizer.init(items:)` (`0x101d57c60`) groups present candidate values by
  feature. Its mean and standard deviation helpers use the population count,
  not count minus one (`0x100789c44`, `0x100789e20`, `0x100789ef4`).
- `normalize` (`0x101d583bc`) computes `(value - mean) / deviation`, returning
  zero for zero variance. Bit mask `0x000ab6db` identifies features where larger
  values are better; positions, ages, ranks, and save levels have reversed signs.
- `suggestion(input:normalizer:additionalInfo:)` (`0x101d54f98`) separately scores
  archetype, feature categories, and applicable bonuses. Disabled categories
  are omitted (`0x101d55794`).
- Category evaluation (`0x101d55828`) averages normalized features using their
  individual weights, then applies the category weight.
- The final average (`0x101d9b9b4`, arithmetic at `0x101d9be34`) includes category
  and bonus weights in its denominator. Bonuses are not flat score additions.
- Bonus applicability (`0x101d7f8b8`) is evaluated once for each configured
  reason. Confirmed numeric thresholds include fuzzy confidence strictly above
  `0.8` and tab/document/easel navigation age strictly below `3600` seconds.
  All 14 applicability rules are implemented below. Action candidate generation
  and the complete provider pipeline still need integration.
- After sorting, preferred maximum ranks (`0x101d5c290`) can promote a result
  that falls below its configured index. The algorithm scans backward, processes
  the item shifted into the old position after each move, and promotes each
  result at most once. It never demotes a result that already ranks higher.
  The scoring module requires explicit limits; the native query-rule helper
  derives them from the reference's policy below. Live provider wiring remains
  disabled.

The implementation accepts measured features and explicit applicable bonus
names. Missing measurements use `COMMAND_FEATURE_DEFAULTS`; no bonuses are
awarded based on a site name. Non-finite measurements and unknown fields are
ignored. Rejecting infinities is a defensive extension; only missing and NaN
replacement is established in the reference. Stable sorting retains provider
order for numerical ties; the reference's tie policy is not yet proven.


## Scoped search integration

`ZenSiteSearchRanking.sys.mjs` prepares canonical search submissions, merges
case-insensitive duplicate terms, and assigns Chromium ranks after relevance
sorting and the local provider's three-suggestion cap. A literal search enters
first at relevance 1500 and does not consume a suggestion slot; a history duplicate
replaces it only at a strictly higher relevance. This follows Chromium's
[BaseSearchProvider](https://github.com/chromium/chromium/blob/156.0.8078.74/components/omnibox/browser/base_search_provider.cc).

The native browser-client results are converted by Arc at `0x102b799a0`.
Search history uses the history archetype except when its lowercased title equals
the query, which uses search-what-you-typed. Scoped literal search uses the
other-engine archetype. `0x102b7a3c4` assigns one-based chromiumRank after filtering.
Search completions use their title; search records do not add navigation-frequency
or navigation-age measurements to the command ranker.

`ZenCommandMatching.sys.mjs` batches text features and boosts through
`ZenNativeCommandMatching.swift` (ABI 8). No identity, activation callback, or
browsing database crosses this boundary. Query rules and score normalization
operate on the current candidate batch. The native implementation uses Foundation
and Swift string behavior for matching and URL interpretation. The bridge falls
back to existing browser providers if the native contract is unavailable.

The combined Search/HistoryQuick stage now merges duplicate navigation relevance
and applies the shared eight-result budget before the scoped filter. Its seven
navigation candidates and the Search provider's three suggestions have separate
provider limits. See `../site-search-history/README.md` for the reference comparison
and remaining limits. Other browser providers and final ordering still need work.

The default-enabled local adapter preserves the built-in live-suggestion provider
for engines with active remote suggestions. Merging those remote results into the
same ranking batch, remembered-choice promotion, and exact lower-result ordering
still need comparison. No query-, app-, or site-specific rank exceptions are used.

## Validation

```sh
node --test scripts/tests/command-ranking.test.mjs scripts/tests/command-matching.test.mjs scripts/tests/site-search-ranking.test.mjs
xcrun swiftc -O -emit-library tools/native-theme-runtime/ZenNativeCommandMatching.swift -o /tmp/libzen-command-matching.dylib
python3 tools/command-ranking/test-native-matching.py --library /tmp/libzen-command-matching.dylib --benchmark
python3 tools/command-ranking/test-native-boosts.py --library /tmp/libzen-command-matching.dylib --benchmark
```

`validation.json` records prior isolated scoring and native comparison evidence;
it is not a live-browser parity certificate. The current browser integration is
validated through the guarded disposable-profile fixture in
`tools/site-search-history/browser-typed-validation.js`.
