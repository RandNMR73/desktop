# Astral: a personal fork of Zen Browser

This fork builds Zen for one Mac (arm64) with a few local patches, publishes
unsigned builds as GitHub Releases, and is installed and kept current by
[Astralforge](https://github.com/RandNMR73/Astralforge)'s
`scripts/zen-fork-update.sh` (see its `docs/zen-fork.md`).

## Branches

| Branch | What it is |
| --- | --- |
| `upstream-sync` | Exact mirror of upstream `zen-browser/desktop` `dev`. Never commit here. |
| `astral` | Integration branch and the fork's default branch: the latest upstream **release tag**, plus the merged `astral/*` feature branches and the fork's own CI. Every build and Release comes from here. |
| `astral-<topic>` | One feature or fix per branch (for example `astral-perf`, `astral-theme`, `astral-arc-parity`), branched from `astral`. It's merged into `astral` once its CI is green. Git can't hold `astral/<topic>` next to a branch named `astral`, hence the dash. |
| `dev` | Upstream's default branch, as it was when the fork was made. Unused. |

### Why release tags and not `dev`

`astral` follows upstream's stable release tags (`1.23.4b`, `1.23.5b`, ...)
rather than `dev`:

- Tags are what Zen actually ships, after its own release checks. `dev` is
  where in-progress work lands and is sometimes broken for days.
- The installed upstream Zen and the fork then share the same Firefox version
  and profile format, so switching between them never triggers a profile
  downgrade or migration.
- Security fixes still arrive promptly. Zen cuts a point release for every
  Firefox security release, usually within a day or two, and the sync below
  picks up a new tag within 24 hours.
- One build per release, rather than one per `dev` commit, keeps the ~3 to
  5 hour builds and the 10 GB Actions cache budget manageable.

The `upstream-sync` mirror is still refreshed daily, so `dev` is easy to diff
against when an upstream fix hasn't been tagged yet.

## Workflows

Only the `astral-*` workflows run in this fork. The upstream workflows need
Zen's secrets and self-hosted runners, so they are disabled in the Actions
settings, and the sync workflow disables any new upstream workflow it sees.

- **`astral-build.yml`**: cross-compiles macOS arm64 on a GitHub-hosted
  `ubuntu-24.04` runner (upstream's method), with sccache in the Actions
  cache, no PGO, and no LTO by default (ThinLTO can be turned on per run, but
  the build may then miss the 6-hour job limit). Publishes Release
  `astral-<upstream version>-<n>` with the `.dmg`, its `.sha256`, and
  `platform.ini`. Zen's Google keys are private, so Safe Browsing works only
  if you add your own key as the `ZEN_SAFEBROWSING_API_KEY` Actions secret
  (optionally `ZEN_GOOGLE_LOCATION_SERVICE_API_KEY` too). Run it by hand from the Actions tab or with
  `gh workflow run astral-build.yml -R RandNMR73/desktop`.
- **`astral-sync.yml`** (every 6 hours, and on demand): mirrors upstream
  `dev` to `upstream-sync`, then merges the newest upstream release tag into
  `astral`. On a merge conflict it opens an issue and a PR instead of pushing
  anything broken. On a clean merge it builds and publishes a Release, so a
  security release reaches the Mac within about a day.

Upstream's own workflow files stay pinned at `astral`'s copies during the
merge: they're disabled here, and GitHub won't let the Actions token push
commits that edit workflow files. When upstream changes them, the sync opens
an issue so `astral-build.yml` can be checked for the same change. For the
same reason the `upstream-sync` mirror can lag when upstream `dev` edits a
workflow; a push from a machine with SSH access catches it up:
`git push origin upstream/dev:upstream-sync`. Nothing in this fork is ever
force-pushed.

- **`astral-check.yml`** (every push to an `astral-<topic>` branch, PRs into
  `astral`, or on demand): downloads Firefox and applies every patch, in about
  15 minutes. A green check is the bar for merging a feature branch.

If a sync merge conflicts, resolve it locally:

```sh
git fetch upstream --tags
git switch astral && git merge <tag>   # fix the conflicts, then commit
# keep astral's copies of upstream's .github/workflows files (git checkout HEAD -- <file>)
git push origin astral
gh workflow run astral-build.yml -R RandNMR73/desktop
```

## Patches

Every change carried on top of upstream, with a one-line rationale. Keep this
list current when merging an `astral/*` branch; each Release's notes include
it.

<!-- patches -->
- `configs/common/mozconfig`: `--disable-updater`, so the fork never
  replaces itself with an upstream build. Updates come from this fork's
  Releases via Astralforge.
- `.github/workflows/astral-*.yml` and `src/astral-*.sh`: the fork's CI
  (patch check, build, Release, upstream sync).
- `ASTRAL.md`: this file.
<!-- /patches -->
