# Prefix history and command result batches

The live site-search provider now reads and accumulates command result batches.
Entering a site scope from an alias can retain the initial result order while
later matches arrive. Direct scope entry, incremental typing and cleared input
use their own current query state. This change does not alter the opening color
flash.

Arc's recorded alias-to-scope transition contains an intermediate batch with old
HistoryURL matches. Its command publisher retains each result's first position
and score, appending identities introduced by later batches. Replaying the two
recorded batches reproduces the observed whole-query ordering without new ranking
weights. A single final batch loses this behavior.

`ZenCommandResultBatches.sys.mjs` models unfinished-provider carry-over and
per-query accumulation. `ZenCommandPrefixHistory.sys.mjs` models the typed-only
and final URL-prefix passes. Its significance rule follows the inspected Arc
binary: a typed visit, at least two ordinary visits, or a visit within 90 days.
Saved native prefix comparisons cover YouTube, Amazon, ChatGPT, Reddit and X.
These comparisons validate candidate records, not every live command-bar frame.

`ZenCommandPrefixHistoryReader.sys.mjs` supplies those records from Places:

- Ordinary host prefixes use the host/origin and page-origin indexes. Other
  prefixes scan origins; they do not scan all pages or visits.
- Each prefix's database limit precedes significance and engine exclusion.
  Exact URLs and qualifying shorter URLs outside that pool are read separately.
- Typed counts come from typed visits, not the boolean `moz_places.typed` flag.
- Redirect culling uses the newest visit's forward chain. A subsequent direct
  visit supersedes an older chain; ordinary navigation links are not redirects.
- Cancellation returns no partial batch. Reads have no persistent cache and make
  no schema changes, so deleted history disappears on the next query.

The redirect selection follows Chromium's
[HistoryBackend::QueryRedirectsFrom](https://github.com/chromium/chromium/blob/156.0.8078.74/components/history/core/browser/history_backend.cc#L2906).
Places does not preserve every Chromium visit attribute, including its 404-visit
policy. Firefox URL fixup is supplied by the caller; this reader does not establish
Chromium/Firefox fixup equivalence for every input.

Run the browser reader validation with:

```sh
python3 tools/site-search-history/test-browser-prefix-reader.py \
  --app /Applications/Zen.app \
  --config-repo /path/to/Astralforge \
  --source-modules --benchmark --report /tmp/zen-prefix-reader/results.json
```

This creates a guarded disposable profile and seeds synthetic Places history.
The exhaustive reference reads all eligible records before applying the model;
the candidate uses bounded/indexed reads. The 128 passing checks cover prefix
limits, exact/shorter lookup outside the pool, schemes, ports, encoded URLs, file
URLs, exclusion, hidden/future records, redirects, corrupt cycles, deletion and
cancellation. Query plans confirm indexed page access. In seven warm reads with
2,000 additional unrelated origins, the reader measured a 2.69 ms median. This
small local measurement excludes rendering, provider integration and page loads.
See `prefix-reader-validation.json` for the reader-only checks.

`ZenCommandPrefixSessions.sys.mjs` retains only records actually published by
the current per-window reader. Empty scoped recents preserve the preceding alias;
engine changes, closing the bar, history deletion, disabled history and private
queries invalidate it. Superseded asynchronous readers cannot repopulate state.
Each batch passes through the existing candidate budget, scope filtering and
command ranking before new identities are appended to the visible results.

Run the live integration check with:

```sh
python3 tools/site-search-history/test-browser-batches.py \
  --app /path/to/test/Zen.app --config-repo /path/to/Astralforge \
  --report /tmp/zen-prefix-batches/results.json
```

The candidate passes 54 real-browser batch/session checks across YouTube,
Amazon, Google, Reddit, X and ChatGPT. The preceding installed archive fails the
alias-transition ordering assertion using the same synthetic history. Another
42 provider/routing checks, 140 trusted-keyboard/completion checks and 1,132 source
tests pass. See `live-batches-validation.json`.

Remaining limits: the prefix predecessor is the modeled URL-history provider,
not a replay of Chromium's entire global alias-result budget. A quickly cancelled
alias can publish fewer batches. Intermediate prefix-to-prefix carry-over and
all Firefox/Chromium URL-fixup cases are not established as equivalent. Saved
native reference replay and these integration checks do not prove every live Arc
interaction or animation frame matches. The initial color flash and overall
performance target require separate comparisons.

## Message-command activation

Ordinary native Arc keyboard observations distinguish the `chatgpt` command
from the `chatgpt.com` and `chat.openai.com` addresses. Tab or Space enters
“Send a Message…” only for the command. The two addresses remain ordinary
input. `message-trigger-reference.json` preserves the six field observations.

Message providers therefore use their configured command triggers. Their
domain aliases still identify palette/history metadata, but are excluded from
both Zen's site-search offer and Gecko's typed alias lookup. Filtering only
the offer fixed Tab while leaving a second Space-triggered entry path.

`test-browser-message-triggers.py` exercises real keyboard input in a disposable,
network-isolated profile. The corrected candidate passes fourteen cases: six
message/address cases plus Tab/Space entry for YouTube, Amazon, Reddit, and X.
The preceding candidate mismatches four of the six message/address cases.
The check also compares retained input and placeholders; this is not evidence
for flash timing, history order, or full Arc parity.
