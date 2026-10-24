import assert from "node:assert/strict";
import test from "node:test";
import {
  EaselEditor,
  createDocument,
  normalizeDocument,
  mergeDocuments,
  selectionBounds,
  strokeItem,
  safeSourceURL,
} from "../../src/zen/easels/ZenEaselModel.mjs";

const shape = (id, x = 0, y = 0) => ({
  id,
  type: "rectangle",
  x,
  y,
  width: 200,
  height: 200,
  color: "#36db9e",
});
const makeEditor = (onChange) =>
  new EaselEditor(createDocument("document", "title", 1482, 1), onChange);

test("new canvas has Arc's centered title and retains edits through serialization", () => {
  const editor = makeEditor();
  assert.deepEqual(selectionBounds(editor.document.items), {
    x: 291,
    y: 50,
    width: 900,
    height: 54,
  });
  editor.update("title", { text: "Field notes\nSecond line" });
  editor.add(shape("rectangle", 30, 90));
  const restored = normalizeDocument(
    JSON.parse(JSON.stringify(editor.document)),
  );
  assert.equal(restored.title, "Field notes");
  assert.equal(restored.items[0].text, "Field notes\nSecond line");
  assert.equal(restored.items[1].width, 200);
});

test("a gesture creates one undo checkpoint and one persistence notification", () => {
  const saves = [];
  const editor = makeEditor((doc) => saves.push(doc));
  editor.add(shape("rectangle"));
  editor.begin();
  for (let i = 0; i < 100; i++) {
    editor.move(["rectangle"], 1, 2);
  }
  assert.equal(saves.length, 1);
  editor.commit();
  assert.equal(saves.length, 2);
  assert.equal(editor.document.items[1].x, 100);
  assert.equal(editor.document.items[1].y, 200);
  assert.equal(editor.undo(), true);
  assert.equal(editor.document.items[1].x, 0);
  assert.equal(editor.redo(), true);
  assert.equal(editor.document.items[1].x, 100);
});

test("Escape cancels a gesture without saving or damaging redo history", () => {
  let saves = 0;
  const editor = makeEditor(() => saves++);
  editor.add(shape("rectangle"));
  editor.move(["rectangle"], 100, 100);
  editor.undo();
  editor.begin();
  editor.move(["rectangle"], 500, 500);
  editor.cancel();
  assert.equal(saves, 3);
  assert.equal(editor.document.items[1].x, 0);
  assert.equal(editor.canRedo, true);
  editor.redo();
  assert.equal(editor.document.items[1].x, 100);
});

test("group resizing preserves relative placement, stroke geometry and image identity", () => {
  const editor = makeEditor();
  editor.add(shape("a"));
  editor.add(
    strokeItem(
      "stroke",
      [
        [200, 0],
        [300, 50],
        [400, 200],
      ],
      "#ffffff",
    ),
  );
  editor.add({
    id: "image",
    type: "image",
    assetId: "asset",
    x: 0,
    y: 250,
    width: 400,
    height: 100,
  });
  editor.resize(["a", "stroke", "image"], {
    x: 100,
    y: 50,
    width: 800,
    height: 700,
  });
  const items = editor.document.items.slice(1);
  assert.deepEqual(selectionBounds(items), {
    x: 100,
    y: 50,
    width: 800,
    height: 700,
  });
  assert.equal(items[0].width, 400);
  assert.equal(items[1].x, 500);
  assert.deepEqual(items[1].points, [
    [0, 0],
    [0.5, 0.25],
    [1, 1],
  ]);
  assert.equal(items[2].assetId, "asset");
  editor.undo();
  assert.equal(editor.document.items[1].width, 200);
});

test("duplicating the title creates an ordinary editable text block", () => {
  const editor = makeEditor();
  const ids = editor.duplicate(["title"], () => "copy");
  assert.deepEqual(ids, ["copy"]);
  editor.update("copy", { text: "Independent copy" });
  assert.equal(editor.document.title, "Untitled Easel");
  assert.equal(editor.document.items[1].x, 315);
  assert.equal(editor.document.items[1].isTitle, false);
});

test("deletion and z-order changes are reversible and preserve group ordering", () => {
  const editor = makeEditor();
  editor.add(shape("a"));
  editor.add(shape("b"));
  editor.add(shape("c"));
  editor.reorder(["a", "b"], true);
  assert.deepEqual(
    editor.document.items.map((item) => item.id),
    ["title", "c", "a", "b"],
  );
  editor.remove(["a", "c"]);
  assert.deepEqual(
    editor.document.items.map((item) => item.id),
    ["title", "b"],
  );
  editor.undo();
  editor.undo();
  assert.deepEqual(
    editor.document.items.map((item) => item.id),
    ["title", "a", "b", "c"],
  );
});

test("a new edit after undo discards redo, while no-op edits do not", () => {
  const editor = makeEditor();
  editor.add(shape("a"));
  editor.move(["a"], 10, 10);
  editor.undo();
  editor.update("missing", { color: "#000000" });
  assert.equal(editor.canRedo, true);
  editor.update("a", { color: "#000000" });
  assert.equal(editor.canRedo, false);
});

test("malformed imports and duplicate identifiers do not mutate the working document", () => {
  const editor = makeEditor();
  const before = editor.document;
  assert.throws(() => editor.add({ ...shape("title") }), /Duplicate/);
  assert.throws(
    () => editor.add({ id: "bad", type: "image", assetId: "../outside" }),
    /asset/,
  );
  assert.deepEqual(editor.document, before);
  assert.equal(editor.inTransaction, false);
  assert.equal(editor.canUndo, false);
});

test("live captures accept web destinations without granting executable/local URLs", () => {
  assert.equal(
    safeSourceURL("https://example.org/page#anchor"),
    "https://example.org/page#anchor",
  );
  for (const url of [
    "javascript:alert(1)",
    "file:///private/file",
    "chrome://browser/content/",
    "data:text/html,hello",
  ]) {
    assert.equal(safeSourceURL(url), null);
  }
});

test("stored stroke coordinates remain finite for a dot or a straight line", () => {
  const dot = strokeItem("dot", [[10, 10]], "#ffffff");
  assert.equal(dot.width, 1);
  assert.equal(dot.height, 1);
  const line = strokeItem(
    "line",
    [
      [20, 10],
      [20, 40],
    ],
    "#ffffff",
  );
  assert.deepEqual(line.points, [
    [0, 0],
    [0, 1],
  ]);
});

test("concurrent edits combine independent items and fields", () => {
  const e = makeEditor();
  e.add(shape("shape"));
  const base = e.document;
  const local = structuredClone(base),
    remote = structuredClone(base);
  local.items[1].x = 300;
  remote.items[1].color = "#ff0000";
  remote.items.push(shape("remote"));
  const merged = mergeDocuments(base, local, remote);
  assert.equal(merged.items[1].x, 300);
  assert.equal(merged.items[1].color, "#ff0000");
  assert.equal(merged.items.at(-1).id, "remote");
});

test("conflicting edits preserve both versions and deletion preserves newer work", () => {
  const e = makeEditor();
  e.add(shape("shape"));
  const base = e.document;
  const local = structuredClone(base),
    remote = structuredClone(base);
  local.items[1].color = "#ff0000";
  remote.items[1].color = "#0000ff";
  const merged = mergeDocuments(base, local, remote, () => "conflict-copy");
  assert.equal(
    merged.items.find((item) => item.id === "shape").color,
    "#ff0000",
  );
  assert.equal(
    merged.items.find((item) => item.id === "conflict-copy").color,
    "#0000ff",
  );
  local.items.pop();
  assert.equal(
    mergeDocuments(base, local, remote).items.at(-1).color,
    "#0000ff",
  );
  assert.equal(mergeDocuments(base, local, base).items.length, 1);
});

test("undo and redo preserve changes arriving from another window", () => {
  const e = makeEditor();
  e.add(shape("local"));
  const remote = e.document;
  remote.items.push(shape("remote"));
  e.integrateRemote(remote);
  e.undo();
  assert.deepEqual(
    e.document.items.map((item) => item.id),
    ["title", "remote"],
  );
  e.redo();
  assert.deepEqual(
    e.document.items.map((item) => item.id),
    ["title", "local", "remote"],
  );
});
