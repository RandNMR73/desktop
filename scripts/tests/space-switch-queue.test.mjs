import assert from "node:assert/strict";
import test from "node:test";
import { ZenSpaceSwitchQueue } from "../../src/zen/spaces/ZenSpaceSwitchQueue.mjs";

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test("same-tick requests never run concurrently and retain their own results", async () => {
  const queue = new ZenSpaceSwitchQueue(), entered = [], releases = [];
  let active = 0;
  const tasks = Array.from({ length: 5 }, (_, index) => queue.run(async () => {
    assert.equal(++active, 1);
    entered.push(index);
    const gate = deferred(); releases.push(gate.resolve);
    await gate.promise;
    active--;
    return index;
  }));
  for (let index = 0; index < tasks.length; index++) {
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(entered, Array.from({ length: index + 1 }, (_, i) => i));
    releases[index]();
    assert.equal(await tasks[index], index);
  }
  assert.equal(active, 0);
});

test("new input completes the active animation and marks only the last request current", async () => {
  const queue = new ZenSpaceSwitchQueue(), gate = deferred(), ready = deferred();
  let firstContext, completions = 0;
  const first = queue.run(async context => {
    firstContext = context;
    context.animations = [{ complete() { completions++; gate.resolve(); } }];
    ready.resolve();
    await gate.promise;
  });
  await ready.promise;
  assert.equal(firstContext.isLatest(), true);
  const second = queue.run(context => context.isLatest());
  const third = queue.run(context => context.isLatest());
  assert.equal(firstContext.isLatest(), false);
  assert.ok(completions >= 1);
  await first;
  assert.equal(await second, false);
  assert.equal(await third, true);
});

test("a rejected request does not poison the next switch", async () => {
  const queue = new ZenSpaceSwitchQueue();
  const failed = queue.run(() => { throw Error("fixture failure"); });
  const next = queue.run(() => "next Space");
  await assert.rejects(failed, /fixture failure/);
  assert.equal(await next, "next Space");
});

test("a failed animation completion cannot lose the pending request", async t => {
  const report = t.mock.method(console, "error", () => {});
  const queue = new ZenSpaceSwitchQueue(), ready = deferred(), gate = deferred();
  const first = queue.run(async context => {
    context.animations = [{ complete() { throw Error("disposed animation"); } }];
    ready.resolve(); await gate.promise;
  });
  await ready.promise;
  const next = queue.run(() => "requested Space");
  assert.equal(report.mock.callCount(), 1);
  gate.resolve(); await first;
  assert.equal(await next, "requested Space");
});

test("an animation completion that queues more input preserves reservation order", async () => {
  const queue = new ZenSpaceSwitchQueue(), gate = deferred(), ready = deferred();
  const order = [];
  let nested, queued = false;
  const first = queue.run(async context => {
    context.animations = [{ complete() {
      if (!queued) {
        queued = true;
        nested = queue.run(() => order.push("nested"));
      }
      gate.resolve();
    } }];
    ready.resolve(); await gate.promise;
  });
  await ready.promise;
  const second = queue.run(() => order.push("second"));
  await Promise.all([first, second, nested]);
  assert.deepEqual(order, ["second", "nested"]);
});
