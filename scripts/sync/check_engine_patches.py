#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Check that every engine patch applies, strictly and without fuzz, to a
pristine Firefox release, without a full engine checkout.

Only the files the patches touch are downloaded (from the mozilla-firefox
GitHub mirror at FIREFOX_<version>_RELEASE), so this runs in a few minutes on
a CI runner or a laptop short on disk.

  python3 scripts/sync/check_engine_patches.py            # version from surfer.json
  python3 scripts/sync/check_engine_patches.py --version 160.0.1 --cache /tmp/ff

Exit status is 0 when every patch applies, 1 otherwise. Patches that fail are
listed with git's reason, which is the "needs rework" list for a sync PR.
"""
import argparse
import concurrent.futures
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIRROR = "https://raw.githubusercontent.com/mozilla-firefox/firefox"


def strip_jsonc(text):
    text = re.sub(r"(?m)^\s*//.*$", "", text)
    return re.sub(r",(\s*[\]}])", r"\1", text)


def patch_list():
    pats = []
    for root, _, files in os.walk(os.path.join(REPO, "src")):
        for f in files:
            p = os.path.join(root, f)
            if f.endswith(".patch") and "/src/external-patches/" not in p:
                pats.append(p)
    pats.sort()
    manifest = os.path.join(REPO, "src", "external-patches", "manifest.json")
    if os.path.exists(manifest):
        for e in json.loads(strip_jsonc(open(manifest).read())):
            if e.get("type") == "local":
                pats.append(os.path.join(REPO, "src", "external-patches", e["path"]))
    return pats


def touched(data):
    return sorted(set(m.decode() for m in re.findall(rb"(?m)^\+\+\+ b/(\S+)", data)))


def fetch(version, path, cache):
    dst = os.path.join(cache, path)
    if os.path.exists(dst) or os.path.exists(dst + ".missing"):
        return
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    url = f"{MIRROR}/FIREFOX_{version.replace('.', '_')}_RELEASE/{path}"
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            open(dst, "wb").write(r.read())
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
        open(dst + ".missing", "w").close()  # file is created by a patch


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version")
    ap.add_argument("--cache")
    ap.add_argument("--json", help="write results here")
    ap.add_argument("--repo", help="fork checkout to check (default: this script's)")
    a = ap.parse_args()
    global REPO
    if a.repo:
        REPO = os.path.abspath(a.repo)
    version = a.version or json.load(open(os.path.join(REPO, "surfer.json")))["version"]["version"]
    cache = a.cache or os.path.join(tempfile.gettempdir(), f"ff-{version}-sources")
    pats = patch_list()
    datas = {p: open(p, "rb").read() for p in pats}
    paths = sorted({f for d in datas.values() for f in touched(d)})
    with concurrent.futures.ThreadPoolExecutor(16) as ex:
        list(ex.map(lambda f: fetch(version, f, cache), paths))
    work = tempfile.mkdtemp()
    failures = []
    try:
        for f in paths:
            src = os.path.join(cache, f)
            if os.path.exists(src):
                os.makedirs(os.path.dirname(os.path.join(work, f)), exist_ok=True)
                shutil.copy(src, os.path.join(work, f))
        for p in pats:
            r = subprocess.run(["git", "apply", "--whitespace=nowarn", "-"],
                               cwd=work, input=datas[p], capture_output=True)
            if r.returncode:
                failures.append({"patch": os.path.relpath(p, REPO),
                                 "reason": r.stderr.decode().strip()})
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f"Firefox {version}: {len(pats) - len(failures)}/{len(pats)} patches apply")
    for f in failures:
        print(f"FAIL {f['patch']}\n  {f['reason'].splitlines()[0] if f['reason'] else ''}")
    if a.json:
        json.dump({"version": version, "total": len(pats), "failures": failures},
                  open(a.json, "w"), indent=1)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
