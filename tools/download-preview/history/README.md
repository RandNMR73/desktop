# Completed download persistence

`persist_completed_downloads.patch` keeps successful public downloads in the
existing Gecko download store. Places history cannot represent blob URLs or
separate downloads of the same source. The patch serializes completion dates
and redirect origins, preserves restored dates in DownloadsCommon, and avoids
announcing restored records as new downloads. Active, partial, blocked and
private downloads retain their existing paths through the download service.

The public preference `zen.library.downloads.persist-completed` defaults to
true in the integration patch. Turning it off restores the upstream completed
record persistence policy. It does not affect the existing partial/blocked
download policy.

The Library hover preview still distinguishes current arrivals from restored
history. Old downloaded files enter that preview through its folder sources;
populating the full Downloads Library does not resolve a failing folder query.

## Reproduce the browser tests

Build or package the source patch, then run against that application:

```sh
python3 tools/download-preview/history/run-persistence.py \
  --app /path/to/candidate/Zen.app \
  --config /path/to/Astralforge \
  --output /path/to/results/persistence.json
```

The runner creates a disposable profile and a local HTTP server, restores two
same-address records and two blob records, downloads one public and one private
fixture, removes a record, restarts the browser, clears Downloads, and restarts
again. It checks original/completion dates, redirect source retention, duplicate
identity, no restored preview arrivals, file preservation and absence of
private data in the store. Server counters prove that restored sources were
never requested and each new fixture was fetched once. No production profile
is instrumented or mutated by this runner.

The one-time Arc importer lives in Astralforge's
`scripts/zen_download_history.py`. It reads Arc's SQLite history without writing
to it, admits only completed safe records whose regular files exist, merges
without changing existing records, and records imported identities so rerunning
it cannot resurrect removed entries. Applying requires a stopped Zen and an
application containing this persistence update. Backups and an import receipt
stay in the local profile; personal history is not committed to either repo.

## Remaining parity work

This changes persistence, not the Downloads row layout or file-scan permissions.
The installed Media scan and hover folder scan still require investigation.
Native physical hover timing, complete Library visuals, all feature parity and
browser-wide speed superiority remain unverified. Per-URL Places deletion for
redirected downloads also needs a separate browsing-history-preservation audit;
the restart suite does not claim that broader case.
