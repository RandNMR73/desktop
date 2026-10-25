import assert from "node:assert/strict";
import test from "node:test";
import { prepareCompactFindBar } from "../../src/zen/common/modules/ZenFindBar.mjs";

function fixture() {
  const attributes = new Map();
  const requests = [], highlights = [], counts = [];
  const bar = {
    FIND_NORMAL: 0, FIND_LINKS: 2, findMode: 0, hidden: false,
    _startFindDeferred: {}, _highlightAll: true,
    _findField: { value: "previous", getAttribute: () => null },
    _foundMatches: { hidden: false },
    ownerDocument: { l10n: { setAttributes() {} } },
    getElement() { return {}; }, appendChild() {},
    hasAttribute(name) { return attributes.has(name); },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    toggleAttribute(name, value) { value ? attributes.set(name, "") : attributes.delete(name); },
    _updateStatusUIBar() {}, _updateFindUI() {}, _updateStatusUI() {},
    _updateCaseSensitivity() {}, _updateDiacriticMatching() {}, _setEntireWord() {},
    _find() {}, _findAgain() {}, close() { this.hidden = true; },
    onCurrentSelection(selection, initial) {
      if (initial && !this._startFindDeferred) return;
      if (selection) this._findField.value = selection;
      if (initial) this._startFindDeferred = null;
    },
    onMatchesCountResult(result) { counts.push(result); },
    browser: { finder: {
      highlight(...args) { highlights.push(args); },
      requestMatchesCount(word, options) { requests.push({ word, ...options }); },
    } },
  };
  prepareCompactFindBar(bar);
  const select = word => { bar._startFindDeferred = {}; bar.onCurrentSelection(word, true); };
  const reply = (id, word = "needle") => bar.onMatchesCountResult({
    searchString: word, selectionPreviewId: id, total: 2, current: 0,
  });
  return { bar, attributes, requests, highlights, counts, select, reply };
}

test("selection previews through Gecko while navigation remains available", () => {
  const f = fixture(); f.select("needle");
  assert.deepEqual(f.highlights, [[true, "needle", false]]);
  assert.equal(f.requests[0].word, "needle");
  assert.equal(f.requests[0].selectionPreviewId, 1);
  assert.equal(f.bar._foundMatches.hidden, true);
  assert.equal(f.attributes.has("zen-findbar-has-matches"), true);
  f.reply(1);
  assert.equal(f.counts.length, 1);
  assert.equal(f.counts[0].current, 0);
});

for (const method of ["_find", "_findAgain", "close"]) {
  test(`${method} rejects an older preview even for the same query`, () => {
    const f = fixture(); f.select("needle"); f.bar[method]("needle"); f.reply(1);
    assert.equal(f.counts.length, 0);
  });
}

test("a newer preview invalidates an older same-query request", () => {
  const f = fixture(); f.select("needle"); f.select("needle"); f.reply(1);
  assert.equal(f.counts.length, 0);
  f.reply(2); assert.equal(f.counts.length, 1);
});

test("late selection, IME, empty selection, hidden and quick find do not preview", () => {
  for (const modify of [
    b => { b._startFindDeferred = null; },
    b => { b._isIMEComposing = true; },
    b => { b.hidden = true; },
    b => { b.findMode = b.FIND_LINKS; },
  ]) {
    const f = fixture(); modify(f.bar); f.bar.onCurrentSelection("needle", true);
    assert.equal(f.requests.length, 0);
  }
  const f = fixture(); f.select(""); assert.equal(f.requests.length, 0);
});

test("a stale ordinary result cannot replace the current query's count", () => {
  const f = fixture(); f.select("needle");
  f.bar.onMatchesCountResult({ searchString: "previous", current: 1, total: 9 });
  assert.equal(f.counts.length, 0);
  f.bar.onMatchesCountResult({ searchString: "needle", current: 1, total: 2 });
  assert.equal(f.counts.length, 1);
});

test("repeat initialization preserves the existing callback and request sequence", () => {
  const f = fixture(), handler = f.bar.onCurrentSelection;
  f.select("needle"); prepareCompactFindBar(f.bar); f.select("needle");
  assert.equal(f.bar.onCurrentSelection, handler);
  assert.equal(f.requests[1].selectionPreviewId, 2);
});
