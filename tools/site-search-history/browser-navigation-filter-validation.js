/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
const done = arguments[arguments.length - 1];
(async () => {
  const [candidateModule = "resource:///modules/zen/urlbar/ZenSiteSearchHistory.sys.mjs", benchmark = false] = arguments;
  const profile = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
  if (!PathUtils.filename(profile).startsWith("zen-navigation-filter-")) throw Error("Disposable profile required");
  const { siteSearchNavigationHistory: candidate } = ChromeUtils.importESModule(candidateModule);
  const { Sqlite } = ChromeUtils.importESModule("resource://gre/modules/Sqlite.sys.mjs");
  const path = PathUtils.join(profile, "navigation-filter.sqlite");
  await IOUtils.remove(path, { ignoreAbsent: true });
  const db = await Sqlite.openConnection({ path });
  const checks = [], timings = [];
  const check = (name, pass, actual) => {
    checks.push({ name, pass, ...(actual === undefined ? {} : { actual }) });
    if (!pass) throw Error(name);
  };
  // Independent oracle: read ALL eligible pages before the existing full
  // matcher, including every page in each 500-record cursor-variant pool.
  const allPages = `SELECT p.id, p.url, p.title, p.visit_count AS visitCount,
    p.last_visit_date / 1000.0 AS lastVisit,
    (SELECT COUNT(*) FROM moz_historyvisits v WHERE v.place_id=p.id AND v.visit_type=2) AS typedCount,
    EXISTS (SELECT 1 FROM moz_bookmarks b WHERE b.fk=p.id AND b.type=1) AS bookmarked
    FROM moz_places p WHERE p.hidden=0 AND p.last_visit_date>0 AND p.last_visit_date<=:end
    AND EXISTS (SELECT 1 FROM moz_historyvisits v WHERE v.place_id=p.id AND v.visit_type IN (1,2,3,5,6,9))`;
  const reader = (kind, anchor = "", observe = () => {}) => ({ async executeCached(sql, params, callback) {
    if (sql.includes("FROM moz_places p WHERE")) {
      if (kind === "all") { sql = allPages; params = { end: params.end }; }
      if (kind === "old") {
        sql = allPages + " AND (p.url LIKE :needle OR p.title LIKE :needle OR instr(p.url, '%') > 0)";
        params = { end: params.end, needle: `%${anchor}%` };
      }
      const start = performance.now();
      let count = 0;
      try { return await db.executeCached(sql, params, (...args) => { count++; callback(...args); }); }
      finally { observe({ milliseconds: performance.now() - start, rows: count }); }
    }
    return db.executeCached(sql, params, callback);
  } });
  const now = Date.UTC(2026, 10, 5), end = now * 1000;
  const options = { now, locale: "en", displayHost: host => Services.io.newURI(`https://${host}`).displayHost,
    exclude: url => url.startsWith("https://default.test/search?") };
  let visitID = 0;
  async function page(id, url, title, { visits = 2, type = 1, hidden = 0, future = false, bookmark = false } = {}) {
    await db.execute("INSERT INTO moz_places VALUES (:id,:url,:title,:count,:date,:hidden)",
      { id, url, title, count: visits, date: end + (future ? 1000 : -id * 1000), hidden });
    for (let n = 0; n < visits; n++) await db.execute("INSERT INTO moz_historyvisits VALUES (:id,:place,:date,:type)",
      { id: ++visitID, place: id, date: end - (id + n) * 1000, type });
    if (bookmark) await db.execute("INSERT INTO moz_bookmarks VALUES (:id,1)", { id });
  }
  try {
    for (const sql of [
      "CREATE TABLE moz_places(id INTEGER PRIMARY KEY,url TEXT,title TEXT,visit_count INTEGER,last_visit_date INTEGER,hidden INTEGER)",
      "CREATE TABLE moz_historyvisits(id INTEGER PRIMARY KEY,place_id INTEGER,visit_date INTEGER,visit_type INTEGER)",
      "CREATE TABLE moz_bookmarks(fk INTEGER,type INTEGER)",
      "CREATE INDEX visits_place ON moz_historyvisits(place_id,visit_date)",
      "CREATE INDEX bookmarks_place ON moz_bookmarks(fk,type)",
    ]) await db.execute(sql);
    await db.execute("BEGIN");
    {
      await page(1, "https://elsewhere.test/one", "KELVIN.TEST alpha");
      await page(2, "https://elsewhere.test/two", "you tube.com hot");
      await page(3, "https://elsewhere.test/%79outube.com/hot", "escaped keyword");
      await page(4, "https://xn--bcher-kva.test/alpha", "IDN");
      await page(5, "https://elsewhere.test/five", "İSTANBUL.TEST alpha");
      await page(6, "https://elsewhere.test/six", "youtube.com hot", { hidden: 1 });
      await page(7, "https://elsewhere.test/seven", "youtube.com hot", { type: 4 });
      await page(8, "https://elsewhere.test/eight", "youtube.com hot", { future: true });
      await page(9, "https://default.test/search?q=youtube.com+hot", "youtube.com hot");
      await page(10, "https://elsewhere.test/ten", "日本語.test 検索");
      await page(11, "https://elsewhere.test/eleven", "youtube.com 3 blue brown");
      await page(12, "https://elsewhere.test/twelve", null);
      // Pool overflow and multiple hosts test selection BEFORE host specificity,
      // raw-term checks, seven-result limiting and descending relevance ties.
      for (let id = 20; id < 580; id++) await page(id,
        `https://host${id % 9}.test/${id}`, `youtube.com hot ${id}`,
        { visits: 1 + id % 4, type: id % 3 ? 1 : 2, bookmark: id % 7 === 0 });
      await page(600, "https://one.test/alpha", "alpha beta gamma");
      await page(601, "https://two.test/alpha", "alpha x beta gamma");
    }
    await db.execute("COMMIT");
    for (const [keyword, query] of [
      ["kelvin.test", "alpha"], ["youtube.com", "hot"], ["youtube.com", "3blue"],
      ["youtube.com", "3_blue"], ["youtube.com", "%68ot"], ["youtube.com", "hot longer query"],
      ["bücher.test", "alpha"], ["istanbul.test", "alpha"], ["日本語.test", "検索"],
      ["alpha", "beta gamma"], ["missing.test", "missing"], ["..", "!!!"],
      ["youtube.com", "hot " + "word ".repeat(80)],
    ]) for (const locale of ["en", "tr", "ja"]) {
      const args = { ...options, locale };
      const expected = await candidate(reader("all"), keyword, query, args);
      const actual = await candidate(db, keyword, query, args);
      check(`complete result equality: ${keyword}/${query.slice(0, 30)}/${locale}`,
        JSON.stringify(actual) === JSON.stringify(expected));
    }
    for (const [keyword, query, anchor, id] of [
      ["kelvin.test", "alpha", "kelvin", 1],
      ["youtube.com", "hot", "youtube", 2],
    ]) {
      // Isolate the known dropped record so a full seven-result list cannot
      // conceal eligibility differences behind its final result limit.
      const isolate = { ...options, exclude: url => !url.endsWith(id === 1 ? "/one" : "/two") };
      const expected = await candidate(reader("all"), keyword, query, isolate);
      const old = await candidate(reader("old", anchor), keyword, query, isolate);
      const actual = await candidate(db, keyword, query, isolate);
      check(`full matcher admits record ${id}`, expected.some(row => row.id === id));
      check(`old database filter drops record ${id}`, old.length === 0);
      check(`new database filter retains record ${id}`, JSON.stringify(actual) === JSON.stringify(expected));
    }
    check("cancelled query returns no rows", !(await candidate(db, "youtube.com", "hot", { ...options, current: () => false })).length);
    await db.execute("DELETE FROM moz_historyvisits WHERE place_id=1");
    check("deleted history immediately disappears", !(await candidate(db, "kelvin.test", "alpha", options)).length);
    if (benchmark) {
      await db.execute("DELETE FROM moz_bookmarks");
      await db.execute("DELETE FROM moz_historyvisits");
      await db.execute("DELETE FROM moz_places");
      await db.execute(`WITH RECURSIVE n(id) AS (VALUES(1) UNION ALL SELECT id+1 FROM n WHERE id<20000)
        INSERT INTO moz_places SELECT id,'https://youtube.com/watch?v=video'||id,
        CASE WHEN id%1000=0 THEN 'youtube.com lattice compiler' ELSE 'youtube.com unrelated video '||id END,
        5,:end-id*1000,0 FROM n`, { end });
      await db.execute(`INSERT INTO moz_historyvisits
        SELECT (p.id-1)*5+n,p.id,p.last_visit_date-n*1000,CASE WHEN n=1 THEN 2 ELSE 1 END
        FROM moz_places p CROSS JOIN (SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5)`);
      for (const query of ["lattice", "missing", "unrelated"]) {
        const samples = { before: [], after: [] };
        const lookups = { before: [], after: [] };
        const expected = await candidate(reader("all"), "youtube.com", query, options);
        for (let run = 0; run < 7; run++) for (const kind of run % 2 ? ["after", "before"] : ["before", "after"]) {
          const start = performance.now();
          const actual = await candidate(reader(kind === "after" ? "new" : "old", "youtube",
            sample => lookups[kind].push(sample)), "youtube.com", query, options);
          samples[kind].push(performance.now() - start);
          check(`benchmark equality ${query}/${run}/${kind}`, JSON.stringify(actual) === JSON.stringify(expected));
        }
        const median = values => [...values].sort((a, b) => a - b)[3];
        timings.push({ query, count: expected.length, samples, lookups,
          median: { before: median(samples.before), after: median(samples.after) },
          lookupMedian: { before: median(lookups.before.map(x => x.milliseconds)),
            after: median(lookups.after.map(x => x.milliseconds)) } });
      }
    }
    done({ pass: true, checks, timings });
  } finally {
    await db.close();
    await IOUtils.remove(path, { ignoreAbsent: true });
  }
})().catch(error => done({ pass: false, error: String(error), stack: error.stack }));
