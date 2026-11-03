# Command-result ranking

Work in progress. `ZenCommandRanking.sys.mjs` implements the scoring arithmetic;
it is not yet connected to the command-bar providers or installed in production.
This does not establish complete result-ordering parity.

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

The implementation accepts measured features and explicit applicable bonus
names. It does not infer missing values or award bonuses based on a site name.
Non-finite measurements and unknown fields are ignored. Stable sorting retains
provider order for numerical ties; the reference's tie policy is not yet proven.

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
```

Tests use independently calculated examples for population normalization,
category averaging, missing values, query-local changes, every signal direction,
bonus denominators, constant signals, disabled categories, malformed data,
timestamp precision, and stable non-mutating sorting. They validate scoring
semantics, not browser integration or visual parity.

Before enabling this in production, finish candidate feature extraction,
general bonus rules, preferred maximum rank, current-item demotion, duplicate
handling, asynchronous provider updates, and initial input completion. Verify
the resulting command bar against Arc, including privacy/container boundaries,
literal URLs, split views, search modes, actions, and keyboard activation.
