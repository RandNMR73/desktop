import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixtures = path.join(root, "scripts/tests/fixtures/pgo");
const defaults = JSON.parse(readFileSync(path.join(fixtures, "speedometer-defaults.json")));
const directory = mkdtempSync(path.join(tmpdir(), "zen-pgo-gate-"));
let source;
try {
  mkdirSync(path.join(directory, "build/pgo"), { recursive: true });
  copyFileSync(path.join(fixtures, "index.html"), path.join(directory, "build/pgo/index.html"));
  execFileSync("git", ["apply", "--check", path.join(root, "src/build/pgo/index-html.patch")], { cwd: directory });
  execFileSync("git", ["apply", path.join(root, "src/build/pgo/index-html.patch")], { cwd: directory });
  source = readFileSync(path.join(directory, "build/pgo/index.html"), "utf8").replace(/^<script>\s*|\s*<\/script>\s*$/g, "");
} finally { rmSync(directory, { recursive: true, force: true }); }

function benchmark() {
  const Suites = structuredClone(defaults.suites), listeners = new Map();
  const enabled = Suites.filter(suite => !suite.disabled);
  const tests = Object.fromEntries(enabled.map(suite => [suite.name, {
    total: suite.tests.length * 2,
    tests: Object.fromEntries(suite.tests.map(step => [step.name, { total: 2, tests: { Sync: 1, Async: 1 } }])),
  }]));
  return {
    Suites, closed: false, location: { hash: "#summary" },
    document: { getElementById: () => ({ classList: { contains: name => name === "valid" } }) },
    benchmarkClient: { suitesCount: 20, stepCount: 580, _isRunning: false, _hasResults: true,
      _finishedTestCount: 579, _measuredValuesList: Array.from({ length: defaults.iterationCount }, () => ({ score: 1, tests: structuredClone(tests) })) },
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
    emit: (name, event) => listeners.get(name)?.(event),
    close() { this.closed = true; },
  };
}

function page({ popup = benchmark(), onTick = () => {}, rejectReport = false, extended = false } = {}) {
  let now = 0, quits = 0;
  const opened = [], reports = [], errors = [];
  const context = vm.createContext({
    URLSearchParams, Date: { now: () => now },
    location: { search: `?extendedCorpus=${extended}&trainingToken=owned-run` },
    document: { write() {} }, console: { error: (...args) => errors.push(args) },
    AbortSignal: { timeout: milliseconds => { assert.equal(milliseconds, 10000); return {}; } },
    fetch: async (url, options) => {
      assert.equal(url, "/pgo-training-result"); reports.push(JSON.parse(options.body));
      if (rejectReport) throw new Error("owned report failure");
      return { ok: true };
    },
    Quitter: { quit() { quits++; } },
    window: {
      open(url) { opened.push(url); return url.includes("Speedometer3") ? popup : { close() {} }; },
      setTimeout(callback, delay) { now += delay; queueMicrotask(() => { onTick(now, popup); callback(); }); },
    },
  });
  vm.runInContext(source + "\nglobalThis.Item = Item;", context);
  return { context, popup, opened, reports, errors, quits: () => quits, now: () => now };
}

test("PGO completion accepts the 20 default suites and all result records despite the lagging progress counter", () => {
  const f = page();
  assert.equal(defaults.suites.length, 32);
  assert.equal(defaults.iterationCount, 10);
  for (const count of [579, 289]) {
    f.popup.benchmarkClient._finishedTestCount = count;
    const result = f.context.speedometerCompletion(f.popup);
    assert.equal(Object.keys(result.expectedSuites).length, 20);
    assert.equal(result.iterations.length, 10);
    assert.equal(result.stepCount, 580);
  }
});

test("PGO completion rejects missing iterations, suites, steps, invalid values and changed configuration", () => {
  const cases = [
    w => w.benchmarkClient._measuredValuesList.pop(),
    w => delete w.benchmarkClient._measuredValuesList[0].tests[w.Suites[0].name],
    w => delete w.benchmarkClient._measuredValuesList[0].tests[w.Suites[0].name].tests.Adding100Items,
    w => { w.benchmarkClient._measuredValuesList[0].tests[w.Suites[0].name].tests.Adding100Items.tests.Sync = NaN; },
    w => { w.benchmarkClient._measuredValuesList[0].score = 0; },
    w => { w.Suites.find(suite => suite.disabled).disabled = false; },
    w => { w.benchmarkClient.stepCount = 290; },
    w => { w.benchmarkClient._isRunning = true; },
    w => { w.document.getElementById = () => ({ classList: { contains: () => false } }); },
  ];
  for (const mutate of cases) {
    const f = page(); mutate(f.popup);
    assert.throws(() => f.context.speedometerCompletion(f.popup), /Speedometer/);
  }
});

test("PGO success reports once after the unchanged corpus order, including optional extended training", async () => {
  for (const extended of [false, true]) {
    const f = page({ extended });
    const expected = Array.from(f.context.items, item => item.url);
    const speedometer = expected.findIndex(url => url.includes("Speedometer3"));
    assert.match(expected[speedometer - 1], /Speedometer\/index/);
    assert.match(expected[speedometer + 1], /webaudio/);
    assert.equal(f.context.items[speedometer].timeout, 20 * 60 * 1000);
    await f.context.window.onload();
    assert.deepEqual(f.opened, expected);
    assert.equal(f.reports.length, 1);
    assert.equal(f.reports[0].status, "complete");
    assert.equal(f.reports[0].token, "owned-run");
    assert.equal(f.quits(), 1);
  }
});

test("PGO timeout and thrown polling failures report failure, close the child and stop subsequent training", async () => {
  for (const mode of ["timeout", "poll-error"]) {
    const f = page(); f.popup.location.hash = "#running";
    f.context.items = [new f.context.Item("Speedometer3", 3000, mode === "timeout"
      ? f.context.speedometerCompletion : () => { throw new Error("owned polling error"); }),
    new f.context.Item("must-not-run")];
    await f.context.window.onload();
    assert.deepEqual(f.opened, ["Speedometer3"]);
    assert.equal(f.reports[0].status, "failed");
    assert.match(f.reports[0].error, mode === "timeout" ? /timed out/ : /polling error/);
    assert.equal(f.popup.closed, true);
    assert.equal(f.quits(), 1);
    assert.ok(f.now() <= 3000);
  }
});

test("PGO captures page errors and rejected promises while waiting for benchmark results", async () => {
  for (const event of ["error", "unhandledrejection"]) {
    const f = page({ onTick: (time, popup) => {
      if (time === 2000) popup.emit(event, event === "error"
        ? { message: "owned page error" } : { reason: new Error("owned rejection") });
    } });
    f.popup.location.hash = "#running";
    f.context.items = [new f.context.Item("Speedometer3", 3000, f.context.speedometerCompletion)];
    await f.context.window.onload();
    assert.equal(f.reports[0].status, "failed");
    assert.match(f.reports[0].error, event === "error" ? /owned page error/ : /owned rejection/);
    assert.equal(f.popup.closed, true);
    assert.equal(f.quits(), 1);
  }
});

test("PGO report failure still quits so the server can reject the missing receipt", async () => {
  const f = page({ rejectReport: true });
  f.context.items = [new f.context.Item("Speedometer3", 3000, f.context.speedometerCompletion)];
  await f.context.window.onload();
  assert.equal(f.errors.length, 1);
  assert.equal(f.quits(), 1);
});

test("PGO rejects a blocked or prematurely closed benchmark window", async () => {
  for (const blocked of [true, false]) {
    const f = page(blocked ? { popup: null } : { onTick: (_time, popup) => { popup.closed = true; } });
    f.context.items = [new f.context.Item("Speedometer3", 3000, f.context.speedometerCompletion)];
    await f.context.window.onload();
    assert.equal(f.reports[0].status, "failed");
    assert.match(f.reports[0].error, blocked ? /did not open/ : /closed before completion/);
    assert.equal(f.quits(), 1);
  }
});

test("profileserver refuses merging missing, failed and incomplete training receipts", () => {
  execFileSync("python3", [path.join(root, "scripts/tests/pgo-training-gate.test.py")], { cwd: root });
});
