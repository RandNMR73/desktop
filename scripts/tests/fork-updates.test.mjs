import test from "node:test";
import assert from "node:assert/strict";
import { ForkUpdateController } from "../../src/zen/common/sys/ZenForkUpdateController.sys.mjs";

function fixture({ quit = true, acknowledged = true, prepare = "ready" } = {}) {
  let record = { phase: "available" }, quitCalls = 0, detached = 0, canceled = [];
  const commands = [], timers = new Map();
  const adapter = {
    initialize: async () => true,
    read: async () => record,
    command: async (action, extra) => {
      commands.push([action, extra]);
      if (action === "prepare") record = { phase: prepare };
      if (action === "automatic") record = { ...record, automatic: extra[1] === "true" };
      return record;
    },
    detach: token => {
      detached++;
      if (acknowledged) record = { phase: "waiting", restartToken: token };
    },
    cancel: async token => { canceled.push(token); record = { phase: "ready" }; },
    quit: () => { quitCalls++; return quit; },
    token: () => "e".repeat(32),
    delay: async () => {}, now: () => Date.now(), report: () => {},
    setTimeout: (fn, delay) => { const id = Symbol(); timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  };
  const service = new ForkUpdateController(adapter);
  service.enabled = true;
  return { service, adapter, commands, timers, canceled,
    counts: () => ({ quitCalls, detached }), setRecord: value => { record = value; } };
}

test("restart prepares and waits for the exact worker acknowledgement before quitting", async () => {
  const f = fixture();
  f.service.publish({ phase: "available" });
  await f.service.restart();
  assert.deepEqual(f.commands, [["prepare", []]]);
  assert.deepEqual(f.counts(), { quitCalls: 1, detached: 1 });
  assert.equal(f.service.state.phase, "waiting");
});

test("missing worker acknowledgement never closes the browser", async () => {
  const f = fixture({ acknowledged: false });
  await f.service.restart();
  assert.equal(f.counts().quitCalls, 0);
  assert.equal(f.service.state.phase, "error");
  assert.deepEqual(f.canceled, ["e".repeat(32)]);
});

test("a different worker token cannot authorize closing the browser", async () => {
  const f = fixture();
  f.adapter.detach = () => f.setRecord({ phase: "waiting", restartToken: "f".repeat(32) });
  await f.service.restart();
  assert.equal(f.counts().quitCalls, 0);
});

test("a failed preparation never starts the installer or quits", async () => {
  const f = fixture({ prepare: "error" });
  await f.service.restart();
  assert.deepEqual(f.counts(), { quitCalls: 0, detached: 0 });
  assert.equal(f.service.state.phase, "error");
});

test("page/quit veto cancels the worker and restores the ready action", async () => {
  const f = fixture({ quit: false });
  await f.service.restart();
  assert.equal(f.service.state.phase, "ready");
  assert.deepEqual(f.canceled, ["e".repeat(32)]);
});

test("repeated clicks create one preparation and one restart", async () => {
  const f = fixture();
  await Promise.all([f.service.restart(), f.service.restart()]);
  assert.deepEqual(f.counts(), { quitCalls: 1, detached: 1 });
  assert.equal(f.commands.length, 1);
});

test("automatic preference is shared across windows and never quits", async () => {
  const f = fixture(), a = [], b = [];
  const offA = f.service.subscribe(state => a.push(state));
  const offB = f.service.subscribe(state => b.push(state));
  await f.service.initialize();
  await f.service.automatic(true);
  assert.equal(a.at(-1).automatic, true);
  assert.deepEqual(a.at(-1), b.at(-1));
  assert.deepEqual(f.counts(), { quitCalls: 0, detached: 0 });
  offA(); offB();
  assert.equal(f.timers.size, 0);
});

test("offline background checks leave an idle banner hidden", async () => {
  const f = fixture();
  f.adapter.command = async () => { throw new Error("offline"); };
  await f.service.command("check");
  assert.equal(f.service.state.phase, "idle");
});

test("automatic updates apply only after accepted quit and don't reopen the app", () => {
  const f = fixture(), invocations = [];
  f.adapter.detach = (...args) => invocations.push(args);
  for (const phase of ["idle", "available", "preparing", "error"]) {
    f.service.publish({ phase, automatic: true });
    f.service.onQuit();
  }
  assert.equal(invocations.length, 0);
  f.service.publish({ phase: "ready", automatic: false });
  f.service.onQuit();
  assert.equal(invocations.length, 0);
  f.service.publish({ phase: "ready", automatic: true });
  f.service.onQuit();
  assert.deepEqual(invocations, [["e".repeat(32), false]]);
  f.service.restarting = true;
  f.service.onQuit();
  assert.equal(invocations.length, 1);
});

test("idle status refresh doesn't repeatedly hit the release API", async () => {
  const f = fixture();
  f.setRecord({ phase: "idle", checkedAt: new Date().toISOString() });
  const off = f.service.subscribe(() => {});
  await f.service.initialize();
  const timer = [...f.timers.values()][0];
  await timer.fn();
  assert.equal(f.commands.length, 0);
  off();
});
