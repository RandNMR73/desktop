"""Check query policies and special-search boosts through the compiled ABI."""
import argparse
import ctypes
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--library", type=Path, required=True)
parser.add_argument("--reference", type=Path)
args = parser.parse_args()
library = ctypes.CDLL(str(args.library.resolve()))
assert library.zen_command_matching_version() in (3, 4)
rules = library.zen_command_query_rules
signals = library.zen_command_match_signals
for function in [rules, signals]:
    function.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    function.restype = ctypes.c_void_p
release = library.zen_command_matching_free
release.argtypes = [ctypes.c_void_p]
release.restype = None


def invoke(function, request):
    encoded = json.dumps(request).encode()
    pointer = function(encoded, len(encoded))
    assert pointer, request
    try:
        return json.loads(ctypes.string_at(pointer))
    finally:
        release(pointer)


short = {"searchWhatYouTyped": 1, "chromiumSearchWhatYouTyped": 1}
long = {**short, "askGPTWhatYouTyped": 2, "chromiumNavigateWhatYouTyped": 0}
navigation = {**long, "navigateWhatYouTyped": 0}
search = {"searchWhatYouTyped": 0, "chromiumSearchWhatYouTyped": 0}
explicit_search = {**search, "askGPTWhatYouTyped": 1, "chromiumNavigateWhatYouTyped": 0}
cases = [
    ({"query": ""}, short), ({"query": "you"}, short), ({"query": "book"}, long),
    ({"query": "x" * 1000}, long),
    ({"query": "👨‍👩‍👧‍👦ab"}, short), ({"query": "👨‍👩‍👧‍👦abc"}, long),
    ({"query": "e\u0301e\u0301e\u0301"}, short),
    ({"query": "?"}, {**short, "askGPTWhatYouTyped": 1}),
    ({"query": "abc?"}, {**long, "askGPTWhatYouTyped": 1}),
    ({"query": "?abc"}, long), ({"query": "abc? "}, long),
    ({"query": "abc?\ufe0f"}, long),  # Last Character is not just '?'.
    ({"query": "site:cats"}, search), ({"query": "HTTP:cats"}, search),
    ({"query": "http:cats"}, long),
    ({"query": "you", "isPrivate": True}, navigation),
    ({"query": "site:cats", "isPrivate": True}, navigation),
    ({"query": "?", "isPrivate": True}, {**navigation, "askGPTWhatYouTyped": 1}),
    ({"query": "you", "urlInterpretation": "url"}, navigation),
    ({"query": "you", "urlInterpretation": "search"}, explicit_search),
    ({"query": "you", "urlInterpretation": "search", "isPrivate": True}, explicit_search),
    ({"query": "", "urlInterpretation": "search"}, short),
    ({"query": "", "urlInterpretation": "url", "isPrivate": True}, navigation),
]
count = 0
for request, expected in cases:
    result = invoke(rules, request)
    assert result["preferredMaxRanks"] == expected, (request, result, expected)
    count += 1

for query, size in [("", 0), ("👨‍👩‍👧‍👦ab", 3), ("e\u0301", 1), ("🇺🇸", 1), ("a" * 513, 513)]:
    assert invoke(rules, {"query": query})["characterCount"] == size
    count += 1

# Scheme exclusions apply to the prefix, not only to a complete scheme name.
for query, expected in [("site:cats", True), ("inurl:cats", True), ("a:b", True),
                        ("é:тест", True), ("SITE:cats", True), ("HTTP:cats", True),
                        ("filetype:pdf", False), ("http:cats", False), ("localhost:8080", False),
                        ("site:cats dogs", False), ("site:", False), (":cats", False),
                        ("site:cats\n", True), (" site:cats", False), ("site:cats?", False)]:
    result = invoke(rules, {"query": query})
    assert result["specialSearchSyntax"] == expected, (query, result)
    count += 1

chromium_search = ["chromiumSearchWhatYouTyped", "chromiumSearchSuggestion", "chromiumSearchHistory",
                   "chromiumSearchOtherEngine", "chromiumSearchCalculatorAnswer"]
other_kinds = ["tab", "document", "easel", "topDomains", "navigateWhatYouTyped", "searchWhatYouTyped",
               "askGPTWhatYouTyped", "instantLinks", "askAssistant", "assistantHistory", "chromiumHistory",
               "chromiumNavigateWhatYouTyped", "chromiumNavigateSuggestion", "chromiumBookmark"]
for kind in chromium_search + other_kinds:
    for rank in [None, 0, 1, 1.000001, 2]:
        result = invoke(signals, {"query": "site:cats", "candidates": [{"archetype": kind, "chromiumRank": rank}]})[0]
        expected = ["chromiumSpecialSearchFunction"] if kind in chromium_search and rank == 1 else []
        assert result["boosts"] == expected, (kind, rank, result)
        count += 1
for query in ["HTTP:cats", "http:cats", "filetype:pdf", "site:cats?", "site:cats dogs"]:
    assert invoke(signals, {"query": query, "candidates": [{"archetype": chromium_search[0], "chromiumRank": 1}]})[0]["boosts"] == []
    count += 1

for request in [{"query": 1}, {"query": "x", "isPrivate": "yes"}, {"query": "x", "urlInterpretation": "guess"}, {}]:
    encoded = json.dumps(request).encode()
    assert not rules(encoded, len(encoded))
    count += 1
assert not rules(None, 0)
assert not rules(b"x", 4_194_305)
count += 2

references = 0
if args.reference:
    for row in json.loads(args.reference.read_text()):
        result = invoke(rules, row["input"])
        assert result["preferredMaxRanks"] == row["preferredMaxRanks"], (row, result)
        references += 1

print(json.dumps({"passed": count, "referencePolicyCases": references,
    "scope": "Query policy and special-search boost; URL classification is an explicit caller input; no provider ordering claim"}, indent=2))
