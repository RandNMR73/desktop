"""Check the measured search identity projection in the optional native bridge."""
import argparse
import ctypes
import json

parser = argparse.ArgumentParser()
parser.add_argument("--library", required=True)
args = parser.parse_args()
library = ctypes.CDLL(args.library)
match = library.zen_command_match_signals
match.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
match.restype = ctypes.c_void_p
release = library.zen_command_matching_free
release.argtypes = [ctypes.c_void_p]
release.restype = None


def signals(candidates):
    data = json.dumps({"query": "fixture", "candidates": candidates}).encode()
    pointer = match(data, len(data))
    assert pointer
    try:
        return json.loads(ctypes.string_at(pointer))
    finally:
        release(pointer)


# Arc's identifier getter (0x101d6c9bc) dispatches its Chromium case through
# mask 0x4d: tags 0, 2, 3 and 6 call Swift lowercased and return identity tag 0.
kinds = ["chromiumSearchWhatYouTyped", "chromiumSearchSuggestion",
         "chromiumSearchHistory", "chromiumSearchOtherEngine"]
cases = [("Lattice METHOD", "lattice method"), ("CAFÉ", "café"),
         ("CAFE\u0301", "cafe\u0301"), ("İ", "i\u0307"),
         ("A" * 600 + " Z", "a" * 600 + " z")]
checks = 0
for kind in kinds:
    rows = signals([{"archetype": kind, "title": title,
                     "url": "https://example.test/search?q=ignored"}
                    for title, _ in cases])
    for row, (_, expected) in zip(rows, cases, strict=True):
        assert row["selectionIdentity"] == {"kind": 0, "value": expected}
        assert isinstance(row["features"], dict) and isinstance(row["boosts"], list)
        checks += 1
    assert "selectionIdentity" not in signals([{"archetype": kind}])[0]
    checks += 1

for kind in ["chromiumSearchCalculatorAnswer", "chromiumHistory", "tab"]:
    row = signals([{"archetype": kind, "title": "Lattice METHOD"}])[0]
    assert "selectionIdentity" not in row
    checks += 1
print(json.dumps({"passed": True, "checks": checks,
                  "scope": "Four Chromium search identity cases; no live capture claim"}))
