"""Check action bonus conditions through the compiled matching ABI."""
import argparse
import ctypes
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--library", type=Path, required=True)
parser.add_argument("--reference", type=Path)
args = parser.parse_args()
library = ctypes.CDLL(str(args.library.resolve()))
assert library.zen_command_matching_version() in (4, 5, 6, 7, 8)
match = library.zen_command_match_signals
match.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
match.restype = ctypes.c_void_p
release = library.zen_command_matching_free
release.argtypes = [ctypes.c_void_p]
release.restype = None

kinds = ["focusSpace", "moveToSpace", "moveToFolder", "undoAction", "redoAction", "joinNextMeeting",
         "menuItem", "browserExtension", "newWebDocument", "openPreferencePane", "openFolder",
         "moveToTopApps", "removeFromTopApps", "moveToNewFolder", "createNewFolder",
         "collapseAllFolders", "expandAllFolders", "toggleSidebar", "renameCurrentTab",
         "duplicateCurrentTab", "resetCurrentTab", "replacePinnedTab", "newVerticalSplitViewPane",
         "convertToHorizontalSplitView", "convertToVerticalSplitView", "addRightSplit", "addLeftSplit",
         "addTopSplit", "addBottomSplit", "muteAllTabs", "unmuteAllTabs", "newArcNote",
         "openPasswordManager", "openSearchSettings", "openAirTrafficControl"]
action_boosts = {"recentlyUseTypeTravel", "typeTravelPrefixForLongQuery", "unboxingPromotedAction"}

def invoke(request):
    encoded = json.dumps(request).encode()
    pointer = match(encoded, len(encoded))
    if not pointer: return None
    try: return json.loads(ctypes.string_at(pointer))
    finally: release(pointer)

count = 0
def check(query, candidate, expected, **context):
    global count
    result = invoke({"query": query, "candidates": [candidate], **context})
    assert result is not None
    actual = set(result[0]["boosts"]) & action_boosts
    assert actual == set(expected), (query, candidate, context, result, expected)
    count += 1

for kind in kinds:
    candidate = {"archetype": "typeTravel", "action": {"kind": kind, "menuItemIdentifier": "fixture"}}
    for executions in [0, 1, 2, 99]:
        check("", {**candidate, "action": {**candidate["action"], "recordedExecutionCount": executions}},
              ["recentlyUseTypeTravel"] if executions > 1 else [])
    check("", candidate, [])
    for ids in [[], ["different"], ["fixture"], ["FIXTURE"]]:
        promoted = kind in ["browserExtension", "renameCurrentTab"] or (kind == "menuItem" and "fixture" in ids)
        check("", candidate, ["unboxingPromotedAction"] if promoted else [], menuItemIDsToBoost=ids)

action = {"archetype": "typeTravel", "action": {"kind": "toggleSidebar"}}
for query, word, expected in [
    ("to", "toggle", False), ("tog", "toggle", True), ("TOG", "Toggle", True),
    ("toggle sidebar", "toggle", False), ("toggle", "toggle", True),
    ("tog", " toggle", False), ("tog", "", False),
    ("e\u0301co", "École", True), ("é", "École", False),
    ("👨‍👩‍👧‍👦ab", "👨‍👩‍👧‍👦abc", True), ("👨‍👩‍👧‍👦a", "👨‍👩‍👧‍👦abc", False),
    ("STRASSE", "Straße", False), ("x" * 513 + "a", "x" * 513 + "b", False),
]:
    check(query, {**action, "hotWords": [word]}, ["typeTravelPrefixForLongQuery"] if expected else [])
check("toggle", {**action, "title": "toggle"}, [])
check("tog", {**action, "hotWords": ["other", "Toggle"]}, ["typeTravelPrefixForLongQuery"])
check("", {"archetype": "tab", "action": {"kind": "renameCurrentTab", "recordedExecutionCount": 2}}, [],
      menuItemIDsToBoost=[])

# The menu ID is case sensitive but uses canonical Swift String equality.
check("", {"archetype": "typeTravel", "action": {"kind": "menuItem", "menuItemIdentifier": "É"}},
      ["unboxingPromotedAction"], menuItemIDsToBoost=["E\u0301"])
for invalid in [None, {}, {"kind": "unknown"}, {"kind": "menuItem", "menuItemIdentifier": 1},
                {"kind": "menuItem", "recordedExecutionCount": -1},
                {"kind": "menuItem", "recordedExecutionCount": 1.5},
                {"kind": "menuItem", "recordedExecutionCount": "2"}]:
    assert invoke({"query": "x", "candidates": [{"archetype": "typeTravel", "action": invalid}]}) is None
    count += 1
assert invoke({"query": "x", "candidates": [action], "menuItemIDsToBoost": [1]}) is None
count += 1

reference_count = 0
if args.reference:
    for row in json.loads(args.reference.read_text()):
        data = row["input"]
        candidate = {"archetype": "tab", "hotWords": data.get("hotWords", [])}
        if "actionKind" in data:
            candidate.update(archetype="typeTravel", action={"kind": kinds[data["actionKind"]],
                "menuItemIdentifier": data.get("menuItemIdentifier", "fixture")})
            if data.get("additionalInfo", True):
                candidate["action"]["recordedExecutionCount"] = data.get("recordedExecutionCount")
        context = {}
        if data.get("additionalInfo", True) and "menuItemIDsToBoost" in data:
            context["menuItemIDsToBoost"] = data["menuItemIDsToBoost"]
        check(data.get("query", ""), candidate, row["boosts"], **context)
        reference_count += 1
print(json.dumps({"passed": count - reference_count, "referenceActionCases": reference_count,
    "scope": "Three action bonus predicates; explicit action metadata; no provider generation or result ordering claim"}, indent=2))
