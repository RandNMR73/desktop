#!/usr/bin/env python3
"""Run completed-download restart checks in a new disposable Zen profile."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--app", type=Path, required=True)
parser.add_argument("--config", type=Path, required=True, help="Astralforge checkout")
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
sys.path[:0] = [str(args.config / "tools/zen-bench"), str(args.config / "scripts")]
from zen_bench.instance import Instance, free_port
from zen_bench.profile import harness_prefs, render_prefs
import zen_mozlz4
import zen_profile

requests = []


class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        requests.append(self.path)
        data = b"owned local download fixture"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *unused):
        pass


server = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{server.server_port}"
args.output.parent.mkdir(parents=True, exist_ok=True)
result = {"phases": [], "production_profile_used": False}
try:
    with tempfile.TemporaryDirectory(prefix="zen-region-colors-native-") as temporary:
        profile = Path(temporary) / "profile"
        profile.mkdir()
        port = free_port()
        prefs = harness_prefs(port)
        prefs.update({"zen.welcome-screen.seen": True, "browser.startup.homepage_override.mstone": "ignore",
                      "startup.homepage_welcome_url": "", "startup.homepage_welcome_url.additional": "",
                      "network.proxy.no_proxies_on": "127.0.0.1,localhost"})
        for name in ["documents", "desktop", "screenshot", "capture", "download"]:
            prefs["zen.library.preview.sources." + name] = False
        (profile / "user.js").write_text((args.config / "config/zen/user.js").read_text() + "\n" + render_prefs(prefs))
        spaces = json.loads((args.config / "config/zen/workspaces.json").read_text())
        zen_mozlz4.write_json(profile / "zen-sessions.jsonlz4", zen_profile.seed({}, spaces, {"essentials": [], "spaces": []}))
        records = []
        for i in range(4):
            target = profile / f"owned-restored-{i}.txt"
            target.write_text(f"owned restored file {i}")
            source = {"url": base + "/same-source", "originalUrl": base + "/original-source"} if i < 2 else {"url": f"blob:https://example.invalid/owned-{i}"}
            records.append({"source": source, "target": str(target), "startTime": f"2026-06-0{i+1}T01:02:03.000Z",
                            "endTime": 1780275724000 + i * 86400000, "succeeded": True,
                            "totalBytes": target.stat().st_size, "contentType": "text/plain"})
        (profile / "downloads.json").write_text(json.dumps({"list": records}))
        script = Path(__file__).with_name("persistence-headed.js").read_text()
        with Instance(args.app, profile, port, env={"MOZ_PURGE_CACHES": "1"}, log=args.output.with_suffix(".browser.log")) as instance:
            for phase in ["initial", "restart", "cleared"]:
                if phase != "initial":
                    instance.stop()
                    instance.start()
                instance.client.chrome(script_timeout_ms=30000)
                phase_result = instance.client.run(script, [phase])
                result["phases"].append(phase_result)
                print(json.dumps(phase_result), flush=True)
                if phase_result.get("error") or phase_result.get("failures"):
                    raise AssertionError("Browser persistence checks failed")
        result["restored_sources_requested"] = sum(path in {"/same-source", "/original-source"} for path in requests)
        result["new_public_requests"] = requests.count("/owned-live")
        result["new_private_requests"] = requests.count("/owned-private")
        assert result["restored_sources_requested"] == 0
        assert result["new_public_requests"] == result["new_private_requests"] == 1
        result["passed"] = True
finally:
    server.shutdown()
    args.output.write_text(json.dumps(result, indent=2) + "\n")
