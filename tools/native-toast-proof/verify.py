#!/usr/bin/env python3
"""Check the compiled diagnostic against independent native color fixtures."""
import argparse
import json
import pathlib
import subprocess
import tempfile


def run(binary, model):
    with tempfile.NamedTemporaryFile("w", suffix=".json") as stream:
        json.dump(model, stream)
        stream.flush()
        return subprocess.run([str(binary), "--dump-colors", stream.name],
                              capture_output=True, text=True, check=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=pathlib.Path)
    args = parser.parse_args()
    fixture = json.loads(pathlib.Path(__file__).with_name("color-fixtures.json").read_text())
    result = run(args.binary.resolve(), fixture)
    assert result.returncode == 0, result.stderr
    actual = json.loads(result.stdout)
    error = 0
    for got, expected in zip(actual, fixture["spaces"], strict=True):
        assert got["name"] == expected["name"]
        for a, b in [(got["average"], expected["expectedAverage"]),
                     *zip(got["transformedBase"], expected["expectedTransformed"], strict=True)]:
            error = max(error, *(abs(x - y) for x, y in zip(a, b, strict=True)))
    assert error < 1e-9, error
    assert [row["darkHighlight"] for row in actual] == [False, False, True, False, False]
    assert [row["whiteForeground"] for row in actual] == [False, False, True, False, False]
    invalid = [{"spaces": []}, {"spaces": [{"name": "Empty", "base": []}]},
               {"spaces": [{"name": "Short", "base": [[1, 0, 0]]}]},
               {"spaces": [{"name": "Alpha", "base": [[1, 0, 0, 2]]}]}]
    for model in invalid:
        result = run(args.binary.resolve(), model)
        assert result.returncode == 1, result.stderr
        assert result.stderr.startswith("Palette probe failed:"), result.stderr
    print(json.dumps({"colorFixtures": len(actual), "maxComponentDifference": error,
                      "invalidInputsRejected": len(invalid)}, indent=2))


if __name__ == "__main__":
    main()
