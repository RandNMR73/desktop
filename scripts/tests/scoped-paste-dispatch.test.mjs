/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Execute the native Query constructor/start/cancel, replacing only its dispatch
// gate with the actual product patch. Timers and provider services are explicit
// deterministic bindings; no scheduling condition is restated in this test.
const native = readFileSync(new URL("./fixtures/urlbar-query-start.mjs", import.meta.url), "utf8");
const patch = readFileSync(new URL("../../src/browser/components/urlbar/UrlbarProvidersManager-sys-mjs.patch", import.meta.url), "utf8");
const firstHunk = patch.match(/@@ [^\n]+\n([\s\S]*?)(?=\n@@ |$)/)[1];
const gate = firstHunk.split("\n").filter(line => line.startsWith("+")).map(line => line.slice(1)).join("\n") + "\n";
const gateStart = native.indexOf('      if (\n        provider.name === "ZenUrlbarProviderRecentTabs"');
const gateEnd = native.indexOf("      if (!this._sleepTimer)", gateStart);
assert.ok(gateStart > 0 && gateEnd > gateStart);
// RandNMR73/desktop#341 widened the native RecentTabs-only gate: an empty
// query (an explicitly opened command bar) has no typed input to debounce,
// whichever provider answers it.
assert.ok(gate.startsWith('      if (typeof this.context.searchString === "string" && !this.context.searchString.trim()) {\n'),
  "empty queries skip the typing delay for every provider");
const candidate = native.slice(0, gateStart) + gate + native.slice(gateEnd);
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function fixture({ context = {}, providers = [{}], baseline = false } = {}) {
  const stats = { starts: [], cancelled: [], published: [], timers: [], classifierCalls: [], errors: [] };
  const ctx = { searchString: "lattice", searchMode: { engineName: "Bing", isPreview: false },
    isPrivate: false, zenSiteSearchInputType: "insertFromPaste", sources: [],
    pendingHeuristicProviders: new Set(), deferUserSelectionProviders: new Set(), ...context };
  const logger = { debug() {}, info() {}, error: error => stats.errors.push(error) };
  const lazy = {
    logger, UrlbarPrefs: { get: name => { assert.equal(name, "delay"); return 50; } },
    UrlbarShared: { PROVIDER_TYPE: { HEURISTIC: 1, PROFILE: 2, NETWORK: 3 },
      // Exact native UrlbarShared.isPasteEvent contract, including yank and
      // quotation variants. The production patch calls this imported API.
      isPasteEvent(event) { stats.classifierCalls.push(event.inputType); return event.inputType &&
        (event.inputType.startsWith("insertFromPaste") || event.inputType === "insertFromYank"); } },
    SkippableTimer: class {
      constructor({ name, time }) { this.name = name; this.time = time; this.done = false; this.wait = deferred(); this.promise = this.wait.promise; stats.timers.push(this); }
      async fire() { this.done = true; this.wait.resolve(); await this.promise; }
      async cancel() { await this.fire(); }
    },
  };
  const runtime = vm.createContext({ lazy });
  vm.runInContext((baseline ? native : candidate).replace("export class Query", "globalThis.Query = class Query"), runtime);
  const actual = providers.map(options => ({
    name: "ZenUrlbarProviderSiteSearchHistory", type: 2, priority: 3, logger,
    async isActive() { return true; }, getPriority() { return this.priority; },
    async startQuery(query, add) { stats.starts.push(this.name); add(this, { text: query.searchString, provider: this.name }); },
    cancelQuery() { stats.cancelled.push(this.name); },
    // Native UrlbarProvider.tryMethod forwards with this receiver and catches
    // synchronous provider errors; async failures remain the caller's promise.
    tryMethod(name, ...args) { try { return this[name](...args); } catch (error) { stats.errors.push(error); return undefined; } },
    ...options,
  }));
  const query = new runtime.Query(ctx, {}, {}, actual);
  query.add = (_provider, result) => stats.published.push(result);
  return { query, context: ctx, providers: actual, stats,
    start: () => query.start(), fire: async () => { for (const timer of stats.timers) await timer.fire(); } };
}

test("native-classified scoped paste variants dispatch immediately without changing final provider values", async () => {
  for (const inputType of ["insertFromPaste", "insertFromPasteAsQuotation", "insertFromYank"]) {
    const current = fixture({ context: { zenSiteSearchInputType: inputType } });
    const old = fixture({ baseline: true, context: { zenSiteSearchInputType: inputType } });
    const currentDone = current.start(), oldDone = old.start(); await turn();
    assert.equal(current.stats.timers.length, 0, inputType);
    assert.deepEqual(current.stats.starts, ["ZenUrlbarProviderSiteSearchHistory"]);
    assert.deepEqual(current.stats.classifierCalls, [inputType]);
    assert.equal(old.stats.timers.length, 1); assert.equal(old.stats.timers[0].time, 50);
    assert.deepEqual(old.stats.starts, [], "baseline still waits before dispatch");
    await old.fire(); await Promise.all([currentDone, oldDone]);
    assert.deepEqual(current.stats.published, old.stats.published);
    assert.equal(current.providers[0].type, 2, "PROFILE classification is preserved");
    assert.deepEqual(current.stats.errors, []);
  }
});

test("ordinary typed input and invalid, private, preview or missing scope metadata retain native debounce", async () => {
  const contexts = [
    ...[undefined, null, "", 7, {}, "insertText", "deleteContentBackward", "insertFromDrop", "unknown"]
      .map(zenSiteSearchInputType => ({ zenSiteSearchInputType })),
    ...[undefined, true, null].map(isPrivate => ({ isPrivate })),
    ...[undefined, null, {}, { engineName: "" }, { engineName: " " }, { engineName: 7 },
      { engineName: "Bing", isPreview: true }, { engineName: "Bing", isPreview: "true" }].map(searchMode => ({ searchMode })),
    ...[undefined, null].map(searchString => ({ searchString })),
  ];
  for (const context of contexts) {
    const f = fixture({ context }); const done = f.start(); await turn();
    assert.deepEqual(f.stats.starts, [], JSON.stringify(context));
    assert.equal(f.stats.timers.length, 1); assert.equal(f.stats.timers[0].time, 50);
    await f.fire(); await done;
    assert.equal(f.stats.starts.length, 1); assert.deepEqual(f.stats.errors, []);
  }
});

test("explicit empty site-search recents skip debounce independently of input metadata", async () => {
  for (const searchString of ["", " \t "]) {
    for (const inputType of [undefined, null, "insertText", "deleteContentBackward"]) {
      const f = fixture({ context: { searchString, zenSiteSearchInputType: inputType } });
      const old = fixture({ baseline: true, context: { searchString, zenSiteSearchInputType: inputType } });
      const done = f.start(), oldDone = old.start(); await turn();
      assert.equal(f.stats.timers.length, 0); assert.equal(f.stats.starts.length, 1);
      assert.deepEqual(f.stats.classifierCalls, [], "empty recents do not require a paste classification");
      assert.equal(old.stats.timers.length, 1); assert.deepEqual(old.stats.starts, []);
      await old.fire(); await Promise.all([done, oldDone]);
      assert.deepEqual(f.stats.published, old.stats.published);
    }
  }
  // Since RandNMR73/desktop#341 an empty query skips the delay whatever its
  // scope: with nothing typed there is nothing to debounce. Scope only
  // decides what the providers return, not when they start.
  for (const context of [{ isPrivate: true }, { isPrivate: undefined }, { searchMode: null },
    { searchMode: { engineName: "Bing", isPreview: true } }, { searchMode: { engineName: " " } }]) {
    const f = fixture({ context: { searchString: "", ...context } });
    const done = f.start(); await turn();
    assert.equal(f.stats.starts.length, 1, JSON.stringify(context)); assert.equal(f.stats.timers.length, 0);
    await done; assert.deepEqual(f.stats.errors, []);
  }
});

test("the bypass applies only to the named PROFILE provider and respects active priorities", async () => {
  for (const provider of [{ name: "OtherProfileProvider" }, { type: 3 }]) {
    const f = fixture({ providers: [provider] }); const done = f.start(); await turn();
    assert.equal(f.stats.starts.length, 0); assert.equal(f.stats.timers.length, 1);
    await f.fire(); await done; assert.equal(f.stats.starts.length, 1);
  }
  const f = fixture({ providers: [{}, { name: "HigherPriority", priority: 4 }] });
  const done = f.start(); await turn();
  assert.equal(f.stats.starts.length, 0); assert.equal(f.stats.timers.length, 1);
  await f.fire(); await done;
  assert.deepEqual(f.stats.starts, ["HigherPriority"], "paste does not override provider selection");
  assert.deepEqual(f.stats.classifierCalls, []);
});

test("existing empty RecentTabs and heuristic dispatch behavior remains immediate", async () => {
  for (const config of [{ context: { searchString: "" }, providers: [{ name: "ZenUrlbarProviderRecentTabs" }] },
    { providers: [{ name: "Heuristic", type: 1 }] }]) {
    const f = fixture(config); await f.start();
    assert.equal(f.stats.starts.length, 1); assert.equal(f.stats.timers.length, 0);
    assert.equal(f.stats.classifierCalls.length, 0);
  }
});

test("cancellation while isActive is pending prevents immediate paste or recents dispatch", async () => {
  for (const searchString of ["lattice", ""]) {
    const active = deferred(), f = fixture({ context: { searchString }, providers: [{ isActive: () => active.promise }] });
    const done = f.start(); f.query.cancel(); active.resolve(true); await done;
    assert.equal(f.query.canceled, true); assert.equal(f.providers[0].queryInstance, null);
    assert.deepEqual(f.stats.starts, []); assert.deepEqual(f.stats.timers, []);
    assert.deepEqual(f.stats.cancelled, ["ZenUrlbarProviderSiteSearchHistory"]);
  }
});

test("ordinary typed cancellation still wakes the original timer without dispatching", async () => {
  const f = fixture({ context: { zenSiteSearchInputType: "insertText" } });
  const done = f.start(); await turn(); assert.equal(f.stats.timers.length, 1);
  f.query.cancel(); await done;
  assert.equal(f.stats.timers[0].done, true); assert.deepEqual(f.stats.starts, []);
  assert.deepEqual(f.stats.published, []);
});

test("paste or recents already dispatched before cancellation receives the native stale-query identity", async () => {
  for (const searchString of ["lattice", ""]) {
    const work = deferred(); let started = 0, observedStale = false;
    const f = fixture({ context: { searchString }, providers: [{ async startQuery(context, add) {
      started++; const instance = this.queryInstance; await work.promise;
      observedStale = instance !== this.queryInstance;
      if (!observedStale) add(this, { text: context.searchString });
    } }] });
    const done = f.start(); await turn(); assert.equal(started, 1); assert.equal(f.stats.timers.length, 0);
    f.query.cancel(); await done; assert.equal(f.providers[0].queryInstance, null);
    work.resolve(); await turn();
    assert.equal(observedStale, true); assert.deepEqual(f.stats.published, []);
    assert.deepEqual(f.stats.cancelled, ["ZenUrlbarProviderSiteSearchHistory"]);
  }
});

test("an empty query dispatches every provider at once; the native gate only exempted RecentTabs", async () => {
  const context = { searchString: "", zenSiteSearchInputType: undefined };
  const current = fixture({ context }), old = fixture({ baseline: true, context });
  const currentDone = current.start(), oldDone = old.start(); await turn();
  assert.equal(current.stats.timers.length, 0);
  assert.deepEqual(current.stats.starts, ["ZenUrlbarProviderSiteSearchHistory"]);
  assert.equal(old.stats.timers.length, 1, "native code waits for the typing delay");
  assert.deepEqual(old.stats.starts, []);
  await old.fire(); await Promise.all([currentDone, oldDone]);
  assert.deepEqual(current.stats.published, old.stats.published);
  assert.deepEqual(current.stats.errors, []);
});
