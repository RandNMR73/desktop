"""Check general command boosts with synthetic candidates and the compiled ABI."""
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
assert library.zen_command_matching_version() == 2
match = library.zen_command_match_signals
match.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
match.restype = ctypes.c_void_p
release = library.zen_command_matching_free
release.argtypes = [ctypes.c_void_p]
release.restype = None

def invoke(query, candidates):
    encoded = json.dumps({"query": query, "candidates": candidates}).encode()
    pointer = match(encoded, len(encoded))
    assert pointer, "Native signals rejected a valid input"
    try:
        return json.loads(ctypes.string_at(pointer))
    finally:
        release(pointer)

count = 0
def check(query, candidate, expected):
    global count
    result = invoke(query, [candidate])[0]
    assert set(result["boosts"]) == set(expected), (query, candidate, result, expected)
    count += 1
    return result

tab = {"archetype": "tab", "url": "https://www.fixture.test/"}
domain = {**tab, "archetype": "topDomains"}
check("fixture.test", tab, ["exactURL", "baseDomain", "autocompleteDefault"])
check("fixture.test", domain, ["exactBaseDomain", "autocompleteDefault"])
check("fix", tab, ["baseDomain", "autocompleteDefault"])
check("FIX", domain, ["baseDomain", "autocompleteDefault"])
check("https://www.fixture.test/", tab, ["exactURL", "baseDomain"])
check("http://fixture.test", domain, ["exactURL"])
check("https://", domain, ["baseDomain"])
check("/", domain, ["baseDomain"])
for query in ["", " ", "arc://", "ARC://fixture.test"]:
    check(query, domain, [])
for suffix in ["?", "?q=a", "/article", "/?q=a"]:
    check("fix", {**domain, "url": "https://fixture.test/" + suffix}, ["autocompleteDefault"])
check("fix", {**domain, "url": "https://fixture.test/#section"}, ["baseDomain", "autocompleteDefault"])
check("fix", {**domain, "url": "https://fixture.test////"}, ["baseDomain", "autocompleteDefault"])
check("fixture.test/article", {**domain, "url": "https://fixture.test/article"}, ["exactURL", "autocompleteDefault"])

# Search-like archetypes cannot earn URL bonuses even if their payload has one.
for kind in ["searchWhatYouTyped", "askGPTWhatYouTyped", "instantLinks",
             "chromiumSearchWhatYouTyped", "chromiumSearchSuggestion", "chromiumSearchHistory",
             "chromiumSearchOtherEngine", "chromiumSearchCalculatorAnswer"]:
    check("fix", {**tab, "archetype": kind, "completionText": "fixture search"}, ["autocompleteSearchOnly"])
    check("fix", {**tab, "archetype": kind}, [])
for kind in ["chromiumHistory", "chromiumNavigateSuggestion", "chromiumBookmark", "navigateWhatYouTyped"]:
    check("fixture.test", {**domain, "archetype": kind}, ["exactBaseDomain", "autocompleteDefault"])
check("fix", {**tab, "archetype": "chromiumNavigateWhatYouTyped", "completionText": "fixture.test"},
      ["baseDomain", "autocompleteDefault"])
check("FIX", {"archetype": "chromiumSearchSuggestion", "completionText": "FIXTURE"}, [])

# Custom names, full hot words, and composed Unicode compare as Swift Strings.
check("É", {"archetype": "tab", "customTitle": "E\u0301tudes"}, ["customTitlePrefix"])
check("STRASSE", {"archetype": "tab", "customTitle": "Straße"}, [])
check("fix", {"archetype": "tab", "title": "Fixture"}, [])
check("fix", {"archetype": "document", "title": "Fixture"}, ["customTitlePrefix", "autocompleteDefault"])
check("fix", {"archetype": "easel", "title": "Fixture"}, ["autocompleteDefault"])
check("é", {"archetype": "tab", "hotWords": ["E\u0301", "different"]}, ["exactHotWord"])
check("fix", {"archetype": "tab", "hotWords": ["fixture"]}, [])
check("fix", {"archetype": "tab", "hotWords": [" fix", "fix "]}, [])
check("", {"archetype": "tab", "hotWords": [""]}, [])
check("x" * 513 + "a", {"archetype": "tab", "customTitle": "x" * 513 + "b"}, [])
check("x" * 513 + "a", {"archetype": "tab", "hotWords": ["x" * 513 + "b"]}, [])

for kind in ["tab", "document", "easel"]:
    check("", {"archetype": kind, "lastNavigated": 3599.999, "savedContext": "global"},
          ["veryRecentTabOrDocumentBoost", "topApp"])
    check("", {"archetype": kind, "lastNavigated": 3600, "savedContext": "scoped"}, [])
    check("", {"archetype": kind, "lastNavigated": -1}, ["veryRecentTabOrDocumentBoost"])
    check("", {"archetype": kind}, [])
check("", {"archetype": "chromiumHistory", "lastNavigated": 1, "savedContext": "global"}, [])
check("", {"archetype": "tab", "fuzzySearchConfidence": 0.8}, [])
check("", {"archetype": "chromiumHistory", "fuzzySearchConfidence": 0.80000001}, ["highFuzzySearchConfidence"])

normalizations = [
    ("https://www.fixture.test/?", "fixture.test"),
    ("http://www.fixture.test/", "fixture.test"),
    ("https://www.www.fixture.test//??", "www.fixture.test//?"),
    ("HTTPS://WWW.fixture.test/", "https://www.fixture.test"),
    ("https://WWW.fixture.test/", "www.fixture.test"),
    ("ftp://www.fixture.test/", "ftp://www.fixture.test"),
    ("www.fixture.test/?q=A", "fixture.test/?q=a"),
    ("www.fixture.test?#X/", "fixture.test?#x"),
    ("https://fixture.test/path?/", "fixture.test/path?"),
    (" www.fixture.test/ ", " www.fixture.test/ "),
    ("https://fixture.test/%2F", "fixture.test/%2f"),
    ("https://fixture.test:443/", "fixture.test:443"),
    ("https://name:secret@fixture.test/", "name:secret@fixture.test"),
    ("?", ""), ("/?", ""), ("?/", "?"), ("", ""),
]
for value, expected in normalizations:
    result = invoke("", [{"archetype": "tab", "url": value}])[0]
    assert result["completion"] == expected, (value, result, expected)
    count += 1

ordered = invoke("fixture.test", [{**tab, "savedContext": "global", "lastNavigated": 1,
    "hotWords": ["fixture.test"], "customTitle": "fixture.test saved", "fuzzySearchConfidence": 0.9}])[0]
assert ordered["boosts"] == ["exactURL", "exactHotWord", "baseDomain", "autocompleteDefault",
    "customTitlePrefix", "veryRecentTabOrDocumentBoost", "topApp", "highFuzzySearchConfidence"]
assert ordered["features"]["urlMatchPosition"] == 12
count += 2
for candidate in [{"archetype": "unrecognized"}, {"archetype": "typeTravel"},
                  {"archetype": "tab", "savedContext": "other"}, {"archetype": "tab", "lastNavigated": "yesterday"}]:
    encoded = json.dumps({"query": "x", "candidates": [candidate]}).encode()
    assert not match(encoded, len(encoded))
    count += 1
assert not match(None, 0)
assert not match(b"x", 4_194_305)
count += 2

reference_count = 0
if args.reference:
    for row in json.loads(args.reference.read_text()):
        result = invoke("", [{"archetype": "tab", "url": row["input"]}])[0]
        assert result["completion"] == row["output"], (row, result)
        reference_count += 1

cost = []
if args.benchmark:
    for size in [32, 128]:
        candidates = [{"archetype": "tab", "url": f"https://project-{i}.test/", "title": f"Project {i}",
            "lastNavigated": i * 60, "savedContext": "scoped"} for i in range(size)]
        for _ in range(10): invoke("project", candidates)
        samples = []
        for _ in range(50):
            start = time.perf_counter()
            invoke("project", candidates)
            samples.append((time.perf_counter() - start) * 1000)
        cost.append({"candidates": size, "medianMs": statistics.median(samples)})
print(json.dumps({"passed": count, "normalizationReferenceCases": reference_count, "cost": cost,
    "scope": "Native text features and ten general boost rules; no provider integration or browser ordering claim"}, indent=2))
