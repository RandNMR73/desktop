import assert from 'node:assert/strict';
import test from 'node:test';
import { HistoryURLPresentation } from '../../src/zen/urlbar/ZenUrlbarHistoryValue.mjs';

function selected(value = 'https://www.example.com/path?keep=one%20two#tail', query = 'example.com') {
  const editor = new HistoryURLPresentation();
  const state = editor.prepare(value, query);
  assert.ok(state);
  editor.commit(state);
  return { editor, state };
}

test('history display omits the web prefix while retaining escaped destination bytes', () => {
  const { editor, state } = selected();
  assert.equal(state.display, 'example.com/path?keep=one%20two#tail');
  assert.equal(state.selectionStart, 'example.com'.length);
  assert.equal(editor.clipboard(state.display, 0, state.display.length), 'https://www.example.com/path?keep=one%20two#tail');
});

test('title-only matches place the caret at the end', () => {
  const { state } = selected(undefined, 'Example Domain');
  assert.equal(state.selectionStart, state.display.length);
});

test('bare destinations hide their trailing slash and copy the complete URL', () => {
  const { editor, state } = selected('http://www.example.com/');
  assert.equal(state.display, 'example.com');
  assert.equal(editor.clipboard(state.display, 0, state.display.length), 'http://www.example.com/');
});

test('path edits keep HTTPS and the original www host', () => {
  const { editor, state } = selected();
  editor.beforeEdit(state.display, state.display.length);
  const edited = state.display + 'x';
  assert.equal(editor.edit(edited), 'https://www.example.com/path?keep=one%20two#tailx');
  assert.equal(editor.destination(edited, 'http://' + edited), 'https://www.example.com/path?keep=one%20two#tailx');
  assert.equal(editor.clipboard(edited, 0, edited.length), 'https://www.example.com/path?keep=one%20two#tailx');
});

test('HTTP and nonstandard ports survive path replacement', () => {
  const { editor, state } = selected('http://www.example.com:8443/old', 'example.com');
  editor.beforeEdit(state.display, state.authority.length);
  const edited = 'example.com:8443/new?x=%2F#y';
  assert.equal(editor.edit(edited), 'http://www.example.com:8443/new?x=%2F#y');
  assert.equal(editor.destination(edited, 'https://' + edited), 'http://www.example.com:8443/new?x=%2F#y');
});

test('replacing the whole address starts a new entry even on the same host', () => {
  const { editor, state } = selected();
  editor.beforeEdit(state.display, 0);
  assert.equal(editor.edit('example.com/new'), null);
  assert.equal(editor.destination('example.com/new', 'http://example.com/new'), null);
  assert.equal(editor.clipboard('example.com/new', 0, 15), null);
});

test('editing the authority releases the hidden prefix', () => {
  const { editor, state } = selected();
  editor.beforeEdit(state.display, 5);
  assert.equal(editor.edit('examplenew.com/path'), null);
});

test('an unannounced host or scheme change cannot inherit the previous destination', () => {
  for (const value of ['other.example/path', 'https://example.com/path', 'example.com:81/path', 'user@example.com/path']) {
    const { editor } = selected();
    assert.equal(editor.edit(value), null, value);
  }
});

test('stale or different results cannot inherit a history URL', () => {
  const { editor, state } = selected();
  for (const candidate of ['http://example.com/old', 'http://example.com/path?keep=one%20two#other', 'http://evil.example/path?keep=one%20two#tail', 'file:///example.com/path', 'http://user@example.com/path?keep=one%20two#tail']) {
    assert.equal(editor.destination(state.display, candidate), null, candidate);
  }
  assert.equal(editor.destination('changed.example/path', 'http://changed.example/path'), null);
});

test('partial copy only restores a prefix when the whole authority is included', () => {
  const { editor, state } = selected();
  assert.equal(editor.clipboard(state.display, 0, 7), null);
  assert.equal(editor.clipboard(state.display, 8, state.display.length), null);
  assert.equal(editor.clipboard(state.display, 0, 'example.com'.length), 'https://www.example.com');
  assert.equal(editor.clipboard(state.display, 0, 'example.com/path'.length), 'https://www.example.com/path');
});

test('changing selection or closing the editor clears prior URL state', () => {
  const { editor, state } = selected();
  editor.clear();
  assert.equal(editor.clipboard(state.display, 0, state.display.length), null);
  assert.equal(editor.edit(state.display + 'x'), null);
});

test('IPv6 and Unicode display text retain their complete original destinations', () => {
  for (const value of ['https://[::1]:8443/a?x=%20#y', 'https://www.bücher.example/caf%C3%A9']) {
    const { editor, state } = selected(value, 'destination');
    assert.equal(editor.clipboard(state.display, 0, state.display.length), value);
    assert.equal(editor.destination(state.display, 'http://' + state.display), value);
  }
});

test('non-web, credential-bearing and ambiguous text is not compacted', () => {
  const editor = new HistoryURLPresentation();
  for (const value of ['about:config', 'file:///tmp/local', 'ftp://example.com/a', 'https://user:password@example.com/', 'https://example.com/a b', 'https://example.com/\u202efoo', 'https://example.com\\evil/path']) {
    assert.equal(editor.prepare(value, 'query'), null, value);
  }
  assert.equal(editor.prepare('https://example.com/', ''), null);
});

test('invalid text introduced by an edit clears the compact destination', () => {
  for (const value of ['example.com/path with space', 'example.com/\u202efoo', 'example.com/\\evil']) {
    const { editor } = selected();
    assert.equal(editor.edit(value), null, value);
  }
});


test('search selection can retain query provenance without copying it as a URL', () => {
  const { editor, state } = selected();
  const edited = state.display + 'x';
  editor.edit(edited);
  const provenance = editor.preserve(edited);
  editor.clear();
  editor.commit(provenance, false);
  assert.equal(editor.clipboard(edited, 0, edited.length), null);
  assert.equal(editor.preserve('different query'), null);
  const restore = editor.preserve(edited);
  editor.clear();
  editor.commit(restore);
  assert.equal(editor.destination(edited, 'http://' + edited), 'https://www.example.com/path?keep=one%20two#tailx');
  assert.equal(editor.clipboard(edited, 0, edited.length), 'https://www.example.com/path?keep=one%20two#tailx');
});
