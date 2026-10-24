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
  picks up a new tag within 6 hours.
- One build per release, rather than one per `dev` commit, keeps the builds
  (about 2 hours cold, about 30 minutes with a warm sccache cache) and the
  10 GB Actions cache budget manageable.

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
- `astral-arc-parity`: closing the selected tab shows an empty space, not a
  pin, as Arc does.
- `astral-arc-parity`: unloaded pins and Essentials look like Arc's: their
  favicon comes from local history instead of a blank, and they dim their
  title without greying the icon.
- `astral-arc-parity`: idle unpinned tabs are auto-archived, as in Arc, and
  only once every synced copy of the tab is idle.
- `astral-little-arc`: little windows after Arc's Little Arc: a small
  sidebar-less window (⌘⌥N, and links from other apps) for quick lookups; ⌘O
  moves its page into the main window.
- `astral-site-search-chip`: Tab on a site search's domain turns the URL bar
  into Arc's chip, the site's icon on its colour with white text.
- `astral-tab-cycle`: ⌘⌥↑ / ⌘⌥↓ select the previous / next tab and ⌃⇧1–4
  focus a split view pane, as in Arc.
- `astral-little-arc-archive`: little windows nobody has looked at for 12
  hours are archived, like Arc's Little Arcs.
- `astral-arc-strings`: the URL bar's placeholder is Arc's "Search or Enter
  URL".
- `astral-arc-command-bar`: empty ⌘T / ⌘L lists open tabs by recency (not
  top sites), preselects the first row, and sets the placeholder to
  "Search or Enter URL…".
- `codex/arc-parity-repair`: use Gecko's real query listener and selection APIs;
  clear the command bar's temporary Tabs filter before typing; preserve explicit
  search modes; keep default selection accessible without autofilling a URL;
  localize the actual placeholder and accessible name. A live-tab provider supplies
  four recent tabs with pinned labels and favicons, without waking unloaded tabs;
  default Enter activation switches to the actual tab. The support row opens the
  fork issue tracker; an accessible information footer opens Search Settings.
- `codex/arc-parity-repair`: keyboard-accessible create menu, New Space/New Folder
  labels, shortcut hints and a New Boost command using Zen's existing editor.
- `astral-perf`: mirror the current space onto the background, coalesce compact
  mode observer work to one animation frame, skip unchanged tab moves and
  closed theme-picker work. Regression coverage is `npm run test:astral`.
- `codex/arc-visual-parity`: preserve square favorite artwork; expose the pinned
  initial site for site-specific tray artwork without overriding custom icons;
  use Arc's Unicode placeholder. Suppress loading/CDN status text while retaining
  link destinations, with an opt-in for original behavior; hidden updates return
  before mutating the panel.
- `codex/arc-hover-create-parity`: favorites stop preview events before loading
  the preview module or capturing thumbnails, including legacy profiles. Hide
  redundant tab-title tooltips while preserving audio and close-control help;
  `zen.view.show-tab-tooltip` provides an explicit opt-in.
<!-- /patches -->

## Validation status (2026-10-24)

Arc parity is **incomplete**. The repaired command bar and create-menu paths
were tested in a repacked, ad-hoc-signed macOS app on disposable profiles, with
native computer-use checks as well as the Gecko harness in Astralforge's
`tools/zen-bench/smoke_arc.py`. Twenty deterministic behavior tests and 60 focused Gecko runtime checks pass.
The status path also avoids roughly 4,000 UI mutations per 1,000 hidden loading
updates. Theme gamut, native materials, hover coverage and broader feature
parity remain incomplete; see the linked report.
The new browser mochitest is checked in but has not run against a full build.
See Astralforge's `docs/zen-arc-validation.md` for measurements, feature gaps,
installation variants and reproduction instructions.

GitHub rejected a workflow dispatch with HTTP 422, "Actions has been disabled
for this repository", even though the Actions settings API reports enabled.
Do not describe a local repack as a rebuilt engine or a green CI run, and do
not describe unavailable CI as passed. PRs are ready for review at the user's
request despite the billing/Actions issue. Local installations currently retain
the optimized upstream engine with a matching-release frontend overlay; this is
not a newly built fork engine. PGO/ThinLTO work remains separate and
unverified; these UI fixes do not prove that Astral is faster than Arc overall.
