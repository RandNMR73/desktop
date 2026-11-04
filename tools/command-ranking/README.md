# Command-result ranking

Work in progress. `ZenCommandRanking.sys.mjs` implements the scoring arithmetic,
the traced post-sort passes, and promotion to explicitly supplied maximum indices;
it is not yet connected to the command-bar providers or installed in production.
This does not establish complete result-ordering parity.

`ZenCommandMatching.sys.mjs` supplies batched URL, title, and hot-word text
features, general ranking bonuses, completion text, phrase-search predicates,
and query-specific maximum indices through the optional
macOS native library. The opt-in tab adapter also uses native URL comparison
keys. Normal result-provider calls still leave ranking disabled. The companion Astralforge builder
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

## Text matching

The candidate feature builder (`0x101d5398c`, property helper `0x101d53090`)
limits queries and searchable strings to 512 Swift Characters before matching.
Searchable URL properties (`0x101d6c04c`) first apply the display normalization
described below, then the character limit. Bonus evaluation retains the original
URL. The standalone text-only API continues to match the strings supplied by its
caller without URL normalization.
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
The original text-only call returns numeric features. Candidate identity and activation stay
in the browser. A missing or older native library returns no feature batch;
future integration must retain the existing provider behavior in that case.

The fuzzy control flow was checked against 3,009 synthetic cases by running
the original ARM64 instructions in isolated emulation. Only allocation,
character equality, membership of the recovered boundary set, and memory
management were substituted. No Arc process was attached or changed. Coverage
was compared with 25 targeted, 2,616 Unicode mapping, and 3,500 mixed-text cases
using the traced Foundation operations. These checks establish the matching
kernel's tested behavior, not complete candidate generation or result ordering.

## General bonuses and completion

Native ABI 2 added `matchCommandCandidateSignals`, returning numeric text
features, bonus names, and completion text in provider order. ABI 1 remains
supported for the original text-only call. Candidate identity and activation
never enter native code. Unknown archetypes fail the batch, rather than receive
a guessed category. These signals are not yet used by the live command bar.

The 14 implemented bonus rules were traced from `0x101d7f8b8`:

| Bonus | Condition |
| --- | --- |
| Exact base domain | Non-tab navigation-like candidate with both exact-URL and root-prefix matches |
| Exact URL | Exact-URL match; non-tab candidates also require no root-prefix match |
| Base domain | Root-prefix match; non-tab candidates also require no exact-URL match |
| Exact hot word | A whole hot word equals the nonempty query after lowercasing |
| Default autocomplete | Nonempty query prefixes the completion of a navigation-like candidate |
| Search autocomplete | Same prefix condition for a search-like candidate |
| Chromium special search | Chromium search-like candidate has measured rank exactly 1 and the lowercase query matches the operator syntax |
| Custom title prefix | Nonempty query prefixes a tab's custom title or a document's title, after lowercasing |
| Very recent item | Tab, document, or easel with navigation age strictly below 3,600 seconds |
| Top app | Tab, document, or easel with global saved context; scoped/unsaved items do not qualify |
| Recently used action | Action has more than one retained execution record |
| Action prefix for long query | Action hot word starts with the lowercase query, whose lowercase Swift Character count is at least three |
| Onboarding promotion | Optional menu promotion set is present, and the action is a browser extension, tab rename, or menu item with an identifier in that set |
| High fuzzy confidence | Measured confidence strictly above 0.8 |

URL helpers (`0x101d81364`, `0x101d816a4`) exclude empty queries, `arc://`
queries, and search-like archetypes. Exact matching compares normalized URLs,
then the lowercase query against the original candidate URL. Root-prefix
matching requires a path containing only slashes and no query component—even
an empty `?` disqualifies it. A fragment does not. It trims slashes from the
query, then checks prefixes against the original and normalized candidate URL.
The path/query witness methods resolve to Foundation's URLComponents getters.

Normalization (`0x1008270d8`, option 1; wrapper `0x1007ebc7c`) removes one `?`
suffix, one `/` suffix, one lowercase HTTP(S) scheme, and one lowercase `www.`
prefix, in that order, then lowercases the result. It does not canonicalize
ports, credentials, percent escapes, or repeated slashes. The original ARM64
control flow was executed for 960 synthetic ASCII cases with Swift String
primitives substituted. The native implementation agrees on all 960 cases.

Completion (`0x101d710fc`) uses that normalized URL for tabs, top domains,
literal navigation, Chromium history, navigation suggestions, and bookmarks;
documents and easels use lowercase titles. Search and other provider-owned
completion strings must be supplied explicitly. Chromium's literal-navigation
completion uses its supplied text, unlike its history/navigation suggestions.
Boost comparisons retain full strings and Swift canonical equality/prefix
semantics; they do not use the matching feature's 512-character truncation.

ABI 4 adds explicit action metadata. `recordedExecutionCount` is the number of
retained records in `TypeTravelUsage.executed`, not its separate lifetime
`frequency` field. The reference looks up the action's deduplication key in
`AdditionalFeatureInfo.typeTravelUsage` and tests the record count against one
(`0x101d80928`). The provider must supply this measured count and remains
responsible for storing/pruning records; that integration is pending.

The long-query path (`0x101d7fdcc`, `0x101d806ac`) compares the optional action
against **nil**, not against the currently selected action. It lowercases the
query before counting Characters, then checks each lowercased hot-word prefix.
There is no three-character condition on the other action bonuses.

Onboarding (`0x101d80810`) requires the optional `menuItemIDsToBoost` set to
exist. An explicitly empty set still enables browser-extension and rename-tab
promotions. Menu items use their identifier, with Swift canonical equality and
case sensitivity. No action is inferred from a displayed title. Unknown action
kinds or absent metadata on an action reject the batch; the JS bridge also
rejects action requests on older native versions. Only the action kind, menu
identifier, and retained count cross the bridge, not activation or history.

The three original action-branch paths were executed in isolated ARM64
emulation for 2,381 synthetic cases. Swift enum/optional operations, ASCII
strings, and collection lookups were supplied by the harness. These checks
cover all 35 action cases, the optional-context distinction, count boundaries,
and query prefixes. Separate native checks cover composed Unicode. They do
not validate action generation, usage-history maintenance, or visible ordering.

Action candidates, provider extraction beyond tabs, and final result
ordering remain unfinished. Alternate LazyURL representations also need
provider-level verification.

## Query policies

Native ABI 3 adds `commandQueryRules`. The live reference input builder calls
`0x1021e4cd0` before constructing the ranking input at `0x101d91024`. The policy
sets only the following maximum zero-based indices; all other archetypes are
unrestricted. Conditions are evaluated in this order:

| Context | Literal navigation | Literal search and Chromium literal search | Assistant | Chromium literal navigation |
| --- | --- | --- | --- | --- |
| Backspace leaves a recognized URL, nonempty query | 0 | 1 | 2 | 0 |
| Backspace leaves search text, nonempty query | none | 0 | 1 | 0 |
| Private window | 0 | 1 | 2 | 0 |
| Operator syntax | none | 0 | none | none |
| At least four Swift Characters | none | 1 | 2 | 0 |
| Shorter query | none | 1 | none | none |

A final Swift Character equal to `?` independently sets the assistant limit
to 1; it does not change the Chromium navigation limit. A question mark at the
beginning has no such effect. Length and final-character comparisons use the
full query, without the text-feature limit. These are caps used by the existing
promotion algorithm, not unconditional placements for results that already
rank higher.

Operator recognition (`0x101d81c88`, literal at `0x103a28380`) uses
`NSRegularExpression.firstMatch` over the complete UTF-16 range. It accepts
`word:word` after excluding known URL-scheme prefixes. The exclusion is a
prefix check: for example, `filetype:pdf` is excluded by `file`. The query policy
uses the original query, whereas the Chromium bonus lowercases it first.
Consequently `HTTP:cats` qualifies for the policy but not the bonus. The bonus
also requires one of Chromium's five search-like archetypes and rank exactly 1.

The policy control flow was executed in isolated ARM64 emulation for 2,112
synthetic ASCII cases. Metadata setup, String/regex primitives, and optional-URL
runtime operations were supplied by the harness. Explicit URL interpretation
was an input to these checks. ABI 5 now derives that interpretation and the
Backspace condition as described below. Explicit interpretation remains an
optional API input for callers that already have a classification. Older native
ABIs return no Backspace-policy result while retaining their supported APIs.

## URL interpretation and Backspace

The query classification flag is the `didBackspace` field of
`Action.updateQuery(query:didBackspace:)`, not a general navigation-mode flag.
The reducer's case-zero jump at `0x1021db634` reaches `0x1021dbcc8`, which loads
the String and Bool payload. The Bool passes through `0x1021df714` into the
policy helper at `0x1021dffd8`. Every other identified input-builder call passes
false. Zen's input-event mapping is still pending; this API accepts the measured
flag and does not infer it from query length or Firefox autofill.

The loose URL parser (`0x100820824`) first invokes `0x100810408`, which
lowercases the original query and checks six Swift Regex patterns using
`wholeMatch` (`0x100813c44`). They recognize localhost/127.0.0.1, four decimal
IPv4 components, ASCII domain names with at least two letters in the suffix,
and the chrome/arc/file schemes. The first three permit optional HTTP(S), a
one-to-five-digit port, and a query/path/fragment suffix. There is no DNS/TLD
lookup, IPv4 octet-range check, whitespace trim, or generic URI-scheme fallback.
The initializer control flow was executed to recover the assembled patterns;
the implementation uses Swift Regex too, preserving grapheme semantics.

For a match, `0x100820c14` preserves an existing HTTP(S), chrome, or file scheme;
otherwise it prepends `http://` to the original case-preserved query. The next
helper (`0x100820d78`) removes percent encoding, adds it using the union of all
six URL component character sets plus `#`, then obtains `URLComponents.url`.
A failed decode or parse gives search interpretation. This order means `%2F`
can become a path separator. `navigationURL` reports this parser's output; it
does not replace provider routing for internal commands or unsupported schemes.

ABI 5 returns that interpretation alongside the existing query policy. With
`didBackspace: true` and nonempty text, navigation or search promotion takes
precedence over the private-window rule. Ordinary typing retains the previous
query policy even when the parser recognizes a URL. Empty deletion retains
the existing empty-query policy.

Validation executes the original URL gate, prefix and optional-result branches
for 388 synthetic inputs, with Swift Regex/Foundation operations supplied by
a separate reference harness. The patterns come from the original initializer
trace. These cases include Unicode, percent encoding, local addresses, malformed
text, whitespace, ports and schemes. An additional 54 native checks cover the
Backspace-policy interaction. This establishes the tested helper behavior,
not the browser's complete navigation or visible result ordering.

## Prepared URL comparison keys

ABI 7 adds `prepareCommandURLs`, a batched comparison-only API. The original
activation URL is never replaced. It returns a `normalizedURL` for URL-backed
selection identities, a `deduplicationURL` for tab/history comparisons, and an
optional `isRootURL` measurement from the original URL's components. An
unparseable URL retains its original text and has no root measurement.

The LazyURL resolver (`0x1007ea630`, normalization at `0x1007ea6f0`) prepares
lowercase URL components. Its component transform (`0x100825b78`) first adds
`https://` when neither scheme nor host exists (`0x100826da0`), and replaces
an absent or HTTP scheme with HTTPS. A leading `www.` host is split on dots,
with empty pieces omitted, then rejoined without its first piece.

Ordinary fragments are removed. A fragment beginning with `!` is preserved,
with one trailing slash removed, and prevents path-slash removal. Otherwise
one trailing path slash is removed. That path is read from the original
components, even when the missing-scheme helper constructed a host. Query
items with absent/empty values or `utm_` names are removed. Retained items stay
in their original order; query components are reassigned only when filtering
changed the list, or cleared when it is empty. This matters for percent-encoded
values: an unchanged query is not decoded and re-encoded unnecessarily.

The prepared object's stored string is returned by `0x1007eb70c` /
`0x1007ec414` for selection identities. `0x1007ebc88` additionally applies
display normalization for duplicate comparisons. Root measurement remains
separate: a query component, even an empty `?` or tracking-only query,
disqualifies a root URL; fragments do not. The native batch cache uses UTF-8
bytes because canonically equivalent Swift strings can produce different
percent-encoded representations. No keys persist after the call.

Validation covers 723 synthetic URLs through the original component-transform
branches in isolated ARM64 emulation. Foundation parsing/serialization, ASCII
String primitives, metadata, memory management and array copy/remove operations
are supplied; LazyURL caching/case detection and root predicates are outside
that emulator's scope. Forty-four native checks additionally cover malformed
URLs, Unicode byte forms, hashbang routes, query values, root measurement and
batch validation. Twelve real Gecko checks exercise lazy tabs, separate tabs
at equivalent addresses, split activation mappings, Space filtering and native
history replacement. These are integration checks for metadata and the initial
ordering passes, not proof of complete visible result ordering.

## Tab metadata extraction

`ZenUrlbarProviderRecentTabs.typedScope` optionally returns candidates alongside
its existing activation payloads when `includeRanking` is explicitly enabled.
Normal provider calls leave this disabled. The candidate map uses the same
URL/container/group keys and most-recent duplicate selection as the activation
map. Private-window and Space/profile filtering happens before extraction.
Each candidate carries the same `tabID` used by its activation payload. With
ABI 7 available, one batch supplies its prepared URL and duplicate key; older
libraries leave those fields absent. These comparisons do not collapse separate
tabs or replace the provider's URL/container/group activation map.

Ordinary candidates also expose a kind-3 `selectionIdentity` containing that
prepared URL. The getter at `0x101d6c9bc` uses this identity when `containerID`
is absent, as in the normal tab constructor at `0x101d6955c`. A present
container ID instead uses kind 8. Split results leave their selection identity
absent until that container/wrapper mapping is verified; a Firefox user-context
ID or generic folder ID is not a substitute.

Visibility comes from the reference provider's `cachedVisibleItemIDs`
(`0x102b9442c`), populated by traversal of Favorites, pinned and unpinned roots
in the focused Space. `0x1028a06f4` consults `expandedItems` for each list:
an absent entry hides its children, `.expanded` includes them, and `.peeked`
includes only the stored subset. The inherited `PersistedWindowData` witness
at offset `0x118` resolves to `0x100274b08`, which loads WindowState's field 16
(`expandedItems`) at offset `0x168`; reflection and the metadata field-offset
vector confirm that binding. Pinned roots separately consult the collapsed
section's optional peeked item (`0x1028a03f0`). This is logical row visibility,
independent of selection and viewport intersection.

The Zen adapter reads the existing `tab.visible` getter, which follows collapsed
ancestors and their active/revealed tabs, including collapsed pinned sections.
A split result is visible when any member is visible; unknown measurements stay
absent. This needs no layout measurement and does not activate unloaded tabs.
Fourteen real Gecko checks cover expanded/collapsed nested folders, revealed
children, collapsed pin sections, Favorites, stale-tab ordering, ordinary
selection identity and the current-tab exception. Learned history is supplied
by the fixture; actual history persistence and exact split-wrapper equivalence
remain unverified.

The saved-item feature builder (`0x101d69914`) obtains an ancestor array from
`0x100d50d64`, starting with the item itself and following parent IDs. Its count
becomes `saveLevel`. Direct saved items have an item-container root, so Favorites
and direct pins both have level 2; every enclosing folder adds one. A combined
split result counts its wrapper rather than an additional pane. Ordinary tabs
have no saved context or level. The context mapper (`0x101d695ac`) maps the
Favorites location to global, a Space's saved area to scoped, and the remaining
locations to no saved context.

The feature named `lastNavigated` is populated from the saved item's
`timeLastActiveAt`, not its page-navigation date. The Zen adapter measures seconds
since `lastSeenActive` (or `lastAccessed` when that API is absent); for a combined
split it uses the latest pane activity. This maps to Gecko's visible-activity
timestamp, including its existing restored-tab fallback. Exact cross-window
focus and split-wrapper timestamp equivalence still need comparison with Arc.

The tab constructor (`0x101d68c58`) stores a live title separately from
`customTitle`; the latter falls back from an explicit sidebar name to the saved
page title. Therefore even an unrenamed saved title can earn the prefix bonus.
The adapter reads `zenStaticLabel`, the saved initial title, and the live browser
title without restoring unloaded tabs. Text matching uses the live-title field;
the prefix bonus uses the saved/renamed field. The reference's hot-word builder
(`0x101d6d534`) supplies hot words only for action candidates, so the tab adapter
does not invent them from titles or site names.

This supplies tab metadata for subsequent ranking integration. It does not yet
change command ordering, initial selection, or input completion.

## Initial post-sort rules

`applyInitialCommandRules` implements the first three passes after numerical
sorting, before preferred-maximum-rank promotion:

1. `0x101d5bda4` swaps the first two rows when the leading result is a tab,
   its optional `isVisible` is not true, its navigation age is strictly greater
   than 604,800 seconds, and the immediately following row is any Chromium
   archetype. It does not search farther down the list. Missing/non-finite ages
   use the same upstream 60-day default as scoring.
2. `0x101d63c9c` groups tabs by prepared URL in their current order, then uses
   `0x101d6476c` to replace a Chromium **history** row with the first matching
   tab whose ID has not been emitted. Each tab ID appears at most once; separate
   tabs at the same URL remain separate. The replacement retains the tab row,
   score and activation identity, not the history row's score.
3. `0x101d64364` removes Chromium history rows whose prepared URL matches a
   preceding tab. Navigation/search suggestions and bookmarks are retained.
   Repeated history URLs without a matching tab are also retained by these passes.

The implementation accepts explicit `tabID`, `isVisible` and
`deduplicationURL` metadata. Keys use NFC equality to preserve Swift String's
canonical equivalence. Missing IDs/keys are not inferred from titles or raw
URLs. URL preparation follows the reference's
call `0x1007ebc88`, which resolves a LazyURL representation through
`0x1007ea630` before applying display normalization. ABI 7 supplies those keys
to the opt-in tab adapter as described above, along with logical visibility.
Non-tab providers and exact split-wrapper mapping still need integration before
live ordering is enabled.

Validation compares 1,092 synthetic cases against the original stale-tab,
per-row replacement and final history-filter control flow in isolated ARM64
emulation. Runtime metadata/copies, prepared URL keys, String equality and
collection operations are supplied by the harness. URL grouping follows the
traced first traversal. Cases cover the one-week boundary, optional visibility,
all Chromium kinds, repeated URLs, shared/distinct tab IDs, and competing tab
and history positions. Ten additional unit tests cover missing metadata,
non-mutation, score preservation and promotion order. These tests do not
establish live provider behavior or complete result ordering.

The ranking path remains disabled in the installed browser.

## Current-page context and instant-link placement

`applyCurrentItemRules` implements `0x101d5b780`. With explicit enabled context,
at least two results, and a leading result for the current page, it moves the
first alternative to the front. Other rows and their scores remain unchanged.
Literal navigation to the current URL, root pages, and URLs in the most-visited
list are exempt. A candidate without a URL counts as an alternative. Equality
uses raw URL strings with Swift canonical Unicode equivalence, independently
of the prepared key used by history/tab deduplication.

The provider must supply `derankCurrentItemURL: true`, a `currentItem` with
`id`, `url`, and `isRootURL: false`, and optional `mostVisitedURLs`. Unknown root
status does not enable the rule. The reference root predicate (`0x100824600`)
requires an absent query and a path that is empty after trimming slashes; it
has not yet been connected to the provider. No homepage exception is guessed
from display text.

`applyInstantLinksPosition` implements `0x101d5fed8`: move the first instant-links
row immediately after the first literal web-search row if it occurs farther
down. Links already before or adjacent to that search remain in place. Search
suggestions, history, calculators, other engines, and assistant queries do not
serve as this anchor.

The implemented pipeline applies current-page context after the initial three
passes and before maximum-rank promotion; instant-link placement runs last.
The intervening learned-selection and phrase-search passes are described below.

Validation compares 323 current-page and 1,365 instant-link cases against the
original ordering control flow in isolated ARM64 emulation. URL extraction,
raw string equality, the root predicate, and runtime collection primitives are
supplied by the harness. Eight unit tests additionally cover missing context,
literal navigation, raw versus prepared URL equality, canonical Unicode,
non-mutation, and pipeline order. These checks establish the ordering kernels
with supplied metadata, not live provider behavior or visible parity.

## Remembered choices and phrase searches

`applyLearnedSelection` implements `0x101d5df4c`, immediately before current-page
context. The additional-info dictionary is queried with the exact input string:
case and surrounding whitespace matter; canonical Unicode equivalents compare
equal. A remembered choice remains eligible while the absolute age is at most
86,400 seconds, including a timestamp slightly in the future. The first row with
the remembered selection identity moves to the front, unless that row is a tab
with the current item's tab ID. That exception stops the pass; it does not look
for another row with the same selection identity.

The selected record is supplied as `selectedResult: { query, identity,
ageSeconds }`. Each candidate's `selectionIdentity` uses the reference's enum
discriminant (`kind`, 0–8) and associated `value` string; case 2 also compares
`secondary`. These are explicit native/provider inputs, not inferred from a
tab's ID or display URL. The getter (`0x101d6c9bc`) distinguishes lowercased
search queries, prepared navigation/tab URLs, document/easel IDs, action IDs,
container IDs and prefixed special-result identities. Its provider mapping and
the history store's update/pruning lifecycle remain pending.

The provider must also supply `suggestionsEqual(a, b)` with full reference
Suggestion equality, including archetype contents, source info, score and
debug feature/bonus values. Promotion filters only rows equal to the promoted
row. Other duplicates remain, and sharing a selection identity does not imply
full equality. Until the history identity and equality mapping are supplied,
the learned pass is inactive. It does not guess equality from result titles.

`applyPhraseSearchRules` implements `0x101d5ef10` after maximum-rank promotion
and before instant-link placement. It activates for a literal-space query that
the native loose URL parser does not recognize. The first literal web-search
row moves first. If the first remaining row is an action and the lowercased
query begins with one of that action's lowercased hot words, the action stays
first and search follows. This prefix direction is the inverse of the action's
scoring bonus. Only this action branch filters full duplicates of both promoted
rows; ordinary search promotion removes just the selected array occurrence.

Native ABI 6 supplies `isPhraseSearch` from query rules and
`phraseSearchActionPrefix` for each candidate's signals. It uses the same
Foundation `contains` and Swift `lowercased`/`hasPrefix` imports as the reference,
preserving canonical Unicode and grapheme boundaries. A URL path containing a
space remains a URL; tabs and nonbreaking spaces do not activate this phrase
rule. Policy overrides, privacy and Backspace do not replace this independent
URL check. The bridge retains older ABI support and rejects missing/malformed
phrase flags from ABI 6. An action with unknown prefix state or without the
full-equality callback does not activate the action branch.

The learned pass matches 285 synthetic original-control-flow cases; the phrase
pass matches 1,547. The harness supplies the identity getter, archetype equality,
empty debug metadata, Date/runtime operations and collection representations.
Phrase references additionally supply URL classification and ASCII String
operations. Original ordering branches, optional checks, scalar equality and
filter loops run in isolated ARM64 emulation. These comparisons do not validate
the history store, identity extraction, arbitrary debug equality, or providers.
Thirteen source tests cover the ordering contracts; 35 native checks cover
phrase classification and Unicode action prefixes. Eleven real Gecko checks
verify native flags, ordering and activation-object preservation with synthetic
rows. Live command ordering remains disabled.

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
node tools/command-ranking/test-post-sort-reference.mjs /path/to/initial-post-sort-reference.json
node tools/command-ranking/test-context-ordering-reference.mjs /path/to/current-item-reference.json /path/to/instant-links-reference.json
node tools/command-ranking/test-learned-selection-reference.mjs /path/to/learned-selection-reference.json
node tools/command-ranking/test-phrase-search-reference.mjs /path/to/phrase-search-reference.json
node tools/command-ranking/benchmark.mjs
xcrun swiftc -O -emit-library tools/native-theme-runtime/ZenNativeCommandMatching.swift \
  -o /tmp/libzen-command-matching.dylib
python3 tools/command-ranking/test-native-matching.py \
  --library /tmp/libzen-command-matching.dylib --benchmark
python3 tools/command-ranking/test-native-boosts.py \
  --library /tmp/libzen-command-matching.dylib --benchmark
python3 tools/command-ranking/test-native-query-rules.py \
  --library /tmp/libzen-command-matching.dylib
python3 tools/command-ranking/test-native-phrase-ordering.py \
  --library /tmp/libzen-command-matching.dylib
python3 tools/command-ranking/test-native-url-keys.py \
  --library /tmp/libzen-command-matching.dylib --benchmark
```

Tests use independently calculated examples for population normalization,
category averaging, missing values, query-local changes, every signal direction,
bonus denominators, constant signals, disabled categories, malformed data,
timestamp precision, stable non-mutating sorting, and maximum-index promotion
with competing limits. They validate scoring and promotion semantics, not
browser integration or visual parity.

Before enabling this in production, finish candidate feature extraction beyond text,
action generation/history, non-tab metadata and exact split-wrapper mapping, current-item
context, learned-choice history/identities, full Suggestion equality, asynchronous
provider updates, and initial input completion. Verify
the resulting command bar against Arc, including privacy/container boundaries,
literal URLs, split views, search modes, actions, and keyboard activation.
