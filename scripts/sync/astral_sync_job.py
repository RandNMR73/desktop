#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Local, scheduled upstream sync for the astral fork (see SYNCING.md).

  astral_sync_job.py check      launchd entry point: sync if something is due
  astral_sync_job.py run        sync now (still refuses while the user is active)
  astral_sync_job.py status     what is due, state, last result

What it does when a sync is due:
  0. check that astral reproduces the release engine tree byte for byte;
     stop (and notify) if that tree holds changes never exported into src/
  1. fetch zen-browser/desktop@dev; merge it into sync/zen-<date> (a new
     worktree cut from astral; merge, never rebase)
  2. check every engine patch against the new pristine Firefox
  3. build in a NEW engine tree inside that worktree
  4. run the full regression gate (zen-bench sync-gate) against the installed
     pre-sync build as the baseline
  5. push the branch and open a draft PR with the gate report
  6. notify (macOS notification + log)
It never merges a PR and never installs anything. The existing
com.astralforge.zen-fork-update agent offers the install after a Release.

A sync is due when, and only when:
  - zen/dev moved to a Firefox version astral doesn't have yet (security: this
    is how MFSA fixes arrive; checked every run), or
  - zen/dev has new commits and the last sync attempt is a week old.
When Mozilla has shipped a newer Firefox that zen/dev does not have yet, it
notifies once ("waiting for upstream") and checks again on the next run.

Guards: never while the user is active (HID idle < 600 s, re-checked before
the UI gate); one run at a time (lock); at most one open sync PR; enough free
disk for a fresh engine tree; the build runs at low priority.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HOME = Path.home()
CONF = {
    # The fork checkout the worktrees are cut from. Only `fetch` and
    # `worktree add` touch it: its own checkout and branch are left alone.
    "repo": str(HOME / "Temp/zen-astral-release"),
    "sync_root": str(HOME / "Temp/astral-sync"),
    "zen_bench": str(HOME / "Temp/af-bench/tools/zen-bench"),
    "baseline_app": "/Applications/Zen.app",
    "upstream": "https://github.com/zen-browser/desktop.git",
    "github_repo": "RandNMR73/desktop",
    "base_branch": "astral",
    "min_idle_s": 600,
    "min_free_gb": 45,
    "weekly_days": 7,
    "idle_wait_hours": 24,  # how long a finished build waits for an idle user
    "trials": 30,
    "keep_engine": False,   # delete the engine tree once the gate has run
    # The engine tree releases are built from. Before every sync the fork must
    # reproduce it byte for byte (check_engine_tree.py), or edits made only in
    # that tree would be lost on the new Firefox. null skips the check.
    "release_engine": str(HOME / "Temp/zen-overscroll-engine.noindex"),
}
STATE_DIR = HOME / "Library/Application Support/astral-sync"
STATE = STATE_DIR / "state.json"
LOCK = STATE_DIR / "lock"
LOG_DIR = HOME / "Library/Logs/astral-sync"


def log(msg: str):
    line = f"{dt.datetime.now().isoformat(timespec='seconds')} {msg}"
    print(line, flush=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    with open(LOG_DIR / "sync.log", "a") as f:
        f.write(line + "\n")


def notify(title: str, text: str):
    log(f"NOTIFY {title}: {text}")
    script = f'display notification {json.dumps(text)} with title {json.dumps(title)}'
    subprocess.run(["osascript", "-e", script], check=False)


def sh(*cmd, cwd=None, check=True, quiet=False, env=None, log_to: Path | None = None):
    if not quiet:
        log("$ " + " ".join(map(str, cmd)))
    if log_to:
        with open(log_to, "ab") as f:
            r = subprocess.run(list(map(str, cmd)), cwd=cwd, stdout=f, stderr=subprocess.STDOUT,
                               env=env)
    else:
        r = subprocess.run(list(map(str, cmd)), cwd=cwd, capture_output=True, text=True, env=env)
    if check and r.returncode:
        raise RuntimeError(f"{cmd[0]} failed ({r.returncode}): {(r.stderr or '')[-800:] if not log_to else log_to}")
    return r


def load_conf() -> dict:
    conf = dict(CONF)
    user = STATE_DIR / "config.json"
    if user.exists():
        conf.update(json.loads(user.read_text()))
    return conf


def load_state() -> dict:
    return json.loads(STATE.read_text()) if STATE.exists() else {}


def save_state(state: dict):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, indent=1))


def hid_idle_seconds() -> float:
    out = subprocess.run(["ioreg", "-c", "IOHIDSystem"], capture_output=True, text=True).stdout
    m = re.search(r'"HIDIdleTime"\s*=\s*(\d+)', out)
    return int(m.group(1)) / 1e9 if m else 0.0


def free_gb(path: str) -> float:
    p = Path(path)
    while not p.exists():
        p = p.parent
    return shutil.disk_usage(p).free / 1e9


def mozilla_latest() -> str | None:
    try:
        with urllib.request.urlopen("https://product-details.mozilla.org/1.0/firefox_versions.json",
                                    timeout=30) as r:
            return json.load(r).get("LATEST_FIREFOX_VERSION")
    except Exception as e:  # noqa: BLE001 - offline: the zen/dev check still works
        log(f"product-details unavailable: {e}")
        return None


def ff_version(repo: str, ref: str) -> str:
    return json.loads(sh("git", "show", f"{ref}:surfer.json", cwd=repo, quiet=True).stdout)["version"]["version"]


def vkey(v: str):
    return tuple(int(x) for x in re.findall(r"\d+", v or "0"))


def open_sync_pr(conf) -> str | None:
    r = sh("gh", "pr", "list", "--repo", conf["github_repo"], "--base", conf["base_branch"], "--state", "open",
           "--json", "url,headRefName", check=False, quiet=True)
    try:
        prs = json.loads(r.stdout or "[]")
    except json.JSONDecodeError:
        return None
    for pr in prs:
        if pr["headRefName"].startswith("sync/zen-"):
            return pr["url"]
    return None


def what_is_due(conf, state, fetch=True) -> dict:
    repo = conf["repo"]
    if fetch:
        sh("git", "fetch", "--no-tags", conf["upstream"], "+dev:refs/remotes/zen/dev", cwd=repo)
        sh("git", "fetch", "--no-tags", "origin", conf["base_branch"], cwd=repo)
    base = f"origin/{conf['base_branch']}"
    ours, theirs = ff_version(repo, base), ff_version(repo, "zen/dev")
    upstream_sha = sh("git", "rev-parse", "zen/dev", cwd=repo, quiet=True).stdout.strip()
    new_commits = sh("git", "merge-base", "--is-ancestor", "zen/dev", base, cwd=repo, check=False,
                     quiet=True).returncode != 0
    return decide(ours, theirs, mozilla_latest(), new_commits, upstream_sha, state, conf["weekly_days"])


def decide(ours, theirs, latest, new_commits, upstream_sha, state, weekly_days, now=None) -> dict:
    """Is a sync due? Pure, so the policy is unit-tested."""
    now = now or dt.datetime.now()
    last = state.get("last_attempt_at")
    week = not last or now - dt.datetime.fromisoformat(last) >= dt.timedelta(days=weekly_days)
    due = {"astral_ff": ours, "zen_dev_ff": theirs, "mozilla_latest": latest, "zen_dev": upstream_sha,
           "new_commits": new_commits, "reason": None}
    if new_commits and vkey(theirs) > vkey(ours):
        due["reason"] = f"security: zen/dev moved to Firefox {theirs} (astral is on {ours})"
    elif new_commits and week:
        due["reason"] = "weekly"
    if state.get("last_attempt_sha") == upstream_sha:
        due["reason"] = None  # already tried this exact upstream; wait for it to move
    due["waiting_for_upstream"] = bool(latest and vkey(latest) > vkey(theirs) and vkey(latest) > vkey(ours))
    return due


# ---------------------------------------------------------------- one sync

def sync(conf, state, due) -> int:
    repo, root = conf["repo"], Path(conf["sync_root"])
    date = dt.date.today().isoformat()
    branch = f"sync/zen-{date}"
    wt = root / f"sync-{date}"
    results = root / f"results-{date}"
    build_log = results / "build.log"
    results.mkdir(parents=True, exist_ok=True)
    blocked = state.get("engine_tree_blocked_at")
    if blocked and dt.datetime.now() - dt.datetime.fromisoformat(blocked) < dt.timedelta(hours=24):
        log("release engine tree still has unexported changes (checked in the last 24 h); not syncing")
        return 3
    state.update(last_attempt_at=dt.datetime.now().isoformat(timespec="seconds"),
                 last_attempt_sha=due["zen_dev"], last_result="running", last_branch=branch)
    save_state(state)

    # 1. merge
    if wt.exists():
        raise RuntimeError(f"{wt} already exists; remove it or wait until tomorrow")
    sh("git", "worktree", "add", "-b", branch, wt, f"origin/{conf['base_branch']}", cwd=repo)
    sh("git", "config", "user.name", "astral-sync", cwd=wt)

    # 0. the release engine tree must hold nothing the fork lacks
    tree = engine_tree_check(conf, wt, results)
    if tree is not None and not tree.get("ok"):
        state["last_result"] = "release engine tree has unexported changes"
        state["engine_tree_blocked_at"] = dt.datetime.now().isoformat(timespec="seconds")
        state.pop("last_attempt_sha", None)  # retry this upstream once exported
        save_state(state)
        sh("git", "worktree", "remove", "--force", wt, cwd=repo, check=False)
        sh("git", "branch", "-D", branch, cwd=repo, check=False)
        n = len(tree.get("differs", [])) + len(tree.get("unexplained_untracked", []))
        notify("Astral sync: export the engine tree first",
               f"{n} files in {conf['release_engine']} differ from what astral builds. "
               f"See {results / 'engine-tree.txt'}; export with check_engine_tree.py --export-into-src.")
        return 3

    state.pop("engine_tree_blocked_at", None)
    merge = sh("git", "merge", "--no-ff", "--no-edit", "-m",
               f"Merge zen-browser/desktop dev ({due['zen_dev'][:9]}) into astral: Firefox {due['zen_dev_ff']}",
               "zen/dev", cwd=wt, check=False)
    if merge.returncode:
        conflicts = sh("git", "diff", "--name-only", "--diff-filter=U", cwd=wt, quiet=True).stdout.split()
        sh("git", "merge", "--abort", cwd=wt, check=False)
        body = (f"Scheduled sync ({due['reason']}) could not merge zen/dev `{due['zen_dev'][:9]}` "
                f"(Firefox {due['zen_dev_ff']}) into astral: {len(conflicts)} conflicting files.\n\n"
                "Resolve locally following SYNCING.md.\n\n```\n" + "\n".join(conflicts) + "\n```\n")
        url = gh_issue(conf, f"Upstream sync needs conflict resolution ({date})", body)
        state["last_result"] = f"conflicts ({len(conflicts)})"
        save_state(state)
        sh("git", "worktree", "remove", "--force", wt, cwd=repo, check=False)
        sh("git", "branch", "-D", branch, cwd=repo, check=False)
        notify("Astral sync: conflicts", f"{len(conflicts)} files need resolving. {url or ''}")
        return 2

    # 2. engine patches against pristine Firefox
    # The job's own copy of the checker, so worktrees cut before it existed work too.
    checker = Path(__file__).resolve().parent / "check_engine_patches.py"
    patches = sh(sys.executable, checker, "--repo", wt, "--json", results / "patches.json",
                 cwd=wt, check=False)
    (results / "patches.txt").write_text(patches.stdout + patches.stderr)
    patches_ok = patches.returncode == 0

    # 3. build in a new engine tree (the worktree's own engine/)
    built_app = None
    if patches_ok:
        env = dict(os.environ, MOZ_PARALLEL_BUILD=str(max(2, (os.cpu_count() or 4) - 2)))
        try:
            for step in (["npm", "ci"], ["npm", "run", "init"], ["npm", "run", "build"]):
                sh("nice", "-n", "15", *step, cwd=wt, env=env, log_to=build_log)
            apps = sorted(wt.glob("engine/obj-*/dist/*.app"))
            built_app = apps[0] if apps else None
        except RuntimeError as e:
            log(f"build failed: {e}")
    # 4. gate (only with a built app); waits for the user to be idle
    gate_code = None
    if built_app:
        deadline = time.time() + conf["idle_wait_hours"] * 3600
        while hid_idle_seconds() < conf["min_idle_s"] and time.time() < deadline:
            time.sleep(120)
        gate = sh(sys.executable, "-m", "zen_bench", "sync-gate", "--candidate", built_app,
                  "--baseline-app", conf["baseline_app"], "--repo", wt, "--out", results / "gate",
                  "--trials", conf["trials"], "--min-idle", conf["min_idle_s"],
                  cwd=conf["zen_bench"], check=False, log_to=results / "gate.log")
        gate_code = gate.returncode
        # Keep the built app for the user to try; drop the 30+ GB engine tree.
        keep = results / built_app.name
        if not keep.exists():
            sh("ditto", built_app, keep)
    if not conf["keep_engine"] and (wt / "engine").exists():
        shutil.rmtree(wt / "engine", ignore_errors=True)

    # 5. PR
    report = (results / "gate/report.md").read_text() if (results / "gate/report.md").exists() else \
        ("Gate not run: " + ("build failed, see build.log." if patches_ok else "engine patches need rework.")
         + ("\n\nThe user was not idle within the wait window." if gate_code == 75 else ""))
    verdict = {0: "PASS", 1: "FAIL", 75: "NOT RUN (user active)"}.get(gate_code, "NOT RUN")
    body = "\n".join([
        f"Scheduled upstream sync ({due['reason']}). Firefox {due['astral_ff']} -> {due['zen_dev_ff']}; "
        f"zen/dev `{due['zen_dev'][:9]}`" + (f"; Mozilla latest {due['mozilla_latest']}" if due["mozilla_latest"] else "") + ".",
        "", f"**Gate: {verdict}**. Built app and logs: `{results}`.", "",
        "### Release engine tree (astral reproduces it before the merge)", "```",
        ((results / "engine-tree.txt").read_text()[-3000:] if (results / "engine-tree.txt").exists() else "not checked"), "```",
        "### Engine patches (strict apply on pristine Firefox)", "```", (results / "patches.txt").read_text()[-4000:], "```",
        "", report, "",
        "Merge only after review (SYNCING.md). This job never merges or installs.", "",
        "🤖 Generated with [Claude Code](https://claude.com/claude-code)"])
    sh("git", "push", "-u", "origin", branch, cwd=wt)
    pr = sh("gh", "pr", "create", "--repo", conf["github_repo"], "--base", conf["base_branch"], "--head", branch,
            "--draft", "--title", f"Sync upstream Zen: Firefox {due['zen_dev_ff']} ({date})", "--body", body,
            cwd=wt, check=False)
    url = (pr.stdout or "").strip().splitlines()[-1] if pr.returncode == 0 else None
    state.update(last_result=verdict, last_pr=url)
    save_state(state)
    notify(f"Astral sync: gate {verdict}", f"Firefox {due['zen_dev_ff']} sync PR {url or '(PR failed, see log)'}")
    return 0 if gate_code == 0 else 1


def engine_tree_check(conf, fork: Path, results: Path) -> dict | None:
    """check_engine_tree.py of the fork at astral against the release tree."""
    engine = conf.get("release_engine")
    if not engine or not (Path(engine) / ".git").exists():
        log(f"release engine tree check skipped: {engine!r} is not an engine tree")
        return None
    checker = Path(__file__).resolve().parent / "check_engine_tree.py"
    r = sh(sys.executable, checker, "--engine", engine, "--repo", fork,
           "--json", results / "engine-tree.json", check=False)
    (results / "engine-tree.txt").write_text(r.stdout + r.stderr)
    try:
        return json.loads((results / "engine-tree.json").read_text())
    except (OSError, json.JSONDecodeError):
        return {"ok": False, "error": (r.stderr or r.stdout)[-800:]}


def gh_issue(conf, title, body):
    r = sh("gh", "issue", "create", "--repo", conf["github_repo"], "--title", title, "--body", body, check=False)
    return (r.stdout or "").strip() or None


# ---------------------------------------------------------------- entry

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["check", "run", "status"])
    a = ap.parse_args(argv)
    conf, state = load_conf(), load_state()

    if a.cmd == "status":
        due = what_is_due(conf, state, fetch=False)
        print(json.dumps({"due": due, "state": state, "idle_s": round(hid_idle_seconds()),
                          "free_gb": round(free_gb(conf["sync_root"]), 1)}, indent=1))
        return 0

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        LOCK.mkdir()
    except FileExistsError:
        pid_file = LOCK / "pid"
        pid = int(pid_file.read_text()) if pid_file.exists() else None
        alive = False
        if pid:
            try:
                os.kill(pid, 0)
                alive = True
            except OSError:
                pass
        if alive:
            log(f"another sync run (pid {pid}) holds the lock; exiting")
            return 0
        log("removing a stale lock from a run that is no longer alive")
        shutil.rmtree(LOCK, ignore_errors=True)
        LOCK.mkdir()
    (LOCK / "pid").write_text(str(os.getpid()))
    try:
        idle = hid_idle_seconds()
        if idle < conf["min_idle_s"]:
            log(f"user active (idle {idle:.0f} s); not starting")
            return 0
        due = what_is_due(conf, state)
        if due["waiting_for_upstream"] and state.get("notified_waiting") != due["mozilla_latest"]:
            notify("Astral sync", f"Mozilla shipped Firefox {due['mozilla_latest']}; waiting for upstream Zen "
                                  f"(zen/dev is on {due['zen_dev_ff']}).")
            state["notified_waiting"] = due["mozilla_latest"]
            save_state(state)
        if a.cmd == "check" and not due["reason"]:
            log(f"nothing due (astral {due['astral_ff']}, zen/dev {due['zen_dev_ff']}, "
                f"mozilla {due['mozilla_latest']}, new commits {due['new_commits']})")
            return 0
        if a.cmd == "run" and not due["reason"]:
            due["reason"] = "manual"
        pr = open_sync_pr(conf)
        if pr:
            log(f"a sync PR is already open ({pr}); not starting another")
            return 0
        if free_gb(conf["sync_root"]) < conf["min_free_gb"]:
            if state.get("notified_disk") != due["zen_dev"]:
                notify("Astral sync blocked", f"{due['reason']}: needs {conf['min_free_gb']} GB free, "
                                              f"have {free_gb(conf['sync_root']):.0f} GB.")
                state["notified_disk"] = due["zen_dev"]
                save_state(state)
            return 0
        log(f"sync due: {due['reason']}")
        try:
            return sync(conf, state, due)
        except Exception as e:  # noqa: BLE001 - always report
            state["last_result"] = f"error: {e}"
            save_state(state)
            notify("Astral sync failed", str(e)[:200])
            return 1
    finally:
        shutil.rmtree(LOCK, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
