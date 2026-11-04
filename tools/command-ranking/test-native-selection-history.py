"""Check the pre-conversion URL gate used when recording remembered choices."""
import argparse
import ctypes
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--library", type=Path, required=True)
parser.add_argument("--reference", type=Path)
args = parser.parse_args()
library = ctypes.CDLL(str(args.library.resolve()))
assert library.zen_command_matching_version() == 8
rules = library.zen_command_query_rules
rules.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
rules.restype = ctypes.c_void_p
release = library.zen_command_matching_free
release.argtypes = [ctypes.c_void_p]
release.restype = None


def invoke(query):
    request = json.dumps({"query": query}).encode()
    pointer = rules(request, len(request))
    assert pointer
    try:
        return json.loads(ctypes.string_at(pointer))
    finally:
        release(pointer)


cases = [
    ("", False), ("cats", False), ("cats dogs", False), ("site:cats", False),
    ("fixture.test", True), ("HTTP://FIXTURE.TEST", True), ("localhost", True),
    ("999.999.999.999", True), ("fixture.test:99999", True), ("fixture.test:123456", False),
    ("fixture.test/%", True), ("fixture.test/%FF", True), ("fixture.test/path space", True),
    ("fixture.test\n", False), (" fixture.test", False), ("fixture.test ", False),
    ("file:///tmp/fixture", True), ("arc://settings", True), ("chrome://settings", True),
    ("ftp://fixture.test", False), ("bücher.de", False), ("xn--bcher-kva.de", True),
    ("http://[::1]", False), ("fixture.test/👨‍👩‍👧‍👦", True),
]
for query, expected in cases:
    assert invoke(query)["isURLLike"] is expected, (query, expected)
for query in ["fixture.test/%", "fixture.test/%FF"]:
    result = invoke(query)
    assert result["isURLLike"] and result["urlInterpretation"] == "search", result
references = 0
if args.reference:
    for row in json.loads(args.reference.read_text()):
        assert invoke(row["query"])["isURLLike"] is row["isURLLike"], row
        references += 1
print(json.dumps({"passed": len(cases) + 2, "referenceCases": references,
    "scope": "Native pre-conversion URL classification only; no selection event or live ordering claim"}, indent=2))
