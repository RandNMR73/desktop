"""Check actual packaged Space cache work and behavior in one fresh owned headless profile."""
import argparse
import hashlib
import json
from pathlib import Path
import signal
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
BASE = "32246f40d1b9fda9c647c021bb2177e7d3cc5293"
SOURCE = "src/zen/spaces/ZenSpaceManager.mjs"
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--bench-tools", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--variant", choices=["baseline", "candidate"], required=True)
    args = parser.parse_args()
    assert sha(args.manifest) == args.manifest_sha256
    manifest = json.loads(args.manifest.read_text())
    app = Path(manifest["app"]).resolve()
    assert manifest["kind"] == "owned-resource-derivative" and manifest["schemaVersion"] == 2
    assert manifest["engineNativeLibraryThemeAssetsUnchanged"] and manifest["signatureVerified"] and manifest["updaterConfigAbsent"]
    assert app.is_relative_to(Path("/Users/matthewnoto/Temp/zen-arc-validation"))
    args.output.mkdir(parents=True, exist_ok=False)

    def verify():
        for name, expected in manifest["files"].items():
            path = app / name
            assert path.resolve().is_relative_to(app) and sha(path) == expected, name
        assert not (app / "Contents/Resources/astral-update.json").exists()
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True, capture_output=True)

    verify()
    sys.path.insert(0, str(args.bench_tools))
    from zen_bench.instance import Instance, free_port
    from zen_bench.profile import harness_prefs, render_prefs
    source = subprocess.check_output(["git", "show", f"{BASE}:{SOURCE}"], cwd=ROOT) if args.variant == "baseline" else (ROOT / SOURCE).read_bytes()
    result = {"variant": args.variant, "manifestSHA256": sha(args.manifest), "runnerSHA256": sha(Path(__file__)),
        "fixtureSHA256": sha(HERE / "headless.js"), "sourceSHA256": hashlib.sha256(source).hexdigest(),
        "helpers": {p.name: sha(p) for p in (args.bench_tools / "zen_bench").glob("*.py")},
        "app": str(app), "profileKind": "fresh empty owned temporary profile", "normalProfileTouched": False,
        "productMethodInjection": False, "instrumentationWrappers": True, "timingMeasurement": False}
    try:
        with tempfile.TemporaryDirectory(prefix="owned-space-cache-", dir=args.output) as temporary:
            profile = Path(temporary) / "profile"
            profile.mkdir()
            port = free_port()
            prefs = {**harness_prefs(port), "zen.welcome-screen.seen": True, "browser.startup.page": 0,
                "browser.startup.homepage_override.mstone": "ignore", "zen.urlbar.open-on-startup": False,
                "zen.view.compact.enable-at-startup": False, "zen.workspaces.separate-essentials": False,
                "dom.ipc.processCount": 2, "dom.ipc.processPrelaunch.enabled": False, "browser.warnOnQuit": False}
            result["preferences"] = prefs
            (profile / "user.js").write_text(render_prefs(prefs))
            with Instance(app, profile, port, env={"MOZ_HEADLESS": "1", "MOZ_HEADLESS_WIDTH": "1400", "MOZ_HEADLESS_HEIGHT": "1000"}, log=args.output / "browser.log") as instance:
                client = instance.client
                result["ownedPID"] = instance.pid
                try:
                    client.sock.settimeout(250)
                    client.chrome(script_timeout_ms=240000)
                    def execute(body, values):
                        return client.run("const done=arguments[arguments.length-1];(async()=>{const w=Services.wm.getMostRecentWindow('navigator:browser');" + body + "})().then(done,e=>done({ok:false,error:String(e),stack:e.stack}));", values)
                    gate = {"executable": str(app / "Contents/MacOS/zen"), "profile": str(profile),
                        "modules": [{"uri": "resource:///modules/zen/ZenSpaceManager.mjs", "sha256": result["sourceSHA256"]}],
                        "nativeSHA256": manifest["files"]["Contents/MacOS/libzen-native-theme.dylib"],
                        "updaterPath": str(app / "Contents/Resources/astral-update.json")}
                    gate_source = (ROOT / "tools/library-structural-refresh/runtime-gate.js").read_text()
                    result["runtimeBefore"] = execute(gate_source, [gate])
                    assert result["runtimeBefore"].get("ok"), result["runtimeBefore"]
                    result["observation"] = execute((HERE / "headless.js").read_text(), [str(profile)])
                    result["runtimeAfter"] = execute(gate_source, [gate])
                    assert result["runtimeAfter"] == result["runtimeBefore"]
                finally:
                    client.close()
                    instance.client = None
                    instance._signal_tree(signal.SIGTERM)
        result["profileRemoved"] = not Path(temporary).exists()
    except BaseException as error:
        result["runnerError"] = repr(error)
    verify()
    result["appUnchanged"] = True
    result["ok"] = bool(result.get("observation", {}).get("ok") and result.get("profileRemoved") and not result.get("runnerError"))
    (args.output / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"ok": result["ok"], "variant": args.variant, "error": result.get("runnerError"),
        "observationError": result.get("observation", {}).get("error"),
        "checks": result.get("observation", {}).get("checks", []),
        "indexMismatchPhases": result.get("observation", {}).get("indexMismatchPhases")}), flush=True)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
