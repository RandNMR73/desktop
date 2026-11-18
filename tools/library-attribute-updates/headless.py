"""Verify Library copies in fresh owned headless profiles without changing the app."""
import argparse
import hashlib
import json
import signal
import subprocess
import sys
import tempfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bench-tools", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--app", type=Path, default=Path("/Applications/Zen.app"))
    args = parser.parse_args()
    sys.path.insert(0, str(args.bench_tools))
    from zen_bench.instance import Instance, free_port
    from zen_bench.profile import harness_prefs, render_prefs

    root = Path(__file__).resolve().parents[2]
    relative = "src/zen/library/sections/ZenLibrarySpacesSection.mjs"
    sources = {
        "baseline": subprocess.check_output(["git", "show", f"9cc08095:{relative}"], cwd=root, text=True),
        "candidate": (root / relative).read_text(),
    }
    body = Path(__file__).with_name("headless.js").read_text()
    args.output.mkdir(parents=True, exist_ok=True)
    results = {}
    for variant, source in sources.items():
        with tempfile.TemporaryDirectory(prefix="owned-library-attributes-", dir=args.output) as temporary:
            owned = Path(temporary)
            profile = owned / "profile"
            profile.mkdir()
            module = owned / "section.mjs"
            module.write_text(source.replace("zen-library-spaces-section", "zen-library-spaces-section-attribute-test") +
                '\ncustomElements.get("zen-library-spaces-section").render = ZenLibrarySpacesSection.render;\n')
            port = free_port()
            prefs = {**harness_prefs(port), "zen.welcome-screen.seen": True,
                     "browser.startup.page": 0, "browser.startup.homepage_override.mstone": "ignore",
                     "zen.urlbar.open-on-startup": False, "zen.library.enabled": True,
                     "zen.view.compact.enable-at-startup": False,
                     "dom.ipc.processCount": 2, "dom.ipc.processPrelaunch.enabled": False}
            (profile / "user.js").write_text(render_prefs(prefs))
            result = {"variant": variant, "sourceSHA256": hashlib.sha256(source.encode()).hexdigest(),
                      "loadedModuleSHA256": hashlib.sha256(module.read_bytes()).hexdigest(),
                      "fixtureSHA256": hashlib.sha256(body.encode()).hexdigest(),
                      "runnerSHA256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                      "profileKind": "fresh empty owned temporary profile", "headless": True,
                      "normalProfileTouched": False, "installedAppModified": False}
            try:
                with Instance(args.app, profile, port, env={"MOZ_HEADLESS": "1", "MOZ_HEADLESS_WIDTH": "1400", "MOZ_HEADLESS_HEIGHT": "1000"}, log=args.output / f"{variant}.log") as instance:
                    client = instance.client
                    try:
                        client.chrome(script_timeout_ms=120000)
                        script = "const done=arguments[arguments.length-1]; (async()=>{const w=Services.wm.getMostRecentWindow('navigator:browser');" + body + "})().then(done,error=>done({ok:false,error:String(error),stack:error.stack}));"
                        value = client.run(script, [str(profile), str(owned), variant])
                        result.update(value)
                    finally:
                        client.close()
                        instance.client = None
                        instance._signal_tree(signal.SIGTERM)
            except BaseException as error:
                result.update(ok=False, runnerError=str(error))
            results[variant] = result
            (args.output / f"{variant}.json").write_text(json.dumps(result, indent=2) + "\n")
            print(json.dumps(result), flush=True)
    same = (results["baseline"].get("finalDOM") == results["candidate"].get("finalDOM")
            and results["candidate"].get("finalDOM") is not None)
    summary = {"ok": all(item.get("ok") for item in results.values()) and same,
               "matchingFinalDOM": same, "results": results,
               "limitations": ["Owned headless custom-element correctness only.",
                               "No native rendering, gesture, elapsed-time improvement, or browser-wide performance claim."]}
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    if not summary["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
