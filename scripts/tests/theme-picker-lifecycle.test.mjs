import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../../src/zen/spaces/ZenGradientGenerator.mjs", import.meta.url), "utf8");
const lifecycle = source.slice(source.indexOf("  handlePanelClose("), source.indexOf("  #interpolateWavePath("));
const Picker = vm.runInNewContext(`(class {
  #editingWorkspaceId = null;
  ${lifecycle}
})`);

function fixture() {
  const picker = new Picker(), calls = [];
  const workspace = { theme: { gradientColors: [{ c: [52, 232, 149] }] } };
  Object.assign(picker, {
    panel: {}, workspaceBeingEdited: workspace,
    onWorkspaceChange: w => { assert.equal(w, workspace); calls.push("populate"); },
    initThemePicker: () => calls.push("listen"),
    uninitThemePicker: () => calls.push("unlisten"),
    updateCurrentWorkspace: flag => { assert.equal(flag, false); calls.push("save"); },
  });
  return { picker, calls, workspace };
}

test("opening and closing immediately never serializes or changes saved colors", () => {
  const { picker, calls, workspace } = fixture();
  const original = structuredClone(workspace);
  picker.updated = true;
  picker.handlePanelOpen({ target: picker.panel });
  picker.handlePanelClose({ target: picker.panel });
  assert.deepEqual(calls, ["populate", "listen", "unlisten"]);
  assert.deepEqual(workspace, original);
});

test("real edits save once; a second close cannot repeat the write", () => {
  const { picker, calls } = fixture();
  picker.handlePanelOpen(); picker.updated = true;
  picker.handlePanelClose(); picker.handlePanelClose();
  assert.equal(calls.filter(c => c === "save").length, 1);
});

test("descendant popup events do not tear down or overwrite the editor", () => {
  const { picker, calls } = fixture();
  picker.updated = true;
  picker.handlePanelOpen({ target: {} });
  picker.handlePanelClose({ target: {} });
  assert.deepEqual(calls, []);
  assert.equal(picker.updated, true);
});
