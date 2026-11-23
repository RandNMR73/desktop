# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""python3 -m unittest scripts/sync/test_astral_sync_job.py"""
import datetime as dt
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import astral_sync_job as job  # noqa: E402

NOW = dt.datetime(2026, 11, 30, 12, 0)


def decide(ours="160.0.1", theirs="160.0.1", latest="160.0.1", new=True, sha="abc", state=None):
    return job.decide(ours, theirs, latest, new, sha, state or {}, 7, now=NOW)


class Decide(unittest.TestCase):
    def test_firefox_bump_is_due_immediately(self):
        st = {"last_attempt_at": (NOW - dt.timedelta(hours=2)).isoformat()}
        self.assertTrue(decide(ours="160.0.1", theirs="160.0.2", state=st)["reason"].startswith("security"))

    def test_weekly_needs_a_week_and_new_commits(self):
        recent = {"last_attempt_at": (NOW - dt.timedelta(days=3)).isoformat()}
        old = {"last_attempt_at": (NOW - dt.timedelta(days=8)).isoformat()}
        self.assertIsNone(decide(state=recent)["reason"])
        self.assertEqual(decide(state=old)["reason"], "weekly")
        self.assertIsNone(decide(new=False, state=old)["reason"])
        self.assertEqual(decide()["reason"], "weekly")  # never synced

    def test_same_upstream_is_not_retried(self):
        st = {"last_attempt_sha": "abc"}
        self.assertIsNone(decide(ours="158.0.1", theirs="160.0.1", state=st)["reason"])
        self.assertIsNotNone(decide(ours="158.0.1", theirs="160.0.1", sha="def", state=st)["reason"])

    def test_waiting_for_upstream(self):
        self.assertTrue(decide(latest="161.0", theirs="160.0.1")["waiting_for_upstream"])
        self.assertFalse(decide(latest="160.0.1")["waiting_for_upstream"])
        self.assertFalse(decide(latest=None)["waiting_for_upstream"])

    def test_version_order(self):
        self.assertGreater(job.vkey("160.0.10"), job.vkey("160.0.9"))
        self.assertGreater(job.vkey("161.0"), job.vkey("160.0.1"))


class EngineTreeCheck(unittest.TestCase):
    def test_skipped_without_a_tree(self):
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            conf = dict(job.CONF, release_engine=str(Path(t, "nope")))
            self.assertIsNone(job.engine_tree_check(conf, Path(t), Path(t)))
            self.assertIsNone(job.engine_tree_check(dict(conf, release_engine=None), Path(t), Path(t)))

    def test_blocked_sync_waits_a_day(self):
        import tempfile
        from unittest import mock
        with tempfile.TemporaryDirectory() as t:
            conf = dict(job.CONF, sync_root=t, repo=t)
            state = {"engine_tree_blocked_at": dt.datetime.now().isoformat()}
            with mock.patch.object(job, "sh") as sh, mock.patch.object(job, "save_state"):
                self.assertEqual(job.sync(conf, state, {"zen_dev": "abc"}), 3)
                sh.assert_not_called()


if __name__ == "__main__":
    unittest.main()
