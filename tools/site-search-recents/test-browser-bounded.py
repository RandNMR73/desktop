from pathlib import Path
import argparse
import json
import sys
import tempfile

parser = argparse.ArgumentParser(description="Verify bounded recent-search eligibility in a disposable browser database.")
parser.add_argument("--app", type=Path, required=True)
parser.add_argument("--config-repo", type=Path, required=True)
parser.add_argument("--report", type=Path, required=True)
parser.add_argument("--source-modules", action="store_true")
args = parser.parse_args()
source = Path(__file__).resolve().parents[2]
report = args.report.resolve()
report.parent.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(args.config_repo.resolve() / "tools/zen-bench"))
from zen_bench.instance import Instance, free_port
from zen_bench.profile import harness_prefs, render_prefs

with tempfile.TemporaryDirectory(prefix="zen-recents-bounded-") as tmp:
    profile = Path(tmp)
    port = free_port()
    prefs = {**harness_prefs(port), "browser.startup.page": 0,
             "zen.welcome-screen.seen": True, "browser.startup.homepage_override.mstone": "ignore",
             "startup.homepage_welcome_url": "", "startup.homepage_welcome_url.additional": ""}
    (profile / "user.js").write_text(render_prefs(prefs))
    with Instance(args.app.resolve(), profile, port,
                  env={"MOZ_PURGE_CACHES": "1", "MOZ_HEADLESS": "1"},
                  log=report.with_suffix(".log")) as instance:
        instance.client.chrome(script_timeout_ms=180000)
        module = "resource:///modules/zen/urlbar/ZenSiteSearchHistory.sys.mjs"
        if args.source_modules:
            instance.client.run("""
                const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
                file.initWithPath(arguments[0]);
                Services.io.getProtocolHandler('resource').QueryInterface(Ci.nsIResProtocolHandler)
                    .setSubstitution('zen-bounded-test', Services.io.newFileURI(file));
                arguments[arguments.length-1](true);
            """, [str(source / "src/zen/urlbar")])
            module = "resource://zen-bounded-test/ZenSiteSearchHistory.sys.mjs"
        result = instance.client.run(
            (source / "tools/site-search-recents/browser-bounded-validation.js").read_text(),
            [module])
        report.write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps({"pass": result.get("pass"), "checks": len(result.get("checks", [])),
                          "medians": [{"host": row["host"], "median": row["median"]}
                                      for row in result.get("bench", [])],
                          "error": result.get("error")}), flush=True)
raise SystemExit(0 if result.get("pass") else 1)
