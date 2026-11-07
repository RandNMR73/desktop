/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
const done = arguments[arguments.length - 1];
(async () => {
  const [module, benchmark] = arguments;
  if (!PathUtils.filename(Services.dirsvc.get("ProfD", Ci.nsIFile).path)
    .startsWith("zen-prefix-reader-")) throw Error("Disposable profile required");
  const { readCommandPrefixHistory: candidate } = ChromeUtils.importESModule(module);
  const { commandPrefixHistory: reference } = ChromeUtils.importESModule(
    module.replace("ZenCommandPrefixHistoryReader", "ZenCommandPrefixHistory"));
  const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const db = await PlacesUtils.promiseDBConnection();
  const write = (...args) => PlacesUtils.withConnectionWrapper("zen-prefix-fixture", connection => connection.execute(...args));
  const checks = [], timings = [], plans = [];
  const check = (name, pass, details) => {
    checks.push({ name, pass });
    if (!pass) throw Error(`${name}: ${JSON.stringify(details)}`);
  };
  const canonicalize = text => {
    try {
      const uri = Services.uriFixup.getFixupURIInfo(text, Ci.nsIURIFixup.FIXUP_FLAG_NONE).fixedURI;
      return uri ? { url: uri.spec, hasCredentials: !!uri.userPass } : null;
    } catch { return null; }
  };
  check("Firefox URL fixup is available", canonicalize("fixture.test")?.url === "http://fixture.test/");
  const now = Date.now(), day = 86400000;
  let serial = 0;
  async function page(url, typedCount, visitCount = typedCount, age = 0) {
    const visits = Array.from({ length: visitCount }, (_, i) => ({
      date: new Date(now - age * day - 100000 + ++serial),
      transition: i < typedCount ? PlacesUtils.history.TRANSITIONS.TYPED : PlacesUtils.history.TRANSITIONS.LINK,
    }));
    await PlacesUtils.history.insert({ url, title: "Synthetic prefix fixture", visits });
  }
  const host = "https://www.fixture.test/";
  await page(host, 8, 8, 4);
  await page(host + "a", 30, 62, 20);
  await page(host + "b", 13, 26, 46);
  await page(host + "c", 11, 23, 31);
  await page(host + "path/", 2, 10);
  await page(host + "path/child", 20, 30);
  await page(host + "old", 0, 1, 91);
  await page(host + "popular", 0, 2, 100);
  await page(host + "hidden", 40);
  await page(host + "future", 40);
  await write("UPDATE moz_places SET hidden = 1 WHERE url = :url", { url: host + "hidden" });
  await write("UPDATE moz_places SET last_visit_date = :date WHERE url = :url",
    { date: (now + day) * 1000, url: host + "future" });
  for (const url of ["http://fixture.test/", "https://fixture.test/", "ftp://www.fixture.test/",
    "http://http.test/", "https://elsewhere.test/", "https://www.fixture.test:8443/port",
    "https://www.fixture-alpha.test/", "https://www.fixture-beta.test/deep",
    "https://xn--bcher-kva.test/", "https://unicode.test/%E2%84%AA", "https://www.fixture.test/a?x=1#hash"]) {
    await page(url, 1, 2);
  }
  for (const url of ["file:///tmp/zen-prefix-fixture/", "file:///tmp/zen-prefix-fixture/child"])
    await page(url, 2, 6);
  // Many more pages than any prefix/provider budget, including weak rows that
  // must consume the database cap BEFORE the later exclusion predicate.
  for (let i = 0; i < 40; i++) await page(`https://pool.test/item-${i}`, 1 + i % 6, 8 + i % 4);
  await page("https://lookup.test/prefix/", 2, 30);
  await page("https://lookup.test/prefix/target", 60, 90);
  for (let i = 0; i < 10; i++) await page(`https://lookup.test/prefix/z-${i}`, 10, 35);
  await page("https://lookup.test/", 0, 1);
  const fields = ["id", "url", "typedCount", "visitCount", "lastVisit"];
  const allSQL = `SELECT p.id, p.url, p.visit_count AS visitCount,
    p.last_visit_date / 1000.0 AS lastVisit,
    (SELECT COUNT(*) FROM moz_historyvisits v WHERE v.place_id = p.id
      AND v.visit_type = 2 AND v.visit_date <= :end) AS typedCount
    FROM moz_places p WHERE p.hidden = 0 AND p.last_visit_date > 0 AND p.last_visit_date <= :end`;
  const allRows = async () => (await db.execute(allSQL, { end: now * 1000 }))
    .map(value => Object.fromEntries(fields.map(key => [key, value.getResultByName(key)])));
  const plain = batch => Object.fromEntries(Object.entries(batch).map(([key, rows]) =>
    [key, rows.map(({ id, ...row }) => row)]));
  async function compare(text, options = {}, redirects = new Map()) {
    const args = { canonicalize, now, allowWhatYouTyped: true, ...options };
    const expected = plain(reference(await allRows(), { ...args, text, redirects }));
    const actual = plain(await candidate(db, text, args));
    check(`exhaustive equality: ${text}/${JSON.stringify(options)}`,
      JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
    return actual;
  }
  for (const text of ["fixture", "fixture.test", "www.fixture.test", "fixture.test/path",
    "fixture.test/path/chi", "https://www.fixture.test/a", "https://", "http", "ftp://www.fi",
    "fixture.test:8443/", "pool.test", "xn--bcher", "unicode.test/%E2", "missing.test",
    "youtube.com hot", "user@www.fixture.test", "", "fixture.test/a?x=1#h",
    "file:///tmp/zen-prefix-fixture/ch", "lookup.test", "lookup.test/pref"]) {
    for (const options of [{}, { allowWhatYouTyped: false }, { preventInline: true }, { limit: 1 }, { limit: 7 }]) {
      await compare(text, options);
    }
  }
  await compare("pool.test", { exclude: url => url.includes("item-") });
  const shorter = await compare("lookup.test/pref");
  check("shorter lookup finds a qualifying parent outside the capped prefix pool",
    shorter.initial[0].url === "https://lookup.test/prefix/");
  const initial = await compare("fixture.test");
  check("typed visit count is not Places' boolean typed flag", initial.final[1].url === host + "a");
  // A newest source visit, two redirect hops, then an ordinary link. The link
  // is not a redirect and must not be removed from prefix results.
  const source = "https://redirect.test/source", target = "https://redirect.test/target";
  const middle = "https://redirect.test/middle", ordinary = "https://redirect.test/ordinary";
  for (const [url, count] of [[source, 10], [target, 8], [middle, 6], [ordinary, 4]]) await page(url, count);
  async function lastVisit(url) {
    return (await db.execute(`SELECT v.id FROM moz_historyvisits v JOIN moz_places p ON p.id = v.place_id
      WHERE p.url = :url ORDER BY v.visit_date DESC, v.id DESC LIMIT 1`, { url }))[0].getResultByName("id");
  }
  await write("UPDATE moz_historyvisits SET from_visit = :from, visit_type = 5 WHERE id = :to",
    { from: await lastVisit(source), to: await lastVisit(middle) });
  await write("UPDATE moz_historyvisits SET from_visit = :from, visit_type = 6 WHERE id = :to",
    { from: await lastVisit(middle), to: await lastVisit(target) });
  await write("UPDATE moz_historyvisits SET from_visit = :from, visit_type = 1 WHERE id = :to",
    { from: await lastVisit(target), to: await lastVisit(ordinary) });
  const redirects = new Map([[source, [middle, target]], [middle, [target]]]);
  const redirected = await compare("redirect.test", {}, redirects);
  check("redirect deduplication keeps the distinct ordinary navigation",
    redirected.final.some(row => row.url === ordinary) && !redirected.final.some(row => row.url === target));
  await page(source, 1);
  redirects.delete(source);
  const revisited = await compare("redirect.test", {}, redirects);
  check("a later direct visit does not retain an older redirect chain", revisited.final.some(row => row.url === target));
  // A corrupt loop cannot make an unbounded recursive query.
  await write("UPDATE moz_historyvisits SET from_visit = :from, visit_type = 5 WHERE id = :to",
    { from: await lastVisit(target), to: await lastVisit(middle) });
  await compare("redirect.test", {}, new Map([[middle, [target]], [target, [middle]]]));
  await PlacesUtils.history.remove(host + "a");
  const deleted = await compare("fixture.test");
  check("deleting history removes it immediately", !deleted.final.some(row => row.url === host + "a"));
  let calls = 0;
  const cancelled = await candidate({ async executeCached(...args) { calls++; return db.executeCached(...args); } },
    "fixture.test", { canonicalize, now, current: () => calls < 2 });
  check("cancellation stops reads and returns no partial batch", calls === 2 &&
    cancelled.initial.length === 0 && cancelled.final.length === 0);
  const observed = { async executeCached(sql, params, callback) {
    if (sql.startsWith("SELECT * FROM")) {
      const rows = await db.execute("EXPLAIN QUERY PLAN " + sql, params);
      plans.push(rows.map(row => row.getResultByName("detail")));
    }
    return db.executeCached(sql, params, callback);
  } };
  await candidate(observed, "fixture.test", { canonicalize, now });
  check("all prefix reads use the origin/page index without scanning pages",
    plans.length === 7 && plans.every(plan => plan.some(line => /SEARCH p USING INDEX moz_places_originidindex/.test(line)) &&
      !plan.some(line => /SCAN p\b/.test(line))), plans);
  check("ordinary host prefixes use the host index", plans.slice(0, 6).every(plan =>
    plan.some(line => /SEARCH o USING COVERING INDEX/.test(line))), plans);
  if (benchmark) {
    // Separate unrelated origins exercise indexed narrowing without adding a
    // browser benchmark claim: these timings include only history reading.
    await PlacesUtils.history.insertMany(Array.from({ length: 2000 }, (_, i) => ({
      url: `https://background-${i}.test/page`, visits: [{ date: new Date(now - 10000), transition: 1 }],
    })));
    const expected = plain(reference(await allRows(), { canonicalize, now,
      text: "fixture.test", allowWhatYouTyped: true }));
    for (let i = 0; i < 7; i++) {
      const start = performance.now();
      const actual = plain(await candidate(db, "fixture.test", { canonicalize, now, allowWhatYouTyped: true }));
      timings.push({ milliseconds: performance.now() - start, includesExhaustiveReference: false });
      check(`larger database equality ${i}`, JSON.stringify(actual) === JSON.stringify(expected));
    }
  }
  done({ pass: true, checks, plans, timings });
})().catch(error => done({ pass: false, error: String(error), stack: error.stack }));
