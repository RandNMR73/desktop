# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""check_engine_tree on a tiny synthetic fork and engine tree.

  python3 -m unittest scripts/sync/test_check_engine_tree.py
"""
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_engine_tree as cet  # noqa: E402

PRISTINE = "line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\n"


def sh(cwd, *args):
    subprocess.run(args, cwd=cwd, check=True, capture_output=True)


class EngineTree(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = self.tmp.name
        self.engine, self.repo = os.path.join(root, "engine"), os.path.join(root, "fork")
        os.makedirs(os.path.join(self.engine, "a"))
        os.makedirs(os.path.join(self.repo, "src", "a"))
        os.makedirs(os.path.join(self.repo, "src", "zen"))
        open(os.path.join(self.engine, "a", "f.txt"), "w").write(PRISTINE)
        open(os.path.join(self.engine, "a", "g.txt"), "w").write(PRISTINE)
        open(os.path.join(self.repo, "surfer.json"), "w").write(json.dumps(
            {"brands": {"release": {"release": {"displayVersion": "1.0"}}}}))
        for d in (self.engine, self.repo):
            sh(d, "git", "init", "-q")
            sh(d, "git", "config", "user.email", "t@example.com")
            sh(d, "git", "config", "user.name", "t")
        sh(self.engine, "git", "add", ".")
        sh(self.engine, "git", "commit", "-qm", "Firefox 1.0")
        # The fork: one patch and one plain file (symlinked by surfer).
        self.write_engine("a/f.txt", PRISTINE.replace("line 2", "fork 2"))
        cet.export_into_src(self.engine, self.repo, ["a/f.txt"])
        open(os.path.join(self.repo, "src", "zen", "z.js"), "w").write("z\n")
        os.makedirs(os.path.join(self.engine, "zen"))
        os.symlink(os.path.join(self.repo, "src", "zen", "z.js"), os.path.join(self.engine, "zen", "z.js"))
        sh(self.repo, "git", "add", ".")
        sh(self.repo, "git", "commit", "-qm", "fork")

    def tearDown(self):
        self.tmp.cleanup()

    def write_engine(self, rel, text):
        open(os.path.join(self.engine, rel), "w").write(text)

    def check(self, *extra):
        out = io.StringIO()
        js = os.path.join(self.tmp.name, "r.json")
        with redirect_stdout(out):
            code = cet.main(["--engine", self.engine, "--repo", self.repo, "--json", js, *extra])
        return code, json.load(open(js)), out.getvalue()

    def test_matching_tree_passes(self):
        code, r, _ = self.check()
        self.assertEqual(code, 0, r)
        self.assertEqual(r["differs"], [])

    def test_unexported_edit_fails_and_exports(self):
        self.write_engine("a/f.txt", PRISTINE.replace("line 2", "fork 2").replace("line 7", "tree 7"))
        self.write_engine("a/g.txt", PRISTINE.replace("line 4", "tree 4"))
        code, r, _ = self.check()
        self.assertEqual(code, 1)
        self.assertEqual(sorted(r["differs"]), ["a/f.txt", "a/g.txt"])
        code, r, _ = self.check("--export-into-src")
        self.assertEqual(code, 0, r)
        self.assertTrue(os.path.exists(os.path.join(self.repo, "src", "a", "g-txt.patch")))

    def test_unexported_new_file_and_bad_symlink(self):
        self.write_engine("a/new.txt", "new\n")
        os.remove(os.path.join(self.engine, "zen", "z.js"))
        self.write_engine("zen/z.js", "z\n")  # a copy, not surfer's symlink
        code, r, _ = self.check()
        self.assertEqual(code, 1)
        self.assertEqual(r["unexplained_untracked"], ["a/new.txt"])
        self.assertEqual(r["missing_symlinks"], ["zen/z.js"])

    def test_tree_behind_the_fork_is_stale_not_unexported(self):
        self.write_engine("a/f.txt", PRISTINE.replace("line 2", "fork 2").replace("line 8", "fork 8"))
        cet.export_into_src(self.engine, self.repo, ["a/f.txt"])
        sh(self.repo, "git", "commit", "-qam", "fork, newer")
        self.write_engine("a/f.txt", PRISTINE.replace("line 2", "fork 2"))  # tree not re-imported
        code, r, _ = self.check()
        self.assertEqual(code, 0, r)
        self.assertEqual([s["path"] for s in r["stale"]], ["a/f.txt"])
        self.assertEqual(self.check("--fail-on-stale")[0], 1)


if __name__ == "__main__":
    unittest.main()
