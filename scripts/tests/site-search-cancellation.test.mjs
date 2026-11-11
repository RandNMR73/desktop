import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SiteSearchColors, siteSearchHistoryIcon, siteSearchHistoryPage } from "../../src/zen/urlbar/ZenUrlbarSiteSearch.mjs";

const row = values => ({ getResultByName: name => values[name] });
const page = row({ id: 1, url: "https://scope.test/", title: "Scope", last_visit_date: 20 });
const visit = row({ place_id: 1, visit_date: 20, id: 1 });
const engine = { getSubmission: () => ({ uri: { spec: "https://scope.test/?q=" } }) };

test("obsolete history work does not start a statement", async () => {
  assert.equal(await siteSearchHistoryPage({ executeCached() { assert.fail(); } },
    "scope.test", undefined, () => false), null);
});

test("a scope change cancels streamed history before matching more rows or looking up visits", async () => {
  let current = true, cancelled = false, calls = 0;
  const db = { async executeCached(sql, params, onRow) {
    assert.equal(++calls, 1);
    current = false;
    onRow({ getResultByName() { assert.fail("obsolete row should not be inspected"); } },
      () => { cancelled = true; });
  } };
  assert.equal(await siteSearchHistoryPage(db, "scope.test", undefined, () => current), null);
  assert.equal(cancelled, true);
});

test("cancellation after the page callback prevents the visit query", async () => {
  let current = true, calls = 0;
  const db = { async executeCached(sql, params, onRow) {
    assert.equal(++calls, 1);
    onRow(page, () => {});
    current = false;
  } };
  assert.equal(await siteSearchHistoryPage(db, "scope.test", undefined, () => current), null);
});

test("cancellation during visit lookup prevents another page query", async () => {
  let current = true, calls = 0;
  const db = { async executeCached(sql, params, onRow) {
    if (++calls === 1) { onRow(page, () => {}); return; }
    assert.equal(calls, 2);
    current = false;
    return [visit];
  } };
  assert.equal(await siteSearchHistoryPage(db, "scope.test", undefined, () => current), null);
});

test("leaving a scope before or during favicon lookup prevents the next stage", async () => {
  let current = false, calls = 0;
  const lookup = {
    current: () => current,
    findPage: async () => { calls++; current = false; return "https://scope.test/"; },
    pageIcon: () => assert.fail("obsolete page must not request its favicon"),
  };
  assert.equal(await siteSearchHistoryIcon(engine, lookup), null);
  assert.equal(calls, 0);
  current = true;
  assert.equal(await siteSearchHistoryIcon(engine, lookup), null);
  assert.equal(calls, 1);
  current = true;
  assert.equal(await siteSearchHistoryIcon(engine, {
    current: () => current, findPage: async () => "https://scope.test/",
    pageIcon: async () => { current = false; return "obsolete icon"; },
  }), null);
});

test("scope generations and window close revoke pending work, including A-B-A", async () => {
  const window = { closed: false, CSS: { supports: () => true } };
  const colors = new SiteSearchColors(window, { style: { removeProperty() {} } }, () => {});
  const tokens = [];
  const lookup = current => { tokens.push(current); return null; };
  await colors.update(lookup);
  assert.equal(tokens[0](), true);
  await colors.update(lookup);
  await colors.update(lookup);
  assert.deepEqual(tokens.map(current => current()), [false, false, true]);
  await colors.update(null);
  assert.equal(tokens[2](), false);
  await colors.update(lookup);
  window.closed = true;
  assert.equal(tokens[3](), false);
  assert.equal(await colors.update(() => assert.fail("closed window must not start work")), false);
});

test("SQLite history cancellation stops obsolete rows and preserves active visible-visit ordering", async () => {
  const database = new DatabaseSync(":memory:");
  let current = true, delivered = 0, cancelAfter = null;
  const db = { async executeCached(sql, params, onRow) {
    const statement = database.prepare(sql);
    if (!onRow) return statement.all(params).map(row);
    let cancelled = false;
    for (const value of statement.iterate(params)) {
      if (++delivered === cancelAfter) current = false;
      onRow(row(value), () => { cancelled = true; });
      if (cancelled) break;
    }
  } };
  try {
    database.exec(`
      CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_date INTEGER, hidden INTEGER);
      CREATE TABLE moz_historyvisits (id INTEGER PRIMARY KEY, place_id INTEGER, visit_date INTEGER, visit_type INTEGER, from_visit INTEGER);
      WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<5000)
        INSERT INTO moz_places SELECT n,'https://unrelated.invalid/'||n,'Example 語',n,0 FROM numbers;
    `);
    assert.equal(await siteSearchHistoryPage(db, "scope.test"), null);
    assert.equal(delivered, 5000);
    delivered = 0;
    cancelAfter = 5;
    assert.equal(await siteSearchHistoryPage(db, "scope.test", undefined, () => current), null);
    assert.equal(delivered, 5);
    current = true;
    cancelAfter = null;
    database.exec(`
      INSERT INTO moz_places VALUES
        (5001,'https://scope.test/recent','Scope',6000,0),
        (5002,'https://scope.test/redirect-source','Scope',7000,0),
        (5003,'https://scope.test/hidden','Scope',8000,1);
      INSERT INTO moz_historyvisits VALUES
        (1,5001,6000,1,0), (2,5002,7000,1,0),
        (3,1,7001,5,2), (4,5003,8000,1,0);
    `);
    assert.equal(await siteSearchHistoryPage(db, "scope.test", undefined, () => current),
      "https://scope.test/recent");
  } finally {
    database.close();
  }
});
