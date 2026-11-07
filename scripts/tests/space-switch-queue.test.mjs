import assert from "node:assert/strict";
import test from "node:test";
import { ZenSpaceSwitchQueue } from "../../src/zen/spaces/ZenSpaceSwitchQueue.mjs";

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test("gesture takeover freezes paint and invalidates queued old selections", async () => {
  const queue = new ZenSpaceSwitchQueue(), ready = deferred(), gate = deferred();
  let firstContext, painted = 0;
  const first = queue.run(async context => {
    firstContext = context;
    context.animations = [{ complete() {
      if (context.isLatest()) painted++;
      gate.resolve();
    } }];
    ready.resolve(); await gate.promise;
  }, "A");
  await ready.promise;
  const queued = queue.run(context => context.wasInterrupted(), "B");
  const gesture = queue.takePresentation();
  assert.equal(firstContext.isLatest(), false);
  assert.equal(firstContext.wasInterrupted(), true);
  assert.equal(gesture.isLatest(), true);
  assert.equal(painted, 0);
  await first;
  assert.equal(await queued, true);
  const newSelection = queue.run(context => context.wasInterrupted(), "B");
  assert.notEqual(newSelection, queued);
  assert.equal(gesture.isLatest(), false);
  assert.equal(await newSelection, false);
});

test("reentrant selection during takeover owns presentation ahead of the gesture", async () => {
  const queue = new ZenSpaceSwitchQueue(), ready = deferred(), gate = deferred();
  let nested, once = false;
  const first = queue.run(async context => {
    context.animations = [{ complete() {
      if (!once) { once = true; nested = queue.run(() => "newer"); }
      gate.resolve();
    } }];
    ready.resolve(); await gate.promise;
  });
  await ready.promise;
  const gesture = queue.takePresentation();
  assert.equal(gesture.isLatest(), false);
  await first;
  assert.equal(await nested, "newer");
});

test("repeating a pending selection shares the result without reserving another switch", async () => {
  const queue = new ZenSpaceSwitchQueue();
  let calls = 0;
  const first = queue.run(() => { calls++; return "Space A"; }, "A");
  const repeated = queue.run(() => { throw Error("duplicate ran"); }, "A");
  assert.equal(repeated, first);
  assert.equal(await repeated, "Space A");
  assert.equal(calls, 1);
  assert.equal(await queue.run(() => "fresh A", "A"), "fresh A");
});

test("repeating an animating selection never completes or invalidates its animation", async () => {
  const queue = new ZenSpaceSwitchQueue(), ready = deferred(), gate = deferred();
  let context, completions = 0;
  const first = queue.run(async current => {
    context = current;
    current.animations = [{ complete() { completions++; } }];
    ready.resolve(); await gate.promise;
    return "arrived";
  }, "A");
  await ready.promise;
  const repeated = queue.run(() => { throw Error("duplicate ran"); }, "A");
  assert.equal(context.isLatest(), true);
  assert.equal(completions, 0);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, repeated]), ["arrived", "arrived"]);
});

test("an intervening selection prevents sharing an older matching destination", async () => {
  const queue = new ZenSpaceSwitchQueue(), seen = [];
  const first = queue.run(context => { seen.push(["A", context.isLatest()]); }, "A");
  const second = queue.run(context => { seen.push(["B", context.isLatest()]); }, "B");
  const third = queue.run(context => { seen.push(["A", context.isLatest()]); }, "A");
  assert.notEqual(first, third);
  await Promise.all([first, second, third]);
  assert.deepEqual(seen, [["A", false], ["B", false], ["A", true]]);
});

test("unkeyed tab, swipe or forced requests remain separate from plain selections", async () => {
  const queue = new ZenSpaceSwitchQueue(), seen = [];
  const tasks = [
    queue.run(() => seen.push("plain"), "A"),
    queue.run(() => seen.push("explicit tab")),
    queue.run(() => seen.push("plain after tab"), "A"),
  ];
  await Promise.all(tasks);
  assert.deepEqual(seen, ["plain", "explicit tab", "plain after tab"]);
});

test("a shared rejection does not suppress a later request for the same Space", async () => {
  const queue = new ZenSpaceSwitchQueue();
  const first = queue.run(() => { throw Error("fixture failure"); }, "A");
  const repeated = queue.run(() => { throw Error("duplicate ran"); }, "A");
  const results = await Promise.allSettled([first, repeated]);
  assert.ok(results.every(result => result.status === "rejected" && result.reason.message === "fixture failure"));
  assert.equal(await queue.run(() => "retry", "A"), "retry");
});

test("reentrant duplicate input shares the destination reserved before completion", async () => {
  const queue = new ZenSpaceSwitchQueue(), ready = deferred(), gate = deferred();
  let nested;
  const first = queue.run(async context => {
    context.animations = [{ complete() {
      nested = queue.run(() => { throw Error("duplicate ran"); }, "B");
      gate.resolve();
    } }];
    ready.resolve(); await gate.promise;
  }, "A");
  await ready.promise;
  const second = queue.run(() => "B", "B");
  assert.equal(nested, second);
  await first;
  assert.equal(await nested, "B");
});

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
