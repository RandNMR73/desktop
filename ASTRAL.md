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

## Startup selection and command bar

Native Arc relaunches to an empty Space with its command bar focused; Escape
reveals the gradient without loading the previously selected pin. Preserve
`zen.workspaces.continue-where-left-off=false` and
`zen.urlbar.open-on-startup=true` for that behavior. Both are already the fork's
defaults. The managed Astralforge configuration previously disabled the latter
and now also disables the repeated default-browser promotion. This does not
change the system default browser.

Startup focus must be observed before attaching a Marionette session: Gecko's
`WebDriver:NewSession` explicitly focuses the content browser and dismisses the
picker. That harness side effect is not a startup regression. The separate
offline restart check covers saved pins, Space selection and keyboard behavior.
See Astralforge's `tools/zen-bench/results/startup-command-bar-2026-10-29/` for
native observations, integration checks and remaining limits. These startup
checks do not establish overall visual parity or a speed advantage over Arc.

The command bar also starts with an empty query after Escape or closing it
with Cmd+T. Native Arc clears canceled text in all five Spaces; the previous
45-second retention default did not match. `zen.urlbar.wait-to-clear` now
defaults to zero. Astralforge supplies the same value to older installed
builds. This retains the existing controller's close-session ownership and
page restoration, with no changes to its explicit positive-delay option.
See `tools/zen-bench/results/command-query-reset-2026-10-29/` in Astralforge.

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

The 2026-10-25 macOS process-reuse setting retains an unused site process for
five seconds. In a balanced native loopback experiment across five Spaces,
ten quick same-site reopens per setting had median FCP of 781 ms at the Gecko
default (zero grace) and 499.5 ms at five seconds. Eight of ten matched cases
improved. This does not improve previously unused sites or establish an Arc
speed advantage. One native idle process retained about 211 MiB at two seconds
and exited at 5.3 seconds; a simulated memory-pressure signal did not immediately
discard waiting processes. Site/container isolation, active-page survival and
expiry passed the isolated runtime probe. See Astralforge's
`tools/zen-bench/results/process-reuse-2026-10-25/` for the complete measurements
and limitations. Set the preference to `0` to restore immediate idle shutdown.

Arc parity is **incomplete**. The repaired command bar and create-menu paths
were tested in a repacked, ad-hoc-signed macOS app on disposable profiles, with
native computer-use checks as well as the Gecko harness in Astralforge's
`tools/zen-bench/smoke_arc.py`. Thirty-three deterministic behavior tests and 60 focused Gecko runtime checks pass.
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

### Easels development

The `codex/arc-easels` branch adds local persistent Easels, pinned to their
owning space, with seven drawing/import tools, reversible edits, PNG export,
and a Library preview. Documents and image assets stay in the browser profile.
The editor loads only when a board is opened or restored. A keyed renderer
retains unchanged objects and decoded images; pointer motion is coalesced into
one animation callback and commits one undo checkpoint on release.
Text formatting retains the active editable DOM, selection and caret. Text
boxes fit their content in both directions; input coalesces the active box's
layout into one animation callback without saving or reconciling the canvas
on each keystroke. Finishing an edit cancels pending layout and saves its text
and fitted geometry. Escape ends editing and clears selection while leaving
a Library preview open.

Text controls now step through Arc's body, heading and large-heading presets,
refitting width on size changes while retaining geometry on font-family changes.
The presets use native line heights, a ten-unit horizontal inset and macOS's
860 heavy weight. Canonical text metrics scale with the canvas; old custom
formatting remains intact until a preset control is used. On this Mac, the
non-system faces load from the installed Arc app (EB Garamond, Söhne Breit and
Space Mono); font binaries are not redistributed, and missing installations
use fallback fonts. Controls wait for font metrics before accepting changes,
then commit synchronously. Export waits for font loading as well.

This is an incomplete Arc feature implementation. Native comparison and the
Astralforge `smoke_easels.py` harness cover editing, previews, multiple spaces,
and persistence. Named Vibrant/Chill palettes retain Arc's source color spaces,
recolor existing objects, and participate in undo and concurrent merging.
Library cards use native artwork and a native selection-animation sprite.
Residual subpixel glyph differences, full font-weight/pixel verification,
inline formatting behavior, alignment guides,
sidebar/share behavior, exact Library
interactions, live captures, shared links/collaboration, and material/color
matching still need work. Local PNG export is not Arc's sharing service.
See `docs/zen-easels-validation.md` in Astralforge for current evidence and gaps.

### Link context opening group (October 26, 2026)

The opening group follows Arc's New Tab, New Window, Split View, Little Arc,
and Incognito order. Little/Split remain visible but disabled for unsupported
schemes; private windows disable Little and Incognito. New Window from a
private page stays private. Little and Split preserve Gecko's principal,
container and referrer metadata. Little startup observers survive the initial
blank document unloading and release on display or early window close.

`npm run test:astral` includes eligibility, metadata, current-context, node
reuse and window-lifetime regressions. The companion Astralforge local-page
suite drives actual context menus and windows across five Spaces. Native
opening and Cmd+O promotion were checked in all five Spaces. The Little window
toolbar and remaining context-menu commands still differ from Arc; this does
not establish complete parity or a performance advantage.


### Little search entry and address editor

Empty Little windows open as a 490×329 search panel, with their minimum size
set before native layout. Four cached destinations plus support, destination
subtitles, Escape/Close handling and navigation-triggered expansion replace
the blank full-size entry window. Private/container queries do not read global
Top Sites. Loaded Little pages use a centered 500px address editor whose Close
control retains the page. The matching Astralforge configuration and overlay
are required for the measured dimensions.

Validated with 310 source tests, 46 headless and 46 native-window search checks
across five Spaces, plus 83 existing toolbar integration checks. Selected native
Arc/Zen interactions were compared directly. Full visual parity, a clean Gecko
build and an overall performance advantage remain unverified.

### Little first layout and hostless addresses (2026-10-29)

Little search windows now load their role stylesheet during the first XUL layout, set their own initial dimensions, and do not persist temporary panel geometry over the main window. The toolbar retains the exposable address of hostless URIs when `displayHost` throws, including an explicit navigation to `about:blank`.

Validation: 310 Node tests; 47 native integration checks across all five Spaces with a saved 1670×933 main-window size, repeated with 72 local fixture pins and the configured folder structure. Paint observation is registered at window creation. The installed previous build showed a full-size background before settling, so the native integration measurements alone do not establish that production startup flash is resolved. No overall Arc speed advantage or full visual parity is claimed.

Production follow-up: both signed apps were installed and checked from all five Spaces. An isolated native keyboard-opening trace identified a capture limitation: an initial CUA image showed another existing 500×495 window that never activated, while the actual Little child stayed 490×329 at load, activation and every sampled paint. The regular app's internal-page label, expansion and editor Close behavior were verified. The post-install audit preserves all 228 nonempty tabs and all Space models. See Astralforge's `tools/zen-bench/results/little-first-layout-2026-10-29/` evidence; continuous native video verification remains outside these checks.

### Current-address preview (2026-10-29)

Cmd+L preserves and selects the full current address, preselects the current
page, then shows three cached destinations and Contact the Team. This is a
navigation preview; Cmd+T keeps its recent-tab picker. Typing leaves the preview
and returns to normal providers. The current-page icon and destination labels
are styled by Astralforge's matching CSS. Private/container contexts keep the
current page without reading the shared Top Sites cache.

Changing preview kinds refreshes cached startup results. Editor attributes use
explicit booleans so an undefined main-window flag cannot toggle Little mode.
The visible browser caught both issues during validation. See Astralforge's
`tools/zen-bench/results/current-address-preview-2026-10-29/` for the bounded
checks and limitations; complete visual and performance parity remain open.

Repeated Cmd+L now closes the address view, including after typing. Cmd+L from
an open Cmd+T picker switches to the current address in the existing popover,
restores the selected tab highlight and makes subsequent navigation use that
tab. Like the native Arc reference, this conversion omits the HTTPS prefix;
a fresh Cmd+L shows the full address. Internal new-tab focus commands pass
through unchanged. Superseded close callbacks cannot clear a newer handler.

See Astralforge's `tools/zen-bench/results/location-shortcut-transitions-2026-10-29/`
for targeted validation. Complete visual, first-frame and speed parity remain
unverified.
