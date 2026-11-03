# Command-result ranking

Work in progress. `ZenCommandRanking.sys.mjs` implements the scoring arithmetic
and promotion to explicitly supplied maximum indices;
it is not yet connected to the command-bar providers or installed in production.
This does not establish complete result-ordering parity.

`ZenCommandMatching.sys.mjs` supplies batched URL, title, and hot-word text
features through the optional macOS native library. Both modules are packaged
but remain unused by the result providers. The companion Astralforge builder
includes `ZenNativeCommandMatching.swift` when present in the desktop source.

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
  The rest of the applicability and candidate-generation rules still need
  tracing before provider integration.
- After sorting, preferred maximum ranks (`0x101d5c290`) can promote a result
  that falls below its configured index. The algorithm scans backward, processes
  the item shifted into the old position after each move, and promotes each
  result at most once. It never demotes a result that already ranks higher.
  The implementation requires explicit limits; the active reference limits
  have not yet been established.

The implementation accepts measured features and explicit applicable bonus
names. Missing measurements use `COMMAND_FEATURE_DEFAULTS`; no bonuses are
awarded based on a site name. Non-finite measurements and unknown fields are
ignored. Rejecting infinities is a defensive extension; only missing and NaN
replacement is established in the reference. Stable sorting retains provider
order for numerical ties; the reference's tie policy is not yet proven.

## Text matching

The candidate feature builder (`0x101d5398c`, property helper `0x101d53090`)
limits queries and searchable strings to 512 Swift Characters before matching.
Two distinct matching algorithms supply features:

- Fuzzy score (`0x10081683c`) lowercases both strings and splits the query on
  spaces, slashes, hyphens, and underscores. For each token, the failure-table
  builder (`0x1008152cc`) and prefix finder (`0x100814ebc`) measure the longest
  run anywhere and at a word boundary. Each contributes the sum of squares
  through its length. A complete match retains the run across overlapping or
  repeated copies: `ab` against `ababab` has lengths 6 and 6, scoring 182.
  Both delimiter sets were recovered from the constant character arrays.
- Token coverage (`0x10081ae78`) splits only on literal spaces. It uses Swift's
  Foundation case-insensitive range search with no locale, expands composed
  character ranges, and advances to each match's end. Coverage is the union of
  matched graphemes divided by text length; position is the first covered
  grapheme. An absent position is left missing for the scoring default.

The macOS implementation uses those same Swift/Foundation operations. They
are not interchangeable with JavaScript case folding or CoreFoundation search:
the installed runtime, for example, finds `ß` across `sb` as well as `ß`.
Composed-range expansion around U+034F also differs from JavaScript grapheme
segmentation. Retaining the native APIs avoids hand-written Unicode exceptions.

Hot words compare fuzzy score, then coverage, then inverse position. Accepted
updates retain the greatest coverage seen so far; an absent new position leaves
the previous position intact. The matcher shares its prepared query and text
cache across each batch, and drops all text when the synchronous call returns.
Only numeric features return to Gecko. Candidate identity and activation stay
in the browser. A missing or older native library returns no feature batch;
future integration must retain the existing provider behavior in that case.

The fuzzy control flow was checked against 3,009 synthetic cases by running
the original ARM64 instructions in isolated emulation. Only allocation,
character equality, membership of the recovered boundary set, and memory
management were substituted. No Arc process was attached or changed. Coverage
was compared with 25 targeted, 2,616 Unicode mapping, and 3,500 mixed-text cases
using the traced Foundation operations. These checks establish the matching
kernel's tested behavior, not complete candidate generation or result ordering.

## Observed interaction constraints

Arc's command bar was inspected without submitting searches or changing its
saved configuration. On the same existing Main Space:

| Input | Initial selection | Search row |
| --- | --- | --- |
| `you` | YouTube, Switch to Tab | second |
| `goo` | Goodreads, Switch to Tab | second |
| `g` | Gmail, navigation result | second |
| `book` | Booking.com, navigation result | second |
| `accelerate` | matching custom-named tab | second |
| `weak` | Weaknesses, Switch to Tab | second |
| `options` | Options, Switch to Tab | second |
| `zxqv-no-match` | web search | first |
| `https://youtube.com/` | literal URL navigation | second |

These are observations of one profile, not site-specific rules. In particular,
promoting every matching tab would violate the `g` and `book` cases. Arc also
initially completes `you` to `youtube.com`, selecting the added suffix; moving
between rows has different input-preservation behavior.

## Validation

```sh
node --test scripts/tests/command-ranking.test.mjs
node tools/command-ranking/benchmark.mjs
xcrun swiftc -O -emit-library tools/native-theme-runtime/ZenNativeCommandMatching.swift \
  -o /tmp/libzen-command-matching.dylib
python3 tools/command-ranking/test-native-matching.py \
  --library /tmp/libzen-command-matching.dylib --benchmark
```

Tests use independently calculated examples for population normalization,
category averaging, missing values, query-local changes, every signal direction,
bonus denominators, constant signals, disabled categories, malformed data,
timestamp precision, stable non-mutating sorting, and maximum-index promotion
with competing limits. They validate scoring and promotion semantics, not
browser integration or visual parity.

Before enabling this in production, finish candidate feature extraction beyond text,
general bonus rules, active preferred maximum ranks, current-item demotion, duplicate
handling, asynchronous provider updates, and initial input completion. Verify
the resulting command bar against Arc, including privacy/container boundaries,
literal URLs, split views, search modes, actions, and keyboard activation.
