import ast
import contextlib
import copy
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse
import uuid


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "scripts/tests/fixtures/pgo"
DEFAULTS = json.loads((FIXTURES / "speedometer-defaults.json").read_text())


def complete(token):
    suites = {suite["name"]: [step["name"] for step in suite["tests"]]
              for suite in DEFAULTS["suites"] if not suite["disabled"]}
    return {"version": 1, "token": token, "status": "complete", "speedometer": {
        "expectedIterations": 10, "expectedSuites": suites, "stepCount": 580,
        "iterations": [copy.deepcopy(suites) for _ in range(10)]}}


class TrainingGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source_dir = tempfile.TemporaryDirectory(prefix="zen-pgo-source-")
        source = Path(cls.source_dir.name) / "build/pgo/profileserver.py"
        source.parent.mkdir(parents=True)
        source.write_text((FIXTURES / "profileserver.py").read_text())
        subprocess.run(["git", "apply", "--check", str(ROOT / "src/build/pgo/profileserver-py.patch")],
                       cwd=cls.source_dir.name, check=True)
        subprocess.run(["git", "apply", str(ROOT / "src/build/pgo/profileserver-py.patch")],
                       cwd=cls.source_dir.name, check=True)
        cls.source = source
        definitions = [node for node in ast.parse(source.read_text()).body
                       if (isinstance(node, (ast.FunctionDef, ast.ClassDef))
                           and node.name in ("validate_training_result", "TrainingResult", "preserve_mapped_directory_slashes"))
                       or (isinstance(node, ast.Assign) and any(
                           isinstance(target, ast.Name) and target.id == "SPEEDOMETER_DEFAULT_STEPS"
                           for target in node.targets))]
        namespace = {"json": json, "uuid": uuid}
        exec(compile(ast.Module(body=definitions, type_ignores=[]), str(source), "exec"), namespace)
        cls.result_class = namespace["TrainingResult"]
        cls.preserve_slashes = staticmethod(namespace["preserve_mapped_directory_slashes"])

    @classmethod
    def tearDownClass(cls):
        cls.source_dir.cleanup()

    def run_server(self, case):
        merges, stops, servers, receipts = [], [], [], []
        with tempfile.TemporaryDirectory(prefix="zen-pgo-owned-") as directory:
            work = Path(directory)
            profiles = work / "testing/profiles"
            profiles.mkdir(parents=True)
            (profiles / "profiles.json").write_text('{"profileserver": []}')

            class CLI:
                def __init__(self, args):
                    self.options = types.SimpleNamespace(extended_corpus_dir=None)

                def debugger_arguments(self):
                    return [], False

                def runner_args(self):
                    return {"binary": "/owned/firefox"}

            class Httpd:
                def __init__(self, **kwargs):
                    self.options = kwargs
                    self.handler_class = type("Handler", (), {})
                    self.httpd = types.SimpleNamespace(server_address=("127.0.0.1", 12345))
                    servers.append(self)

                def start(self, **kwargs):
                    pass

                def stop(self):
                    pass

            outer = self

            class Runner:
                def __init__(self, **kwargs):
                    self.args = kwargs

                def start(self, **kwargs):
                    pass

                def stop(self):
                    stops.append(True)

                def wait(self, timeout=None):
                    url = self.args["cmdargs"][0]
                    if url.endswith("/quit.html"):
                        outer.assertIsNone(timeout)
                        return 0
                    outer.assertEqual(timeout, 3600)
                    token = parse_qs(urlparse(url).query)["trainingToken"][0]
                    record = complete(token)
                    result = record["speedometer"]
                    if case == "failed":
                        record.update(status="failed", error="owned page error")
                    if case == "iterations":
                        result["iterations"].pop()
                    if case == "suites":
                        result["iterations"][0].pop(next(iter(result["expectedSuites"])))
                    if case == "steps":
                        result["iterations"][0][next(iter(result["expectedSuites"]))].pop()
                    if case == "manifest":
                        result["expectedSuites"].pop(next(iter(result["expectedSuites"])))
                    if case == "wrong-name":
                        old = next(iter(result["expectedSuites"]))
                        for mapping in [result["expectedSuites"], *result["iterations"]]:
                            mapping["Wrong default suite"] = mapping.pop(old)
                    if case == "wrong-step":
                        suite = next(iter(result["expectedSuites"]))
                        for mapping in [result["expectedSuites"], *result["iterations"]]:
                            mapping[suite][0] = "Wrong default step"
                    if case == "wrong-token":
                        record["token"] = "previous-run"
                    if case not in ("missing", "timeout"):
                        handler = servers[0].options["urlhandlers"][0]
                        outer.assertEqual(handler["method"], "POST")
                        outer.assertEqual(handler["path"], "^/pgo-training-result$")
                        receipts.append(handler["function"](types.SimpleNamespace(body=json.dumps(record).encode()))[0])
                    (work / "owned.profraw").write_bytes(b"owned fake profile")
                    return None if case == "timeout" else 2 if case == "exit" else 0

            modules = {}
            for name in ("mozcrash", "mozbuild", "mozbuild.base", "mozfile", "mozhttpd",
                         "mozprofile", "mozprofile.permissions", "mozrunner"):
                modules[name] = types.ModuleType(name)
            modules["mozbuild.base"].BinaryNotFoundException = RuntimeError
            modules["mozbuild.base"].MozbuildObject = types.SimpleNamespace(
                from_environment=lambda: types.SimpleNamespace(topsrcdir=directory))
            modules["mozfile"].TemporaryDirectory = tempfile.TemporaryDirectory
            modules["mozfile"].json = json
            modules["mozhttpd"].MozHttpd = Httpd
            modules["mozprofile"].FirefoxProfile = lambda **kwargs: object()
            modules["mozprofile"].Preferences = types.SimpleNamespace(cast=lambda value: value)
            modules["mozprofile.permissions"].ServerLocations = lambda: types.SimpleNamespace(add_host=lambda **kwargs: None)
            modules["mozrunner"].CLI = CLI
            modules["mozrunner"].FirefoxRunner = Runner

            def merge(command):
                merges.append(command)
                (work / "merged.profdata").write_bytes(b"owned merged fixture")
                return 0

            previous = os.getcwd()
            try:
                os.chdir(work)
                # A stale success file must not authorize a new run with no receipt.
                (work / "pgo-training-result.json").write_text(json.dumps(complete("previous-run")))
                with patch.dict(sys.modules, modules), patch.dict(os.environ, {"LLVM_PROFDATA": "/owned/llvm-profdata"}, clear=True), \
                     patch("socket.socket") as socket, patch("subprocess.call", side_effect=merge), \
                     contextlib.redirect_stdout(io.StringIO()):
                    socket.return_value.__enter__.return_value.getsockname.return_value = ("127.0.0.1", 12345)
                    try:
                        runpy.run_path(str(self.source), run_name="__main__")
                        status = 0
                    except SystemExit as exc:
                        status = exc.code
                diagnostic = json.loads((work / "pgo-training-result.json").read_text())
            finally:
                os.chdir(previous)
        return status, merges, stops, receipts, diagnostic

    def test_complete_training_can_merge(self):
        status, merges, stops, receipts, diagnostic = self.run_server("complete")
        self.assertEqual(status, 0)
        self.assertEqual(len(merges), 1)
        self.assertEqual(receipts, [200])
        self.assertFalse(stops)
        self.assertIsNone(diagnostic["validationError"])

    def test_missing_failed_incomplete_and_timed_out_training_never_merge(self):
        for case in ("missing", "failed", "iterations", "suites", "steps", "manifest",
                     "wrong-name", "wrong-step", "wrong-token", "timeout", "exit"):
            with self.subTest(case=case):
                status, merges, stops, receipts, diagnostic = self.run_server(case)
                self.assertNotEqual(status, 0)
                self.assertFalse(merges)
                self.assertTrue(diagnostic["validationError"])
                self.assertEqual(bool(stops), case == "timeout")
                if case == "wrong-token":
                    self.assertEqual(receipts, [400])

    def test_receipts_are_bounded_and_cannot_replace_a_terminal_result(self):
        state = self.result_class()
        for body in (None, b"{", b"x" * (1024 * 1024 + 1), b"[]", b'{"token":"old"}'):
            self.assertEqual(state.receive(types.SimpleNamespace(body=body))[0], 400)
        valid = types.SimpleNamespace(body=json.dumps(complete(state.token)).encode())
        self.assertEqual(state.receive(valid)[0], 200)
        self.assertEqual(state.receive(valid)[0], 409)

    def test_nested_directory_mapping_keeps_the_original_trailing_slash(self):
        class Handler:
            def _find_path(self):
                return self.mapping

        server = types.SimpleNamespace(handler_class=Handler)
        self.preserve_slashes(server)
        handler = server.handler_class()
        for original, mapped, expected in [
            ("/webkit/PerformanceTests/Speedometer3/resources/perf.webkit.org/public/v3/",
             "Speedometer3/resources/perf.webkit.org/public/v3", "Speedometer3/resources/perf.webkit.org/public/v3/"),
            ("/webkit/PerformanceTests/Speedometer3/index.html", "Speedometer3/index.html", "Speedometer3/index.html"),
            ("/", "/", "/"),
        ]:
            handler.request = types.SimpleNamespace(path=original)
            handler.mapping = (mapped, "/owned")
            self.assertEqual(handler._find_path(), (expected, "/owned"))
        handler.mapping = None
        self.assertIsNone(handler._find_path())


if __name__ == "__main__":
    unittest.main()
