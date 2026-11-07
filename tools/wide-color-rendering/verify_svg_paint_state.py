#!/usr/bin/env python3
"""Compile the actual generated SVG paint setters in an isolated Rust harness.

This tests state propagation, not Servo integration or browser rendering.
"""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rustc", default="rustc")
    args = parser.parse_args()
    engine = args.engine.resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    repo = Path(__file__).resolve().parents[2]
    relative = Path("servo/components/style/properties/gecko.mako.rs")
    source = output / relative
    source.parent.mkdir(parents=True)
    source.write_bytes(subprocess.check_output(
        ["git", "show", "HEAD:" + str(relative)], cwd=engine
    ))
    patch = repo / "src/servo/components/style/properties/gecko.mako-rs.patch"
    subprocess.run([
        "git", "apply", "--unsafe-paths", "--directory=" + str(output), str(patch)
    ], cwd="/", check=True)

    for package in ("mako", "markupsafe/src", "toml"):
        sys.path.insert(0, str(engine / "third_party/python" / package))
    sys.path.insert(0, str(engine / relative.parent))
    import build
    import data

    generated = build.render(
        str(source), engine="gecko", data=data.PropertiesData("gecko"),
        __file__=str(source), OUT_DIR=str(output)
    )
    (output / "gecko-generated.rs").write_text(generated)
    marker = "impl GeckoInheritedSVG {\n    /*\n     * Manually-Implemented Methods."
    start = generated.index(marker)
    end = generated.index("    /*\n     * Auto-Generated Methods.", start)
    methods = generated[start:end] + "}\n"
    harness_path = Path(__file__).with_name("svg-paint-state-tests.rs")
    harness = harness_path.read_text().replace("// GENERATED_SETTERS", methods)
    test_source = output / "paint-state-tests.rs"
    test_source.write_text(harness)
    binary = output / "paint-state-tests"
    subprocess.run([args.rustc, "--edition=2024", "--test", str(test_source),
                    "-o", str(binary)], check=True)
    result = subprocess.run([str(binary), "--nocapture"], text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (output / "test.log").write_text(result.stdout)
    report = {
        "scope": "Actual Mako-generated setters, isolated paint-value stand-ins; not a linked browser",
        "engineBase": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=engine, text=True
        ).strip(),
        "patchSHA256": hashlib.sha256(patch.read_bytes()).hexdigest(),
        "generatedSHA256": hashlib.sha256(generated.encode()).hexdigest(),
        "harnessSHA256": hashlib.sha256(harness_path.read_bytes()).hexdigest(),
        "exitCode": result.returncode,
        "output": result.stdout,
    }
    (output / "result.json").write_text(json.dumps(report, indent=2) + "\n")
    print(result.stdout, end="")
    raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
