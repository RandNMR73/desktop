import assert from "node:assert/strict";
import test from "node:test";
import { CommandPrefixSessions } from "../../src/zen/urlbar/ZenCommandPrefixSessions.sys.mjs";

const old = [{ url: "https://fixture.test/page", providerName: "HistoryURL", relevance: 1200 }];
const begin = (sessions, owner, text, engine = null, context = {}) =>
  sessions.begin(owner, context, { text, engine });

test("empty scoped recents preserve the alias reader and its actual published batches", () => {
  const sessions = new CommandPrefixSessions(), window = {};
  const prefix = begin(sessions, window, "fixture.test").ticket;
  begin(sessions, window, "", "Fixture");
  assert.equal(prefix.current(), true);
  assert.equal(prefix.publish(old), true);
  const scoped = begin(sessions, window, "query", "Fixture").ticket;
  assert.deepEqual(scoped.previous, old);
  assert.equal(prefix.current(), false);
  assert.equal(prefix.publish([{ url: "stale" }]), false);
});

test("queries carry only the most recently published state, not an unfinished result", () => {
  const sessions = new CommandPrefixSessions(), window = {};
  begin(sessions, window, "fixture.test").ticket.publish(old);
  const first = begin(sessions, window, "q", "Fixture").ticket;
  first.publish([{ ...old[0], fromPrevious: true }]);
  const next = begin(sessions, window, "qu", "Fixture").ticket;
  assert.equal(next.previous[0].fromPrevious, true);
  assert.equal(first.publish([{ url: "late" }]), false);
  next.publish([]);
  begin(sessions, window, "", "Fixture");
  assert.deepEqual(begin(sessions, window, "whole query", "Fixture").ticket.previous, []);
});

test("session end, history removal and disabled/private routes invalidate in-flight work", () => {
  for (const reset of [s => s.clear(), (s, w) => s.reset(w),
    (s, w) => s.begin(w, {}, { text: "private", enabled: false })]) {
    const sessions = new CommandPrefixSessions(), window = {};
    const ticket = begin(sessions, window, "fixture.test").ticket;
    ticket.publish(old);
    reset(sessions, window);
    assert.equal(ticket.current(), false);
    assert.equal(ticket.publish(old), false);
    assert.deepEqual(begin(sessions, window, "query", "Fixture").ticket.previous, []);
  }
});

test("engine changes and leaving scope clear predecessor state", () => {
  for (const engine of ["Other", null]) {
    const sessions = new CommandPrefixSessions(), window = {};
    begin(sessions, window, "query", "Fixture").ticket.publish(old);
    const next = begin(sessions, window, "query", engine).ticket;
    assert.deepEqual(next.previous, []);
  }
});

test("windows are independent; records cannot be mutated through snapshots", () => {
  const sessions = new CommandPrefixSessions(), a = {}, b = {};
  const input = old.map(row => ({ ...row }));
  begin(sessions, a, "fixture.test").ticket.publish(input);
  input[0].url = "changed";
  assert.deepEqual(begin(sessions, b, "query", "Fixture").ticket.previous, []);
  const next = begin(sessions, a, "query", "Fixture").ticket;
  assert.equal(next.previous[0].url, old[0].url);
  next.previous[0].url = "changed";
  assert.equal(begin(sessions, a, "next", "Fixture").ticket.previous[0].url, old[0].url);
});

test("cached context capture is idempotent but a changed query is new work", () => {
  const sessions = new CommandPrefixSessions(), window = {}, context = {};
  const a = begin(sessions, window, "fixture.test", null, context);
  a.ticket.publish(old);
  const b = begin(sessions, window, "fixture.test", null, context);
  assert.equal(b.fresh, false);
  assert.equal(b.ticket, a.ticket);
  const c = begin(sessions, window, "fixture.test/path", null, context);
  assert.equal(c.fresh, true);
  assert.notEqual(c.ticket, a.ticket);
  assert.equal(a.ticket.current(), false);
});
