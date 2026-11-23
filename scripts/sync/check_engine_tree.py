#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Check that the fork reproduces an engine tree byte for byte.

Releases are built from an engine tree. Any edit made there and never exported
into src/ is lost on the next `surfer import` (or the next Firefox sync). This
replays what `surfer import` does, offline, on the engine's own pristine
Firefox commit (its git HEAD), and compares the result with the tree:

  * every src/**/*.patch is applied the way surfer applies it (directory
    walk order, `git apply --ignore-space-change --ignore-whitespace`), so
    downloaded Phabricator patches under src/external-patches count too;
  * every other src/ file must be a symlink to the same path in this fork;
  * locales/en-US/browser/** must match browser/locales/en-US/**;
  * generated files (prefs, dumps, branding) are listed, not compared.

  python3 scripts/sync/check_engine_tree.py --engine ~/Temp/zen-overscroll-engine.noindex
  python3 scripts/sync/check_engine_tree.py --engine <tree> --write-export src/external-patches/astral/engine-tree.patch

The engine tree is only read (git runs with --no-optional-locks). Exit status
is 0 when the tree matches, 1 when anything differs, 2 on usage errors.

--write-export writes one patch, relative to "pristine + every src patch",
that turns the replay into the engine tree. Put it where surfer applies it
last (see SYNCING.md) and the check passes.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PATCH_ARGS = ["--ignore-space-change", "--ignore-whitespace"]

# Written by `npm run import`'s other steps or by `surfer import`'s branding
# step, not by patches. They are listed in the report but not compared.
GENERATED = (
    re.compile(r"^browser/app/profile/zen\.js$"),
    re.compile(r"^modules/libpref/init/zen-static-prefs\.inc$"),
    re.compile(r"^services/settings/dumps/"),
    re.compile(r"^browser/branding/(release|twilight)/"),
    re.compile(r"^empty-policies\.json$"),
    re.compile(r"^\.gitignore$"),  # surfer appends one line per symlink
)


def git(cwd, *args, data=None, check=True):
    r = subprocess.run(["git", "--no-optional-locks", *args], cwd=cwd, input=data,
                       capture_output=True)
    if check and r.returncode:
        raise SystemExit(f"git {' '.join(args)} failed in {cwd}: {r.stderr.decode()[:400]}")
    return r


def walk_patches(src):
    """src/**/*.patch in the order tiny-glob yields them: depth first, readdir order."""
    out = []

    def rec(d):
        for name in os.listdir(d):
            p = os.path.join(d, name)
            if os.path.isdir(p) and not os.path.islink(p):
                if name != "node_modules":
                    rec(p)
            elif name.endswith(".patch"):
                out.append(p)
    rec(src)
    return out


def touched(data):
    paths = set()
    for m in re.finditer(rb"(?m)^(?:\+\+\+ b/|--- a/|rename (?:from|to) )(\S+)", data):
        paths.add(m.group(1).decode())
    for m in re.finditer(rb"(?m)^diff --git a/(\S+) b/(\S+)", data):
        paths.update((m.group(1).decode(), m.group(2).decode()))
    return paths


def head_blobs(engine, paths):
    """{path: bytes} for paths that exist at the engine's HEAD."""
    out = {}
    paths = sorted(paths)
    req = "".join(f"HEAD:{p}\n" for p in paths).encode()
    r = subprocess.run(["git", "--no-optional-locks", "cat-file", "--batch"], cwd=engine,
                       input=req, capture_output=True, check=True)
    buf, i = r.stdout, 0
    for p in paths:
        nl = buf.index(b"\n", i)
        header = buf[i:nl].split()
        i = nl + 1
        if header[-1] == b"missing":
            continue
        size = int(header[2])
        out[p] = buf[i:i + size]
        i += size + 1
    return out


def engine_state(engine):
    """Modified tracked paths and untracked paths (files and symlinks)."""
    r = git(engine, "status", "--porcelain=v1", "-z", "-uall", "--no-renames")
    modified, untracked = [], []
    for ent in r.stdout.decode().split("\0"):
        if not ent:
            continue
        code, path = ent[:2], ent[3:]
        (untracked if code == "??" else modified).append((code.strip(), path))
    return modified, [p for _, p in untracked]


def read_engine(engine, path):
    p = os.path.join(engine, path)
    if os.path.islink(p):
        return ("link", os.readlink(p))
    if not os.path.exists(p):
        return ("missing", None)
    return ("file", open(p, "rb").read())


def replay(engine, repo, patches, extra_paths):
    """Apply every patch to the engine's HEAD versions. Returns (workdir, failures)."""
    datas = {p: open(p, "rb").read() for p in patches}
    paths = set(extra_paths) | {"browser/app/profile/firefox.js", "build/application.ini.in",
                                 "browser/config/version.txt", "browser/config/version_display.txt"}
    for d in datas.values():
        paths |= touched(d)
    blobs = head_blobs(engine, paths)
    work = tempfile.mkdtemp(prefix="engine-replay-")
    for p, b in blobs.items():
        dst = os.path.join(work, p)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, "wb").write(b)
    failures = []
    for p in patches:
        r = subprocess.run(["git", "apply", *PATCH_ARGS, "-"], cwd=work, input=datas[p],
                           capture_output=True)
        if r.returncode:
            failures.append({"patch": os.path.relpath(p, repo),
                             "reason": r.stderr.decode().strip().splitlines()[:3]})
    surfer_fixups(work, repo)
    return work, failures, sorted(paths), blobs


def surfer_fixups(work, repo):
    """The edits `npm run import` / `surfer build` make outside patches."""
    def edit(rel, fn):
        p = os.path.join(work, rel)
        if os.path.exists(p):
            data = fn(open(p, "rb").read())
            open(p, "wb").write(data)
    # tools/ffprefs prepare_zen_prefs()
    edit("browser/app/profile/firefox.js",
         lambda b: b if b"#include zen.js" in b else b + b"\n#include zen.js\n")
    # surfer branding-patch: the update URL
    edit("build/application.ini.in", lambda b: re.sub(
        rb"URL=.*update.xml",
        b"URL=https://@MOZ_APPUPDATE_HOST@/updates/browser/%BUILD_TARGET%/%CHANNEL%/update.xml", b))
    # surfer build: the display version, without a newline
    conf = json.load(open(os.path.join(repo, "surfer.json")))
    ver = (conf.get("brands", {}).get("release", {}).get("release", {})
           .get("displayVersion") or "1.0.0").encode()
    for rel in ("browser/config/version.txt", "browser/config/version_display.txt"):
        edit(rel, lambda b: ver)


def diff_bytes(path, a, b, context=8):
    """git-style patch of one file, a -> b (None = absent)."""
    with tempfile.TemporaryDirectory() as t:
        fa = fb = os.devnull
        if a is not None:
            fa = os.path.join(t, "a")
            open(fa, "wb").write(a)
        if b is not None:
            fb = os.path.join(t, "b")
            open(fb, "wb").write(b)
        out = subprocess.run(["git", "diff", "--no-index", "--no-color", f"-U{context}", fa, fb],
                             capture_output=True).stdout
    if not out:
        return b""
    if b"\nGIT binary patch" in out or b"Binary files" in out:
        raise ValueError(f"{path}: binary difference, export it by hand")
    hunks = out[out.index(b"\n@@") + 1:]
    hunks = re.sub(rb"(?m)^(@@ [^@]* @@).*$", rb"\1", hunks)  # like the fork's patches
    head = f"diff --git a/{path} b/{path}\n"
    if a is None:
        head += f"new file mode 100644\n--- /dev/null\n+++ b/{path}\n"
    elif b is None:
        head += f"deleted file mode 100644\n--- a/{path}\n+++ /dev/null\n"
    else:
        head += f"--- a/{path}\n+++ b/{path}\n"
    return head.encode() + hunks


def own_patch_name(src, path):
    """The fork's per-file patch name for an engine path (surfer export's)."""
    d, base = os.path.split(path)
    return os.path.join(src, d, base.replace(".", "-") + ".patch")


def apply_one(content, path, patch, reverse=False, data=None):
    """Apply (or reverse) the hunks of one patch for one path; None if absent."""
    with tempfile.TemporaryDirectory() as t:
        f = os.path.join(t, path)
        os.makedirs(os.path.dirname(f), exist_ok=True)
        if content is not None:
            open(f, "wb").write(content)
        r = subprocess.run(["git", "apply", *PATCH_ARGS, f"--include={path}",
                            *(["-R"] if reverse else []), "-"], cwd=t,
                           input=data if data is not None else open(patch, "rb").read(),
                           capture_output=True)
        if r.returncode:
            raise ValueError(f"{os.path.basename(patch)} does not "
                             f"{'reverse' if reverse else 'apply'} on {path}: {r.stderr.decode()[:300]}")
        return open(f, "rb").read() if os.path.exists(f) else None


def stale_version(engine, repo, path, history=40):
    """The fork commit whose version of `path`'s own patch reproduces the tree.

    A file that matches an older version of its patch means the tree is
    behind the fork (not re-imported since), not that it holds unexported
    work. Returns the short commit, or None."""
    src = os.path.join(repo, "src")
    own = own_patch_name(src, path)
    rel = os.path.relpath(own, repo)
    log = git(repo, "log", f"-n{history}", "--format=%H", "--", rel, check=False)
    commits = log.stdout.decode().split()
    if not commits:
        return None
    seq = [p for p in walk_patches(src) if p == own or path in touched(open(p, "rb").read())]
    if own not in seq:
        seq.append(own)
    k = seq.index(own)
    kind, actual = read_engine(engine, path)
    actual = actual if kind == "file" else None
    pristine = head_blobs(engine, [path]).get(path)
    for commit in commits:
        old = git(repo, "show", f"{commit}:{rel}", check=False)
        if old.returncode:
            continue
        try:
            content = pristine
            for q in seq[:k]:
                content = apply_one(content, path, q)
            content = apply_one(content, path, own, data=old.stdout)
            for q in seq[k + 1:]:
                content = apply_one(content, path, q)
        except ValueError:
            continue
        if content == actual:
            return commit[:10]
    return None


def export_into_src(engine, repo, files):
    """Write or regenerate each file's own fork patch so the replay gives the tree.

    For a file touched by patches P1..Pn (surfer's order) whose own fork patch
    is Pk, Pk becomes diff(P1..Pk-1 applied to pristine -> the tree with
    Pn..Pk+1 reversed), so the other patches (external ones included) keep
    applying unchanged. Returns the patch paths written."""
    src = os.path.join(repo, "src")
    written = []
    for path in files:
        own = own_patch_name(src, path)
        pats = walk_patches(src)
        if own not in pats:
            pats.append(own)  # surfer walks it after the external patches (see SYNCING.md)
        seq = [p for p in pats if p == own or path in touched(open(p, "rb").read())]
        k = seq.index(own)
        before = head_blobs(engine, [path]).get(path)
        for q in seq[:k]:
            before = apply_one(before, path, q)
        kind, target = read_engine(engine, path)
        target = target if kind == "file" else None
        for q in reversed(seq[k + 1:]):
            target = apply_one(target, path, q, reverse=True)
        body = diff_bytes(path, before, target, context=3)
        if body:
            os.makedirs(os.path.dirname(own), exist_ok=True)
            open(own, "wb").write(body)
        elif os.path.exists(own):
            os.remove(own)
        written.append(own)
    return written


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--engine", required=True, help="engine tree to compare with")
    ap.add_argument("--repo", default=None, help="fork checkout (default: this script's)")
    ap.add_argument("--json", help="write the full report here")
    ap.add_argument("--write-export", metavar="PATCH",
                    help="write the patch that makes the replay match the tree")
    ap.add_argument("--export-into-src", action="store_true",
                    help="write each differing file's own src/ fork patch, then re-check")
    ap.add_argument("--fail-on-stale", action="store_true",
                    help="also fail when the tree is only behind the fork (not re-imported)")
    ap.add_argument("--exclude", action="append", default=[],
                    help="glob of engine paths to ignore (repeatable)")
    a = ap.parse_args(argv)
    repo = os.path.abspath(os.path.expanduser(a.repo or REPO))
    engine = os.path.abspath(os.path.expanduser(a.engine))
    src = os.path.join(repo, "src")
    if not os.path.isdir(os.path.join(engine, ".git")):
        print(f"{engine} is not an engine tree", file=sys.stderr)
        return 2
    import fnmatch

    def excluded(p):
        return any(fnmatch.fnmatch(p, g) for g in a.exclude)

    head = git(engine, "log", "-1", "--format=%h %s").stdout.decode().strip()
    modified, untracked = engine_state(engine)
    mod_paths = [p for _, p in modified]
    patches = walk_patches(src)
    work, failures, paths, blobs = replay(engine, repo, patches, mod_paths)
    report = {"engine": engine, "engine_head": head, "repo": repo,
              "patches": len(patches), "patch_failures": failures,
              "differs": [], "unexplained_untracked": [], "bad_symlinks": [],
              "missing_symlinks": [], "locale_differs": [], "generated": [], "stale": []}
    export = []
    try:
        expected_links = {}
        for root, _, files in os.walk(src):
            for f in files:
                if f.endswith(".patch") or "/node_modules/" in root + "/":
                    continue
                full = os.path.join(root, f)
                expected_links[os.path.relpath(full, src)] = full
        locales = os.path.join(repo, "locales", "en-US", "browser")
        expected_locales = {}
        if os.path.isdir(locales):
            for root, _, files in os.walk(locales):
                for f in files:
                    full = os.path.join(root, f)
                    expected_locales["browser/locales/en-US/" + os.path.relpath(full, locales)] = full

        # 1. Every file a patch touches, and every modified tracked file.
        check = set(paths) | set(mod_paths)
        for p in sorted(check):
            if excluded(p) or p in expected_links or any(g.search(p) for g in GENERATED):
                continue
            kind, actual = read_engine(engine, p)
            wp = os.path.join(work, p)
            want = open(wp, "rb").read() if os.path.exists(wp) else None
            if kind == "link":
                continue  # handled with the symlinks below
            got = actual if kind == "file" else None
            if got != want:
                report["differs"].append(p)
                export.append((p, want, got))

        # Files an older version of their own patch reproduces: the tree is
        # behind the fork. Nothing to export (exporting would revert the fork).
        for p in list(report["differs"]):
            commit = stale_version(engine, repo, p)
            if commit:
                report["differs"].remove(p)
                report["stale"].append({"path": p, "matches_fork_commit": commit})
                export = [e for e in export if e[0] != p]

        # 2. Symlinks into src/ (surfer's "folder" patches).
        for rel, full in expected_links.items():
            if excluded(rel):
                continue
            kind, target = read_engine(engine, rel)
            if kind != "link":
                report["missing_symlinks"].append(rel)
            else:
                # Same content as this checkout's file (the tree may link into
                # another checkout of the fork).
                real = os.path.realpath(os.path.join(engine, os.path.dirname(rel), target))
                if not os.path.isfile(real) or not real.endswith("/src/" + rel) or \
                        open(real, "rb").read() != open(full, "rb").read():
                    report["bad_symlinks"].append({"path": rel, "target": target})

        # 3. Untracked files nothing above explains.
        created = {p for p in paths if p not in blobs}
        for p in untracked:
            if excluded(p) or p in expected_links or p in created:
                continue
            if any(g.search(p) for g in GENERATED):
                report["generated"].append(p)
            elif p in expected_locales:
                if open(os.path.join(engine, p), "rb").read() != open(expected_locales[p], "rb").read():
                    report["locale_differs"].append(p)
            else:
                kind, actual = read_engine(engine, p)
                if kind == "link":
                    report["bad_symlinks"].append({"path": p, "target": actual})
                else:
                    report["unexplained_untracked"].append(p)
                    export.append((p, None, actual))
    finally:
        shutil.rmtree(work, ignore_errors=True)

    bad = [k for k in ("patch_failures", "differs", "unexplained_untracked", "bad_symlinks",
                       "missing_symlinks", "locale_differs") if report[k]]
    report["ok"] = not bad and not (a.fail_on_stale and report["stale"])
    print(f"engine {head}: {len(patches)} patches replayed, "
          f"{len(report['differs'])} files differ, "
          f"{len(report['unexplained_untracked'])} unexplained untracked, "
          f"{len(report['patch_failures'])} patch failures, "
          f"{len(report['stale'])} stale (tree behind the fork)")
    for k in bad + (["stale"] if report["stale"] else []):
        items = report[k]
        print(f"{k} ({len(items)}):")
        for it in items[:60]:
            print(f"  {it if isinstance(it, str) else json.dumps(it)}")
        if len(items) > 60:
            print(f"  ... {len(items) - 60} more")
    if a.json:
        with open(a.json, "w") as fh:
            json.dump(report, fh, indent=1)
    if a.write_export and export:
        out = b"".join(diff_bytes(p, w, g) for p, w, g in sorted(export))
        os.makedirs(os.path.dirname(os.path.abspath(a.write_export)), exist_ok=True)
        open(a.write_export, "wb").write(out)
        print(f"wrote {a.write_export}: {len(export)} files")
    if a.export_into_src and report["differs"]:
        for w in export_into_src(engine, repo, report["differs"]):
            print(f"exported {os.path.relpath(w, repo)}")
        argv2 = [x for x in (argv if argv is not None else sys.argv[1:]) if x != "--export-into-src"]
        print("re-checking:")
        return main(argv2)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
