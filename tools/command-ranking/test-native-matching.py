"""Validate the compiled matcher using synthetic inputs, without a browser."""
import argparse
import ctypes
import json
from pathlib import Path
import statistics
import time

parser = argparse.ArgumentParser()
parser.add_argument("--library", type=Path, required=True)
parser.add_argument("--reference-dir", type=Path)
parser.add_argument("--benchmark", action="store_true")
args = parser.parse_args()
library = ctypes.CDLL(str(args.library.resolve()))
match = library.zen_command_match_features
match.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
match.restype = ctypes.c_void_p
release = library.zen_command_matching_free
release.argtypes = [ctypes.c_void_p]
release.restype = None
assert library.zen_command_matching_version() == 1

def invoke(query, candidates):
    encoded = json.dumps({"query": query, "candidates": candidates}).encode()
    pointer = match(encoded, len(encoded))
    assert pointer, "Native matcher rejected a valid input"
    try:
        return json.loads(ctypes.string_at(pointer))
    finally:
        release(pointer)

def text_match(query, text):
    return invoke(query, [{"title": text}])[0]

count = 0
cases = [
    ("a", "aaaa", 60, 0, 1),
    ("ab", "ababab", 182, 0, 1),
    ("aba", "abababa", 280, 0, 6/7),
    ("book", "free books", 60, 5, 4/10),
    ("you", "youtube", 28, 0, 3/7),
    ("a", "x/a", 2, 2, 1/3),
    ("a", "x.a", 1, 2, 1/3),
    ("red_blue", "red blue", 88, None, 0),
    ("red blue", "red blue", 88, 0, 7/8),
    ("", "abc", 0, None, 0),
    ("abc", "", 0, None, 0),
]
for query, text, score, position, percentage in cases:
    actual = text_match(query, text)
    assert actual["titleMatchScore"] == score, (query, text, actual)
    assert actual.get("titleMatchPosition") == position, (query, text, actual)
    assert abs(actual["titleMatchPercentage"] - percentage) < 1e-14
    count += 1

for query, text, position, percentage in [
    ("é", "cafe\u0301", 3, 1/4), ("e", "café", None, 0),
    ("ss", "Straße", 4, 1/6), ("s", "ß", None, 0),
    ("σ", "ς", 0, 1), ("i", "İ", None, 0), ("I", "ı", None, 0),
    ("a", "Ａ", None, 0), ("👩", "👩‍💻", None, 0),
    ("👩‍💻", "x👩‍💻y", 1, 1/3), ("aba bab", "ababa", 0, 4/5),
    ("ß", "sbß", 0, 1), ("ﬀ", "fa", 0, 1),
    ("A", "ß\u034fAßA ", 0, 3/5),
    ("a", "👩‍💻" * 511 + "ab", 511, 1/512),
    ("b", "👩‍💻" * 511 + "ab", None, 0),
    ("b", "a" * 511 + "\r\nb", None, 0),
]:
    actual = text_match(query, text)
    assert actual.get("titleMatchPosition") == position, (query, text, actual)
    assert abs(actual["titleMatchPercentage"] - percentage) < 1e-14, (query, text, actual)
    count += 1

assert invoke("ab", [{"hotWords": ["ab", "x/abab"]}]) == [
    {"hotWordsMatchScore": 60, "hotWordsMatchPosition": 2, "hotWordsMatchPercentage": 1}]
assert invoke("ab", [{}, {"hotWords": []}]) == [{}, {"hotWordsMatchScore": 0, "hotWordsMatchPercentage": 0}]
assert invoke("ab", [{"url": "ab.test", "title": "x ab"}])[0] == {
    "urlMatchScore": 10, "urlMatchPosition": 0, "urlMatchPercentage": 2/7,
    "titleMatchScore": 10, "titleMatchPosition": 2, "titleMatchPercentage": 1/2}
assert not match(None, 0)
assert not match(None, 1)
assert not match(b"x", 4_194_305)
for malformed in [b"x", b"\xff", b"{}", b'{"query":"ab","candidates":[{"title":12}]}']:
    assert not match(malformed, len(malformed))
count += 10

references = {}
if args.reference_dir:
    rows = json.loads((args.reference_dir / "prefix-emulation.json").read_text())
    for row in rows:
        expected = sum(n * (n+1) * (2*n+1) / 6 for n in row["lengths"])
        assert text_match(row["needle"], row["text"])["titleMatchScore"] == expected, row
    references["emulatedPrefixCases"] = len(rows)
    for name in ["foundation-outputs", "foundation-unicode-outputs", "foundation-random-outputs"]:
        rows = json.loads((args.reference_dir / (name + ".json")).read_text())
        for row in rows:
            actual = text_match(row["query"], row["text"])
            assert actual.get("titleMatchPosition") == row.get("position"), (row, actual)
            assert abs(actual["titleMatchPercentage"] - row["percentage"]) < 1e-14, (row, actual)
        references[name] = len(rows)

cost = []
if args.benchmark:
    for size in [32, 128, 512, 1000]:
        candidates = [{"url": f"project-{i}.test/docs/overview", "title": f"Project {i}: annual review"} for i in range(size)]
        for _ in range(20): invoke("project review", candidates)
        samples = []
        for _ in range(100):
            start = time.perf_counter()
            invoke("project review", candidates)
            samples.append((time.perf_counter() - start) * 1000)
        samples.sort()
        cost.append({"candidates": size, "medianMs": statistics.median(samples), "p95Ms": samples[95]})
print(json.dumps({"passed": count, "references": references, "cost": cost,
    "costScope": "Python JSON encoding, synchronous native matching, and result decoding; no browser UI or ranking"}, indent=2))
