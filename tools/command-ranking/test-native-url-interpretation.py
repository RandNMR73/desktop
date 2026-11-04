"""Check native URL interpretation and Backspace-specific ranking policies."""
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
assert library.zen_command_matching_version() in (5, 6)
rules = library.zen_command_query_rules
rules.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
rules.restype = ctypes.c_void_p
release = library.zen_command_matching_free
release.argtypes = [ctypes.c_void_p]
release.restype = None

def invoke(query, **context):
    encoded = json.dumps({"query": query, **context}).encode()
    pointer = rules(encoded, len(encoded))
    if not pointer: return None
    try: return json.loads(ctypes.string_at(pointer))
    finally: release(pointer)

count = 0
def check(query, url):
    global count
    result = invoke(query)
    assert result["urlInterpretation"] == ("url" if url is not None else "search"), (query,result)
    assert result.get("navigationURL") == url, (query,result,url)
    count += 1

for query in ["", "you", "cats and dogs", "site:cats", "fixture.c", "1.2.3", "ftp://fixture.test",
              "https://singlehost", "http://[::1]", "[::1]", "under_score.test", "bücher.de", "例子.测试",
              " fixture.test", "fixture.test ", "fixture.test\n", "fixture.test\r\n", "fixture.test:123456",
              "fixture.test/%", "fixture.test/%FF", "fixture.test\u0301"]:
    check(query, None)
for query, url in [
    ("fixture.test", "http://fixture.test"), ("HTTPS://fixture.test/Path", "HTTPS://fixture.test/Path"),
    ("localhost", "http://localhost"), ("LOCALHOST:8080", "http://LOCALHOST:8080"),
    ("1.2.3.4", "http://1.2.3.4"), ("999.999.999.999", "http://999.999.999.999"),
    ("fixture.test:99999", "http://fixture.test:99999"), ("xn--bcher-kva.de", "http://xn--bcher-kva.de"),
    ("chrome://settings", "chrome://settings"), ("file:///tmp/test", "file:///tmp/test"),
    ("fixture.test/a%2Fb", "http://fixture.test/a/b"), ("fixture.test/%23x", "http://fixture.test/#x"),
    ("fixture.test/path space", "http://fixture.test/path%20space"),
]: check(query, url)

# Ordinary typing retains query-specific promotion. Backspace chooses the
# URL/search interpretation first, including before the private-window rule.
for query in ["you", "book", "site:cats", "fixture.test", "localhost", "why?", ""]:
    for private in [False, True]:
        ordinary = invoke(query, isPrivate=private, didBackspace=False)
        absent = invoke(query, isPrivate=private)
        assert ordinary == absent
        deleted = invoke(query, isPrivate=private, didBackspace=True)
        if query:
            interpretation = deleted["urlInterpretation"]
            explicit = invoke(query, isPrivate=private, urlInterpretation=interpretation)
            assert deleted == explicit, (query,private,deleted,explicit)
            assert deleted["preferredMaxRanks"]["searchWhatYouTyped"] == (1 if interpretation=="url" else 0)
        else: assert deleted == ordinary
        count += 1
assert invoke("you", didBackspace=True, isPrivate=True)["preferredMaxRanks"].get("navigateWhatYouTyped") is None
assert invoke("you", didBackspace=False, isPrivate=True)["preferredMaxRanks"]["navigateWhatYouTyped"] == 0
count += 2
for invalid in ["true", 1, [], {}]:
    assert invoke("you", didBackspace=invalid) is None
    count += 1

reference_count = 0
if args.reference:
    for row in json.loads(args.reference.read_text()):
        check(row["query"], row.get("navigationURL"))
        reference_count += 1

cost = []
if args.benchmark:
    for query in ["you", "fixture.test/path", "site:cats", "x" * 1000]:
        for _ in range(10): invoke(query, didBackspace=True)
        samples = []
        for _ in range(200):
            start=time.perf_counter();invoke(query,didBackspace=True)
            samples.append((time.perf_counter()-start)*1000)
        cost.append({"queryCharacters":len(query),"medianMs":statistics.median(samples),"p95Ms":sorted(samples)[189]})
print(json.dumps({"passed":count-reference_count,"referenceURLCases":reference_count,"cost":cost,
    "scope":"Native loose URL classification and Backspace query policies; no live provider or navigation claim"},indent=2))
