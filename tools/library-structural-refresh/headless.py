"""Compare real Library refresh behavior in owned profiles, or validate a packaged candidate."""
import argparse
import hashlib
import json
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
SOURCE = "src/zen/library/sections/ZenLibrarySpacesSection.mjs"
BASE = "7640b92ead18489c12d4c717d006e963d5b4d2db"
URI = "moz-src:///zen/library/sections/ZenLibrarySpacesSection.mjs"
sha = lambda data: hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--manifest-sha256", required=True)
    parser.add_argument("--bench-tools", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--mode", choices=["injection", "packaged"], default="injection")
    parser.add_argument("--variant", choices=["baseline", "candidate", "both"], default="both")
    args = parser.parse_args()
    args.app = args.app.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    assert not (args.output / "summary.json").exists(), "Use a new output directory"
    assert sha(args.manifest.read_bytes()) == args.manifest_sha256
    manifest = json.loads(args.manifest.read_text())
    assert args.app == Path(manifest["app"]).resolve()
    schema = (manifest["schemaVersion"], manifest["kind"])
    assert schema == (1, "owned-diagnostic-derivative") or (
        args.mode == "packaged" and schema == (2, "owned-resource-derivative")
        and manifest["engineNativeLibraryThemeAssetsUnchanged"] is True)
    assert manifest["signatureVerified"] is True and manifest["updaterConfigAbsent"] is True
    assert not (args.app / "Contents/Resources/astral-update.json").exists()

    def verify_app():
        for relative, expected in manifest["files"].items():
            path = args.app / relative
            assert path.resolve().is_relative_to(args.app)
            assert sha(path.read_bytes()) == expected, relative
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(args.app)], check=True, capture_output=True)

    verify_app()
    sources = {"baseline": subprocess.check_output(["git", "show", f"{BASE}:{SOURCE}"], cwd=ROOT),
               "candidate": (ROOT / SOURCE).read_bytes()}
    # Guard the deliberately small scope: batching, lifecycle and rendering
    # helpers are byte-identical, including the closed idle timeout.
    suffix = b"  #refreshTimer ="
    assert sources["baseline"].split(suffix, 1)[1] == sources["candidate"].split(suffix, 1)[1]
    variants = [args.variant] if args.variant != "both" else ["baseline", "candidate"]
    sys.path.insert(0, str(args.bench_tools))
    from zen_bench.instance import Instance, free_port
    from zen_bench.profile import harness_prefs, render_prefs
    results = {}
    for variant in variants:
        verify_app()
        with tempfile.TemporaryDirectory(prefix="owned-library-structure-", dir=args.output) as temporary:
            owned = Path(temporary)
            profile = owned / "profile"
            profile.mkdir()
            port = free_port()
            prefs = {**harness_prefs(port), "zen.welcome-screen.seen": True,
                "browser.startup.page": 0, "browser.startup.homepage_override.mstone": "ignore",
                "zen.urlbar.open-on-startup": False, "zen.library.enabled": True,
                "zen.view.compact.enable-at-startup": False, "zen.workspaces.separate-essentials": False,
                "dom.ipc.processCount": 2, "dom.ipc.processPrelaunch.enabled": False}
            (profile / "user.js").write_text(render_prefs(prefs))
            module_hash = None
            if args.mode == "injection":
                source = sources[variant].decode().replace("zen-library-spaces-section", "zen-library-spaces-section-structural-test")
                source += '\ncustomElements.get("zen-library-spaces-section").render = ZenLibrarySpacesSection.render;\n'
                (owned / "section.mjs").write_text(source)
                module_hash = sha(source.encode())
            result = {"variant": variant, "mode": args.mode, "sourceSHA256": sha(sources[variant]),
                "sourceBase": BASE, "manifestSHA256": args.manifest_sha256,
                "fixtureSHA256": sha((HERE / "headless.js").read_bytes()),
                "runnerSHA256": sha(Path(__file__).read_bytes()),
                "runtimeGateSHA256": sha((HERE / "runtime-gate.js").read_bytes()),
                "loadedTestModuleSHA256": module_hash, "harnessPreferences": prefs,
                "profileKind": "fresh empty owned temporary profile", "normalProfileTouched": False,
                "sourceTransformation": "Custom-element tag and section render registration only" if module_hash else None,
                "productMethodInjection": args.mode == "injection", "instrumentationWrappers": False,
                "timingMeasurement": False}
            try:
                with Instance(args.app, profile, port, env={"MOZ_HEADLESS": "1", "MOZ_HEADLESS_WIDTH": "1400", "MOZ_HEADLESS_HEIGHT": "1000"}, log=args.output / (variant + ".log")) as instance:
                    result["ownedPID"] = instance.pid
                    client = instance.client
                    try:
                        client.chrome(script_timeout_ms=180000)
                        def execute(body, values):
                            script = "const done=arguments[arguments.length-1];(async()=>{const w=Services.wm.getMostRecentWindow('navigator:browser');" + body + "})().then(done,error=>done({ok:false,error:String(error),stack:error.stack}));"
                            return client.run(script, values)
                        gate = {"executable": str(args.app / "Contents/MacOS/zen"), "profile": str(profile),
                            "modules": [{"uri": URI, "sha256": sha(sources["baseline" if args.mode == "injection" else variant])}],
                            "nativeSHA256": manifest["files"]["Contents/MacOS/libzen-native-theme.dylib"],
                            "updaterPath": str(args.app / "Contents/Resources/astral-update.json")}
                        result["runtimeBefore"] = execute((HERE / "runtime-gate.js").read_text(), [gate])
                        assert result["runtimeBefore"].get("ok"), result["runtimeBefore"]
                        result.update(execute((HERE / "headless.js").read_text(), [str(profile), str(owned), args.mode, variant]))
                        result["runtimeAfter"] = execute((HERE / "runtime-gate.js").read_text(), [gate])
                    finally:
                        client.close()
                        instance.client = None
                        instance._signal_tree(signal.SIGTERM)
            except BaseException as error:
                result.update(ok=False, runnerError=str(error))
            stage = profile / "fixture-stage.txt"
            result["lastStage"] = stage.read_text() if stage.exists() else None
        verify_app()
        result["runtimeProvenanceUnchanged"] = result.get("runtimeBefore") == result.get("runtimeAfter")
        result["appFilesUnchanged"] = True
        result["ok"] = bool(result.get("ok") and result["runtimeProvenanceUnchanged"])
        (args.output / (variant + ".json")).write_text(json.dumps(result, indent=2) + "\n")
        results[variant] = result
        print(json.dumps({key: result.get(key) for key in ("variant", "ok", "checks", "phases", "error", "runnerError", "lastStage")}), flush=True)
        if not result["ok"]:
            break
    matching = len(results) == 2 and results["baseline"].get("finalState") == results["candidate"].get("finalState")
    summary = {"ok": len(results) == len(variants) and all(r.get("ok") for r in results.values()) and (len(variants) == 1 or matching),
        "matchingFinalStateSnapshots": matching if len(variants) == 2 else None,
        "results": results, "ownedProfilesRemaining": [str(p) for p in args.output.glob("owned-library-structure-*")],
        "limitations": ["Headless behavior and work counts only; no native visual, timing or benchmark-score claim.",
            "Fallback notifications include explicitly labelled synthetic edge cases on real owned browser tabs."]}
    summary["ok"] = summary["ok"] and not summary["ownedProfilesRemaining"]
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    if not summary["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
