"""Check phrase-search classification and action prefixes through native ABI 6."""
import argparse
import ctypes
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--library", type=Path, required=True)
args = parser.parse_args()
library = ctypes.CDLL(str(args.library.resolve()))
assert library.zen_command_matching_version() in (6, 7)
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
    try: return json.loads(ctypes.string_at(pointer))
    finally: release(pointer)

count = 0
for query, expected in [
    ("", False), ("word", False), ("two words", True), (" word", True), ("word ", True),
    (" ", True), ("two\twords", False), ("two\nwords", False), ("two\u00a0words", False),
    ("two\u3000words", False), ("👩‍💻 docs", True), ("café notes", True),
    ("fixture.test/path space", False), ("https://fixture.test/path space", False),
    ("fixture.test/path%20space", False),
]:
    assert invoke(rules, {"query": query})["isPhraseSearch"] is expected, query
    count += 1

# Policy context does not change the separate phrase gate's native URL test.
for context in [{"didBackspace": True}, {"urlInterpretation": "url"}, {"isPrivate": True}]:
    assert invoke(rules, {"query": "two words", **context})["isPhraseSearch"] is True
    count += 1

for query, words, expected in [
    ("new tab extra", ["new tab"], True), ("new tab", ["new tab extra"], False),
    ("NEW TAB extra", ["New Tab"], True), (" new tab", ["new tab"], False),
    ("new tab", [], False), ("new tab", [""], True),
    ("new tab", ["different", "new"], True),
    ("cafe\u0301 notes", ["CAFÉ"], True), ("é notes", ["e"], False),
    ("👩‍💻 docs", ["👩"], False), ("👩‍💻 docs", ["👩‍💻"], True),
    ("İ notes", ["i"], False), ("Straße notes", ["STRASSE"], False),
]:
    candidate = {"archetype": "typeTravel", "action": {"kind": "menuItem"}, "hotWords": words}
    result = invoke(signals, {"query": query, "candidates": [candidate]})[0]
    assert result["phraseSearchActionPrefix"] is expected, (query, words, result)
    count += 1

for archetype in ["tab", "document", "searchWhatYouTyped", "chromiumHistory"]:
    assert invoke(signals, {"query": "new tab", "candidates": [
        {"archetype": archetype, "hotWords": ["new"]}
    ]})[0]["phraseSearchActionPrefix"] is False
    count += 1

print(json.dumps({"passed": count,
    "scope": "Native phrase classification and Unicode action-prefix predicates; no live provider or visual parity claim"}))
