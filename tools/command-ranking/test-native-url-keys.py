"""Validate comparison URL preparation without changing activation URLs."""
import argparse
import ctypes
import json
from pathlib import Path
import statistics
import time

parser = argparse.ArgumentParser()
parser.add_argument("--library", type=Path, required=True)
parser.add_argument("--reference", type=Path)
parser.add_argument("--benchmark", action="store_true")
args = parser.parse_args()
library = ctypes.CDLL(str(args.library.resolve()))
assert library.zen_command_matching_version() in (7, 8)
keys = library.zen_command_url_keys
keys.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
keys.restype = ctypes.c_void_p
release = library.zen_command_matching_free
release.argtypes = [ctypes.c_void_p]
release.restype = None

def invoke(urls):
    encoded = json.dumps({"urls": urls}).encode()
    pointer = keys(encoded, len(encoded))
    if not pointer: return None
    try: return json.loads(ctypes.string_at(pointer))
    finally: release(pointer)

cases = [
    ("http://www.Fixture.test/Path/?utm_source=arc&keep=YES#Section", "https://fixture.test/path?keep=yes"),
    ("https://fixture.test/a/#!/Route/", "https://fixture.test/a/#!/route"),
    ("https://fixture.test/a/#!/route//", "https://fixture.test/a/#!/route/"),
    ("https://fixture.test/a/#!", "https://fixture.test/a/#!"),
    ("https://fixture.test/a/#/route", "https://fixture.test/a"),
    ("https://fixture.test/a/#section", "https://fixture.test/a"),
    ("https://fixture.test/a/#", "https://fixture.test/a"),
    ("https://fixture.test/a//", "https://fixture.test/a/"),
    ("https://www..fixture..test./", "https://fixture.test"),
    ("https://www.www.fixture.test/", "https://www.fixture.test"),
    ("https://fixture.test/?", "https://fixture.test"),
    ("https://fixture.test/?flag&empty=&zero=0", "https://fixture.test?zero=0"),
    ("https://fixture.test/?UTM_source=x&x=2&utm_campaign=y&x=1", "https://fixture.test?x=2&x=1"),
    ("https://fixture.test/?utm=1&utmost=2", "https://fixture.test?utm=1&utmost=2"),
    ("https://fixture.test/?%75tm_source=x&keep=%20", "https://fixture.test?keep=%20"),
    ("https://fixture.test/?q=a%2Fb", "https://fixture.test?q=a%2fb"),
    ("https://fixture.test/?q=a%2Fb&x=", "https://fixture.test?q=a/b"),
    ("https://fixture.test/a%2F", "https://fixture.test/a"),
    ("https://fixture.test/a%2Fb", "https://fixture.test/a%2fb"),
    ("https://fixture.test/ǅ", "https://fixture.test/%C7%86"),
    ("https://fixture.test/café", "https://fixture.test/caf%C3%A9"),
    ("https://fixture.test/cafe\u0301", "https://fixture.test/cafe%CC%81"),
    ("fixture.test/path", "https://fixture.test/path"),
    ("fixture.test/", "fixture.test/"),
    ("//www.fixture.test/path/", "https://fixture.test/path"),
    ("file:///tmp/Fixture/", "file:///tmp/fixture"),
    ("chrome://Settings/", "chrome://settings"),
    ("https://[bad", "https://[bad"),
    ("https://invalid.test:bad", "https://invalid.test:bad"),
]
results = invoke([row[0] for row in cases])
for (url, expected), result in zip(cases, results):
    assert result["normalizedURL"] == expected, (url, result, expected)
    # Byte-distinct, canonically equivalent inputs must not share cached
    # percent encodings. Also exercise duplicate inputs in a single batch.
    assert result == invoke([url])[0], (url, result)
assert invoke([cases[20][0], cases[21][0]] * 2) == [results[20], results[21]] * 2
count = len(cases) + 1
for url, expected in [
    ("https://fixture.test", True), ("https://fixture.test///#section", True),
    ("https://fixture.test/%2F", True), ("https://fixture.test/?", False),
    ("https://fixture.test/?utm_source=x", False), ("https://fixture.test/a/", False),
    ("https://fixture.test/#!/route", True), ("https://[bad", None),
]:
    assert invoke([url])[0].get("isRootURL") is expected, url
    count += 1
for invalid in [None, "not an array", [1], [None], ["x"] * 4097]:
    assert invoke(invalid) is None
    count += 1
assert invoke([]) == []
count += 1
reference_count = 0
if args.reference:
    for row in json.loads(args.reference.read_text()):
        assert invoke([row["url"]])[0]["normalizedURL"] == row["normalizedURL"], row
        reference_count += 1
cost = []
if args.benchmark:
    for size in [10, 100, 1000]:
        urls = [f"https://www.fixture.test/page/{i}?utm_source=test&item={i}#section" for i in range(size)]
        for _ in range(5): invoke(urls)
        samples = []
        for _ in range(100):
            start = time.perf_counter()
            invoke(urls)
            samples.append((time.perf_counter() - start) * 1000)
        cost.append({"urls": size, "medianMs": statistics.median(samples), "p95Ms": sorted(samples)[94]})
print(json.dumps({"passed": count, "referenceCases": reference_count, "cost": cost,
    "costScope": "Python JSON encoding, synchronous native URL preparation and result decoding; no browser speed claim",
    "scope": "Native prepared URL strings, root measurements and batch isolation; live ranking is not enabled"}))
