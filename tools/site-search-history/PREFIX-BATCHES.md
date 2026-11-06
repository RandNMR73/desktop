# Prefix history and command result batches

This is draft infrastructure for scoped command results. The modules are packaged
but are **not yet called by the live site-search provider**. Installing this branch
alone would not fix first-query ordering or the opening color flash.

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
All 1,124 source tests also pass. See `prefix-reader-validation.json`.

Remaining integration: capture actual per-window predecessor queries, preserve
provider completion/cancellation boundaries, rank each batch before accumulation,
reset state on session end/privacy/engine changes, and compare whole-query,
incremental and cleared-input behavior through the native UI. The initial color
flash requires its own frame comparison. No first-query special case or synthetic
carried results should substitute for that lifecycle integration.
