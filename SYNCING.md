# Syncing `astral` with upstream Zen

`astral` is a fork of [zen-browser/desktop](https://github.com/zen-browser/desktop)
(`dev`). Firefox security fixes reach the fork mainly through upstream's Firefox
version bumps. Every week the fork goes without a sync, it misses those fixes.

## When

- **Weekly.** Every Monday, whenever `zen/dev` has moved.
- **Right after every Mozilla security release (MFSA).** As soon as upstream Zen
  moves to the Firefox version Mozilla just shipped. Advisories:
  <https://www.mozilla.org/security/advisories/>.

`.github/workflows/astral-upstream-sync.yml` checks both triggers. It opens a draft
PR when the merge is clean and an `upstream-sync` issue when it is not. It never
merges anything.

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
3. **Engine patches** (`src/**/*.patch`). Check them against pristine Firefox:
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
5. **Gates.** All must pass before the PR can merge:
   - `node --test scripts/tests/*.test.mjs`
   - `cd ~/Temp/af-bench/tools/zen-bench && ./zen-bench parity`: **211 pass / 0 fail**,
     with no tests changed to make it pass
   - the speed suite (`./zen-bench`). Report every regression in the PR.

   Profile safety: the real `user.js` is a symlink into the Astralforge runtime.
   Harnesses must run on profile copies and unlink before they append. Never
   write through it.
6. **PR against `astral`.** List the conflicts and how each was resolved, the
   upstream fixes that were dropped, the reworked patches, and the gate results.
   It merges only with the owner's approval.
