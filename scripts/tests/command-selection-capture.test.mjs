import assert from "node:assert/strict";
import test from "node:test";
import { CommandSelectionCapture, commandSelectionContext } from "../../src/zen/urlbar/ZenCommandSelectionCapture.sys.mjs";

const normal = { isPrivate: false, isPrivateWindow: false };
function windowFor(container = 0) {
  return { gZenWorkspaces: { workspaceEnabled: true, activeWorkspace: "one",
    getWorkspaces: () => [{ uuid: "one", containerTabId: container }, { uuid: "two", containerTabId: 7 }] } };
}
function fixture() {
  const records = [];
  let enabled = true;
  const capture = new CommandSelectionCapture({
    history: { record: async value => { records.push(structuredClone(value)); return true; } },
    enabled: () => enabled,
    context: (window, query) => commandSelectionContext(window, { ...normal, isPrivate: query.isPrivate }),
    identity: result => result.identity,
  });
  return { capture, records, disable: () => { enabled = false; } };
}
const chosen = { result: { identity: { kind: 3, value: "fixture.test/page" } } };

test("Space containers, not selected-tab containers or Space names, define profile identity", () => {
  const window = windowFor(7);
  window.gBrowser = { selectedTab: { userContextId: 99 } };
  assert.deepEqual(commandSelectionContext(window, normal), { profileID: "container:7", container: 7, isPrivate: false });
  window.gZenWorkspaces.activeWorkspace = "two";
  assert.equal(commandSelectionContext(window, normal).profileID, "container:7");
  assert.equal(commandSelectionContext(windowFor(), normal).profileID, undefined);
  assert.equal(commandSelectionContext({}, normal).profileID, undefined);
});

test("private, unavailable, and invalid profile state never becomes Default", () => {
  for (const flags of [{}, { ...normal, isPrivate: true }, { ...normal, isPrivateWindow: true }]) {
    assert.equal(commandSelectionContext(windowFor(), flags), null);
  }
  for (const container of [-1, 0.5, "invalid", Infinity]) {
    assert.equal(commandSelectionContext(windowFor(container), normal), null);
  }
  const window = windowFor();
  window.gZenWorkspaces.activeWorkspace = "missing";
  assert.equal(commandSelectionContext(window, normal), null);
  window.gZenWorkspaces.getWorkspaces = () => { throw Error("Startup"); };
  assert.equal(commandSelectionContext(window, normal), null);
  assert.equal(commandSelectionContext({ closed: true }, normal), null);
});

test("a choice retains its original exact query and profile after activation changes Space", async () => {
  const f = fixture(), window = windowFor();
  const query = { searchString: " Saved Page ", isPrivate: false };
  f.capture.begin(query, window);
  window.gZenWorkspaces.activeWorkspace = "two";
  query.searchString = "autocompleted.fixture.test";
  assert.equal(await f.capture.end(query, { ...chosen, searchString: "autocompleted.fixture.test" }), true);
  assert.deepEqual(f.records, [{ query: " Saved Page ", profileID: undefined, isPrivate: false, identity: chosen.result.identity }]);
  assert.equal(await f.capture.end(query, chosen), false);
});

test("overlapping windows and superseded queries retain separate snapshots", async () => {
  const f = fixture();
  const queries = [0, 7, 9].map(container => ({ query: { searchString: `query ${container}`, isPrivate: false }, window: windowFor(container) }));
  for (const item of queries) f.capture.begin(item.query, item.window);
  for (const index of [2, 0, 1]) await f.capture.end(queries[index].query, chosen);
  assert.deepEqual(f.records.map(r => [r.query, r.profileID]), [["query 9", "container:9"], ["query 0", undefined], ["query 7", "container:7"]]);
});

test("abandonment, private sessions, disabled learning and unmapped choices never record", async () => {
  for (const mode of ["abandon", "private", "disabled", "unmapped", "help", "dismiss"]) {
    const f = fixture(), query = { searchString: "query", isPrivate: mode === "private" };
    if (mode === "disabled") f.disable();
    f.capture.begin(query, windowFor());
    const details = mode === "abandon" ? null : mode === "unmapped" ? { result: {} } : { ...chosen, selType: mode };
    assert.equal(await f.capture.end(query, details), false, mode);
    assert.equal(f.records.length, 0, mode);
  }
});

test("an ongoing scope/menu interaction is not a choice; the later commit is recorded once", async () => {
  const f = fixture(), query = { searchString: "query", isPrivate: false };
  f.capture.begin(query, windowFor());
  assert.equal(await f.capture.end(query, { ...chosen, isSessionOngoing: true }), false);
  assert.equal(await f.capture.end(query, chosen), true);
  assert.equal(await f.capture.end(query, chosen), false);
  assert.equal(f.records.length, 1);
});

test("turning the gate off during a query prevents capture", async () => {
  const f = fixture(), query = { searchString: "query", isPrivate: false };
  f.capture.begin(query, windowFor()); f.disable();
  assert.equal(await f.capture.end(query, chosen), false);
  assert.equal(f.records.length, 0);
});
