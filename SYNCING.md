# Syncing `astral` with upstream Zen

`astral` is a fork of [zen-browser/desktop](https://github.com/zen-browser/desktop)
(`dev`). Firefox security fixes reach the fork mainly through upstream's Firefox
version bumps. Every week the fork goes without a sync, it misses those fixes.

## When

- **Weekly**, whenever `zen/dev` has new commits.
- **Right after every Mozilla security release (MFSA)**, as soon as upstream Zen
  moves to a Firefox version `astral` doesn't have yet. Advisories:
  <https://www.mozilla.org/security/advisories/>.

## Automation (local LaunchAgent)

The sync runs on this Mac, because only this Mac can build the browser and run the
visual and functional gates. It is driven by `scripts/sync/astral_sync_job.py`,
installed as the per-user LaunchAgent `com.astral.zen-upstream-sync`:

```sh
scripts/sync/install-sync-agent.sh              # install + load
scripts/sync/install-sync-agent.sh --uninstall  # remove
python3 ~/Library/Application\ Support/astral-sync/bin/astral_sync_job.py status
```

**When it runs.** Every 30 minutes the agent checks whether a sync is due. It
starts one only if all of these hold:

- The user has been idle for at least 600 s (`ioreg` `HIDIdleTime`). It checks
  again before the UI gate and waits up to 24 h for an idle window.
- A sync is due:
  - `zen/dev` moved to a newer Firefox than `astral` has. This is the security
    path, and it applies on every check.
  - Or `zen/dev` has new commits and the last attempt was at least a week ago.
- That exact upstream commit hasn't been tried before.
- No `sync/zen-*` PR is already open.
- At least 45 GB of disk is free.

If Mozilla ships a Firefox that `zen/dev` doesn't have yet, the agent sends one
"waiting for upstream" notification.

**What a run does.**

0. Checks that `astral` reproduces the release engine tree byte for byte (see
   "The release engine tree" below). If that tree holds changes that were never
   exported into `src/`, it stops before merging and sends a notification. It
   then waits a day before trying again.
1. Merges `zen/dev` into a new `sync/zen-<date>` worktree under `~/Temp/astral-sync`.
   On conflicts, it aborts the merge, opens an issue listing them, and sends a
   notification.
2. Checks every engine patch against the new pristine Firefox.
3. Builds the browser in that worktree's own, new engine tree, at low priority.
4. Runs `zen-bench sync-gate` against the installed build, which is the pre-sync
   baseline.
5. Pushes the branch and opens a draft PR with the gate report.
6. Sends a macOS notification.

The built `Zen.app` and all logs are kept in `~/Temp/astral-sync/results-<date>`.
The engine tree is deleted afterwards.

**What it never does.** It never merges a PR and never installs anything. The
existing `com.astralforge.zen-fork-update` agent offers the install after a
Release. Configuration can be overridden in
`~/Library/Application Support/astral-sync/config.json` (see `CONF` in the job).
Logs are in `~/Library/Logs/astral-sync/`.

## The release engine tree

Releases are built from an engine tree (today `~/Temp/zen-overscroll-engine.noindex`,
`release_engine` in the job's `CONF`), not from a fresh import. Any edit made
only in that tree is lost on the next `surfer import`, which every Firefox sync
does. Before a sync, the fork must reproduce the tree exactly:

```sh
python3 scripts/sync/check_engine_tree.py --engine ~/Temp/zen-overscroll-engine.noindex --repo <astral checkout>
```

The check runs offline in about 30 s and only reads the tree. It replays what
`npm run import` and `surfer build` do, on the tree's own pristine Firefox
commit (its git `HEAD`):

- **Patches.** Every `src/**/*.patch` is applied the way surfer applies it:
  - a depth-first walk in readdir order;
  - `git apply --ignore-space-change --ignore-whitespace`.

  This includes the downloaded Phabricator patches under
  `src/external-patches`. `manifest.json` only drives
  `scripts/update_external_patches.py`, and surfer applies whatever patch
  files are there.
- **Edits surfer makes outside patches:**
  - the `#include zen.js` line in `firefox.js`;
  - the update URL in `application.ini.in`;
  - the display version.
- **Comparison.** The result is compared byte for byte with the tree:
  - Every other `src/` file must be a symlink with the same content.
  - `locales/en-US` must match `browser/locales/en-US`.
  - Generated prefs, dumps and branding are listed, not compared.

The check reports two kinds of difference:

- **Differs / unexplained untracked: the tree holds unexported work.** This
  fails the check. Export it:
  ```sh
  python3 scripts/sync/check_engine_tree.py --engine <tree> --repo <fork> --export-into-src
  ```
  This writes or regenerates each file's own fork patch (`src/<dir>/<name>-<ext>.patch`),
  relative to the patches surfer applies before and after it. That way an
  external patch touching the same file, such as the backdrop-filter patch
  (D327914), keeps applying unchanged. A plain `git diff HEAD` per file would
  apply those hunks twice. Review the result and commit it.
- **Stale: the tree is behind the fork.** An older version of the file's own
  patch reproduces it, so the tree hasn't been re-imported since that commit.
  There's nothing to export, and `--export-into-src` leaves these files alone
  because exporting them would revert the fork. Builds from that tree lack the
  newer fork change, so re-import before the next release.

## The regression gate (one command)

```sh
cd ~/Temp/af-bench/tools/zen-bench
./zen-bench sync-gate --candidate <built Zen.app> --baseline-app /Applications/Zen.app \
    --repo <sync worktree> --out results/sync-<date> \
    --engine-tree ~/Temp/zen-overscroll-engine.noindex --engine-fork <astral checkout>
```

The baseline and the candidate each run on their own golden-profile copy and
their own Marionette port, never the user's Zen and never port 2873. The gate runs:

| step | what |
|---|---|
| engine tree | `check_engine_tree.py`: the pre-sync fork reproduces the release engine tree (with `--engine-tree`) |
| node tests | `node --test scripts/tests/*.test.mjs` in the fork |
| zen-bench unit tests | `python3 -m unittest` in `tools/zen-bench` |
| visual parity | `zen-bench parity`: 211 / 0 today |
| native paint | `zen-bench parity-native` |
| functional | `zen-bench functional`: tabs, page load, history, Spaces (switch, scope, create/delete), Essentials, folders, split view, Peek, compact mode and hover reveal, the Cmd+T command bar, find bar, downloads, Library, extensions, and state that persists across a real restart |
| speed | the suite, edge-latency and key-latency, judged together (`gate --merge`) |

**What fails the gate.**

- Any test failure, including the engine-tree check.
- Any FAIL row in parity, native paint or functional.
- Any row that passed in the baseline and now skips or is missing.
- An extension that was active in the baseline and isn't now.
- A speed budget that passed in the baseline and fails now.
- Any action whose median is more than 10 % and more than 2 ms slower than the
  baseline (Mann-Whitney p < 0.01).

Budget rows that already failed in the baseline are listed but don't block.

The gate refuses to start (exit 75) while the user is active, unless you pass
`--force`.

## How

1. **Branch and merge.** Always merge, never rebase, so the next sync only deals
   with what's new:
   ```sh
   git fetch zen dev
   git worktree add ~/Temp/zen-sync-$(date +%Y%m%d) -b sync/zen-$(date +%Y-%m-%d) astral
   cd ~/Temp/zen-sync-$(date +%Y%m%d) && git merge --no-ff zen/dev
   ```
2. **Resolve conflicts in favour of the fork's look and behaviour.** Take
   upstream's `surfer.json` version bump and its bug and security fixes. Read the
   commit behind each hunk (`git log $(git merge-base HEAD zen/dev)..zen/dev -- <file>`) to tell a fix
   from a feature or restyle.
   - CSS: upstream swaps literals for `var(--zen-*)` tokens. Where the fork
     changed a value, keep the fork's literal.
   - Watch for upstream features that **overlap fork features**, not just
     conflicting lines. Auto-merged code can quietly change behaviour. Examples
     from the 2026-11 sync:
     - Upstream "Little Zen" shares the `[zen-little-window]` attribute and the
       `zen-little-window.css` chrome path with the fork's Little window.
     - Upstream's settings window replaces the fork's about:preferences panes.
     - Upstream's `about:keyboard` migration deletes the fork's shortcut file.
     - Space routing defaults to Little Zen upstream.
     Search the merged tree for each new upstream feature's attributes, prefs and
     module paths.
3. **Engine patches** (`src/**/*.patch`). First make sure nothing lives only in
   the release engine tree (see "The release engine tree" above). Then check
   every patch against pristine Firefox:
   ```sh
   python3 scripts/sync/check_engine_patches.py   # version from surfer.json
   ```
   Any patch listed as `FAIL` needs rework. Rebase it with a three-way merge on
   real sources:
   - O: the fork's patch applied to the old Firefox
   - B: the base patch applied to the old Firefox
   - T: upstream's patch applied to the new Firefox

   Then regenerate the patch as `diff(new Firefox -> merge)`. Also grep the
   rebased files for identifiers that the new Firefox renamed. In 160, for
   example, `this.window` became `this.browserWindow` in UrlbarInput, and
   `HasAuthorSpecified*` became `HasAuthorOrUserSpecified*`. A clean patch
   application doesn't catch those; only a build does. List every patch you
   reworked or dropped in the PR. Never drop one silently.
4. **Build in a fresh engine tree.** Never reuse an engine tree another session
   is building in. You need about 40 GB free. Don't install over the running Zen
   without asking.
5. **Gates.** Run `zen-bench sync-gate` (see "The regression gate" above). It must
   pass before the PR can merge. Don't change any test to make it pass. Report
   every speed regression in the PR.

   Profile safety: the real `user.js` is a symlink into the Astralforge runtime.
   Harnesses must run on profile copies and unlink before they append. Never
   write through it.
6. **PR against `astral`.** List the conflicts and how each was resolved, the
   upstream fixes that were dropped, the reworked patches, and the gate results.
   It merges only with the owner's approval.
