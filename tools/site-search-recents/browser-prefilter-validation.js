/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
// Run in a disposable browser profile, never against a user's Places database.
const done = arguments[arguments.length - 1];
(async () => {
  const profile = Services.dirsvc.get('ProfD', Ci.nsIFile).path;
  if (!PathUtils.filename(profile).startsWith('zen-recents-prefilter-')) {
    throw Error('Disposable profile required');
  }
  const { Sqlite } = ChromeUtils.importESModule('resource://gre/modules/Sqlite.sys.mjs');
  const { recentSiteSearches } = ChromeUtils.importESModule('resource:///modules/zen/urlbar/ZenSiteSearchHistory.sys.mjs');
  const path = PathUtils.join(profile, 'recents-prefilter-validation.sqlite');
  await IOUtils.remove(path, { ignoreAbsent: true });
  const db = await Sqlite.openConnection({ path });
  const checks = [];
  const check = (name, pass) => {
    checks.push({ name, pass });
    if (!pass) throw Error(name);
  };
  // The previous aggregate-over-all-visits query is the equivalence oracle.
  const baseline = { executeCached: (_sql, { begin, end }, callback) => db.executeCached(`
    SELECT p.url, p.title, MAX(v.visit_date) AS date
    FROM moz_historyvisits v JOIN moz_places p ON p.id = v.place_id
    WHERE v.visit_date >= :begin AND v.visit_date <= :end
      AND p.hidden = 0 AND v.visit_type IN (1, 2, 3, 5, 6, 9)
      AND NOT EXISTS (SELECT 1 FROM moz_historyvisits next
        WHERE next.from_visit = v.id AND next.visit_type IN (5, 6))
    GROUP BY p.id ORDER BY date DESC, p.id DESC`, { begin, end }, callback) };
  try {
    for (const sql of [
      'CREATE TABLE moz_places(id INTEGER PRIMARY KEY, url TEXT, title TEXT, hidden INTEGER, last_visit_date INTEGER)',
      'CREATE TABLE moz_historyvisits(id INTEGER PRIMARY KEY, place_id INTEGER, visit_date INTEGER, visit_type INTEGER, from_visit INTEGER)',
      'CREATE INDEX v_date ON moz_historyvisits(visit_date)',
      'CREATE INDEX v_place ON moz_historyvisits(place_id, visit_date)',
      'CREATE INDEX v_from ON moz_historyvisits(from_visit)',
      'CREATE INDEX p_date ON moz_places(last_visit_date)',
    ]) await db.execute(sql);
    const now = Date.UTC(2026, 10, 4), end = now * 1000, day = 86400000000;
    let visitID = 0;
    async function page(id, url, title, visits, hidden = 0) {
      await db.execute('INSERT INTO moz_places VALUES (:id, :url, :title, :hidden, :date)', {
        id, url, title, hidden, date: Math.max(...visits.map(v => v.date)),
      });
      for (const visit of visits) await db.execute('INSERT INTO moz_historyvisits VALUES (:id, :place, :date, :type, :from)', {
        id: ++visitID, place: id, date: visit.date, type: visit.type ?? 1, from: visit.from ?? null,
      });
    }
    const engine = host => ({ getSubmission: q => ({ uri: { spec: `https://${host}/find?q=${q}` } }) });
    // Mixed visits, repeated URLs/titles, Unicode case folds and title-only matches.
    let random = 1701;
    const rand = n => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % n; };
    for (let id = 1; id <= 300; id++) {
      const kind = rand(6);
      const title = [null, '', 'duplicate', 'DUPLICATE', 'HTTPS://KELVIN.TEST/FIND?Q= saved', `Result ${id}`][kind];
      const url = `https://${['kelvin.test', 'elsewhere.test', 'Kelvin.test', 'kélvin.test', 'xn--bcher-kva.test', 'other.test'][rand(6)]}/find?q=${id}`;
      const visits = Array.from({ length: 1 + rand(5) }, () => ({ date: end - (1 + rand(17)) * day, type: 1 + rand(9) }));
      await page(id, url, title, visits, rand(12) === 0 ? 1 : 0);
    }
    // A newer excluded visit must not hide an eligible older document visit.
    await page(301, 'https://kelvin.test/find?q=future', 'future', [{ date: end + day }, { date: end - 1000 }]);
    await page(302, 'https://kelvin.test/find?q=download', 'download', [{ date: end, type: 7 }, { date: end - 2000 }]);
    await page(303, 'https://kelvin.test/find?q=redirect', 'redirect', [{ date: end - 500 }]);
    const redirectSource = visitID;
    await page(304, 'https://elsewhere.test/destination', 'destination', [{ date: end - 499, type: 5, from: redirectSource }]);
    await page(305, 'https://kelvin.test/find?q=old', 'old', [{ date: end - 15 * day }]);
    await page(306, 'https://elsewhere.test/unicode', 'HTTPS://KELVIN.TEST/FIND?Q= Unicode-only', [{ date: end - 250 }]);
    await page(307, 'https://kelvin.test/find?q=hidden', 'hidden', [{ date: end }], 1);
    for (const host of ['kelvin.test', 'Kelvin.test', 'kélvin.test', 'xn--bcher-kva.test', 'elsewhere.test', 'missing.test']) {
      for (const shift of [0, 1, 14]) for (const limit of [1, 3, 10]) {
        const options = { now: now + shift * 86400000, limit };
        const expected = await recentSiteSearches(baseline, engine(host), options);
        const actual = await recentSiteSearches(db, engine(host), options);
        check(`same records/order: ${host}, +${shift} days, limit ${limit}`, JSON.stringify(actual) === JSON.stringify(expected));
      }
    }
    const current = await recentSiteSearches(db, engine('kelvin.test'), { now });
    check('Unicode title-only match retained', current.some(x => x.url === 'https://elsewhere.test/unicode'));
    check('future visit does not mask older eligible visit', current.some(x => x.title === 'future'));
    check('redirect source and hidden page excluded', !current.some(x => ['redirect', 'hidden'].includes(x.title)));
    // Each page still consumes the budget once despite repeated eligible visits.
    await db.execute('DELETE FROM moz_historyvisits'); await db.execute('DELETE FROM moz_places');
    for (let id = 1; id <= 7; id++) await page(id, `https://budget.test/find?q=${id}`,
      ['First', 'FIRST', '', 'Fourth', 'Fifth', 'Sixth', 'Seventh'][id - 1],
      [{ date: end - id * 1000 }, { date: end - id * 1000 - 1 }]);
    const budget = await recentSiteSearches(db, engine('budget.test'), { now });
    check('five-page budget before empty/duplicate labels', JSON.stringify(budget.map(x => x.title)) === JSON.stringify(['First', 'Fourth', 'Fifth']));
    check('cancelled lookup publishes nothing', (await recentSiteSearches(db, engine('budget.test'), { now, current: () => false })).length === 0);
    done({ pass: true, checks });
  } finally {
    await db.close();
    await IOUtils.remove(path, { ignoreAbsent: true });
  }
})().catch(error => done({ pass: false, error: String(error), stack: error.stack }));
