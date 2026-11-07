const done = arguments[arguments.length - 1];
(async () => {
  if (!Services.dirsvc.get("ProfD", Ci.nsIFile).path.includes("zen-search-color-retention-")) {
    throw Error("Disposable fixture required");
  }
  const w = Services.wm.getMostRecentWindow("navigator:browser");
  const { ProvidersManager } = ChromeUtils.importESModule("moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs");
  const provider = ProvidersManager.getInstanceForSap("urlbar").getProvider("UrlbarProviderPlaces");
  const db = await provider.getDatabaseHandle();
  const lazy = {PAGES_FRECENCY_FIELD:"frecency"};
const SQL_BOOKMARK_TAGS_FRAGMENT = `
   ( SELECT dateAdded FROM moz_bookmarks WHERE fk = h.id ) AS bookmarkDate,
   ( SELECT title FROM moz_bookmarks WHERE fk = h.id AND title NOTNULL
     ORDER BY lastModified DESC LIMIT 1
   ) AS btitle,
   ( SELECT GROUP_CONCAT(t.title ORDER BY t.title)
     FROM moz_bookmarks b
     JOIN moz_bookmarks t ON t.id = +b.parent AND t.parent = :parent
     WHERE b.fk = h.id
   ) AS tags`;

// TODO bug 412736: in case of a frecency tie, we might break it with h.typed
// and h.visit_count.  That is slower though, so not doing it yet...
// NB: as a slight performance optimization, we only evaluate the "bookmarked"
// condition once, and avoid evaluating "btitle" and "tags" when it is false.
function defaultQuery(conditions = "") {
  let query = `
     SELECT h.url, h.title, ${SQL_BOOKMARK_TAGS_FRAGMENT}, h.id, t.open_count,
            ${lazy.PAGES_FRECENCY_FIELD} AS frecency, t.userContextId,
            h.last_visit_date, NULLIF(t.groupId, '') groupId
     FROM moz_places h
     LEFT JOIN moz_openpages_temp t
            ON t.url = h.url
            AND (t.userContextId = :userContextId OR (t.userContextId <> -1 AND :userContextId IS NULL))
            AND ${ZEN_OPEN_TAB_CONDITION}
     WHERE (
        (:switchTabsEnabled AND t.open_count > 0) OR
        ${lazy.PAGES_FRECENCY_FIELD} <> 0
       )
       AND CASE WHEN bookmarkDate
         THEN
           AUTOCOMPLETE_MATCH(:searchString, h.url,
                              IFNULL(btitle, h.title), tags,
                              h.visit_count, h.typed,
                              1, t.open_count,
                              :matchBehavior, :searchBehavior, NULL)
         ELSE
           AUTOCOMPLETE_MATCH(:searchString, h.url,
                              h.title, '',
                              h.visit_count, h.typed,
                              0, t.open_count,
                              :matchBehavior, :searchBehavior, NULL)
         END
       ${conditions ? "AND" : ""} ${conditions}
     ORDER BY ${lazy.PAGES_FRECENCY_FIELD} DESC, h.id DESC
     LIMIT :maxResults`;
  return query;
}

const ZEN_OPEN_TAB_CONDITION = `(:zenOpenTabs IS NULL OR
  json_array(t.url, t.userContextId, IFNULL(t.groupId, '')) IN (SELECT key FROM json_each(:zenOpenTabs)))`;

const SQL_SWITCHTAB_QUERY = `
   SELECT t.url, t.url AS title, 0 AS bookmarkDate, NULL AS btitle,
           NULL AS tags, NULL AS id, t.open_count, NULL AS frecency,
           t.userContextId, NULL AS last_visit_date, NULLIF(t.groupId, '') groupId
   FROM moz_openpages_temp t
   LEFT JOIN moz_places h ON h.url_hash = hash(t.url) AND h.url = t.url
   WHERE h.id IS NULL
     AND (t.userContextId = :userContextId OR (t.userContextId <> -1 AND :userContextId IS NULL))
            AND ${ZEN_OPEN_TAB_CONDITION}
     AND AUTOCOMPLETE_MATCH(:searchString, t.url, t.url, NULL,
                            NULL, NULL, NULL, t.open_count,
                            :matchBehavior, :searchBehavior, NULL)
   ORDER BY t.ROWID DESC
   LIMIT :maxResults`;


  const history = defaultQuery(), unvisited = SQL_SWITCHTAB_QUERY, condition = ZEN_OPEN_TAB_CONDITION;
  const tables = ["places", "openpages_temp", "bookmarks"];
  const rename = sql => sql.replace(/moz_(places|openpages_temp|bookmarks)\b/g, "zen_cost_$1");
  const plans = [], results = [], checks = [];
  const check = (name, passed) => checks.push({name, passed: !!passed});
  try {
    for (const table of tables) await db.execute(`DROP TABLE IF EXISTS temp.zen_cost_${table}`);
    await db.execute("CREATE TEMP TABLE zen_cost_places(id INTEGER PRIMARY KEY, url TEXT, url_hash INTEGER, title TEXT, frecency INTEGER, visit_count INTEGER, typed INTEGER, last_visit_date INTEGER)");
    await db.execute("CREATE TEMP TABLE zen_cost_openpages_temp(url TEXT, userContextId INTEGER, groupId TEXT, open_count INTEGER, PRIMARY KEY(url,userContextId,groupId))");
    await db.execute("CREATE TEMP TABLE zen_cost_bookmarks(id INTEGER PRIMARY KEY, fk INTEGER, parent INTEGER, dateAdded INTEGER, lastModified INTEGER, title TEXT)");
    await db.execute("CREATE INDEX temp.zen_cost_frecency ON zen_cost_places(frecency DESC,id DESC)");
    await db.execute("CREATE INDEX temp.zen_cost_url ON zen_cost_places(url_hash,url)");
    await db.execute("CREATE INDEX temp.zen_cost_bookmark_fk ON zen_cost_bookmarks(fk)");
    await db.execute(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<50000)
      INSERT INTO zen_cost_places SELECT n, 'https://cost.test/page-'||n, hash('https://cost.test/page-'||n),
      'History page '||n, n*10, 1, 0, n*1000000 FROM seq`);
    await db.execute(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<1000)
      INSERT INTO zen_cost_openpages_temp SELECT 'https://cost.test/'||(CASE WHEN n<=500 THEN 'page-'||(n*100) ELSE 'unvisited-'||n END),
      n%4, CASE WHEN n%5=0 THEN 'split-'||n ELSE '' END, 1 FROM seq`);
    const open = await db.execute("SELECT url,userContextId,groupId FROM zen_cost_openpages_temp");
    const keys = open.map(row => JSON.stringify([row.getResultByName("url"),row.getResultByName("userContextId"),row.getResultByName("groupId")]));
    const scope = JSON.stringify(Object.fromEntries(keys.map(k=>[k,1])));
    const constants = Ci.mozIPlacesAutoComplete;
    const common = {parent:4, searchString:"page", matchBehavior:constants.MATCH_BOUNDARY,
      searchBehavior:constants.BEHAVIOR_HISTORY | constants.BEHAVIOR_OPENPAGE,
      userContextId:null, maxResults:30, zenOpenTabs:scope};
    const signature = rows => JSON.stringify(rows.map(row=>["url","open_count","userContextId","groupId"].map(k=>row.getResultByName(k))));
    for (const [kind, sql] of [["history", history], ["unvisited", unvisited]]) {
      const candidate = rename(sql), baseline = candidate.replace(`AND ${condition}`, "");
      for (const searchString of kind === "history" ? ["page", "page-100", "absenttoken"] : ["unvisited", "unvisited-700", "absenttoken"]) {
        const params = {...common, searchString, ...(kind === "history" && {switchTabsEnabled:true})};
        if (kind !== "history") delete params.parent;
        const baseParams = {...params}; delete baseParams.zenOpenTabs;
        const a = await db.executeCached(baseline, baseParams), b = await db.executeCached(candidate, params);
        check(`${kind} ${searchString} same all-scope results`, signature(a) === signature(b));
        const durations = {baseline:[], candidate:[]};
        for (let i=0;i<16;i++) {
          for (const mode of i%2 ? ["candidate","baseline"] : ["baseline","candidate"]) {
            const t=w.performance.now();
            await db.executeCached(mode === "baseline" ? baseline : candidate, mode === "baseline" ? baseParams : params);
            if(i>=4) durations[mode].push(w.performance.now()-t);
          }
        }
        const stats = values => { const sorted=[...values].sort((a,b)=>a-b); return {medianMs:sorted[Math.floor(sorted.length/2)],minMs:sorted[0],maxMs:sorted.at(-1),samplesMs:values}; };
        results.push({kind, searchString, rows:b.length, baseline:stats(durations.baseline),candidate:stats(durations.candidate)});
      }
      const params = {...common, ...(kind === "history" && {switchTabsEnabled:true})};
      if(kind !== "history") delete params.parent;
      const plan = await db.execute("EXPLAIN QUERY PLAN " + candidate, params);
      plans.push({kind, details:plan.map(row=>row.getResultByName("detail"))});
    }
    const unusual = [
      ['https://example.test/a?x="\\☃', 0, 'space "quote"\\雪'],
      ['https://example.test/a?x="\\☃', 7, 'space "quote"\\雪'],
      ['https://example.test/a?x="\\☃', -1, ''],
      ['https://example.test/a', 0, 'other'],
    ];
    const specialScope=JSON.stringify(Object.fromEntries(unusual.slice(0,3).map(tuple=>[JSON.stringify(tuple),1])));
    for (let i=0;i<unusual.length;i++) {
      const [url, context, group]=unusual[i];
      const row=(await db.execute("SELECT json_array(:url,:context,:group) IN (SELECT key FROM json_each(:scope)) AS matches", {url,context,group,scope:specialScope}))[0];
      check(`tuple quoting, Unicode, container/private case ${i}`, !!row.getResultByName("matches") === (i<3));
    }
    return {passed:checks.every(c=>c.passed),checks,historyRows:50000,openRows:1000,results,plans,
      scope:"Synthetic temporary tables in the candidate's native Places connection; this measures only added SQL scope cost, not overall browser speed."};
  } finally {
    for (const table of tables) await db.execute(`DROP TABLE IF EXISTS temp.zen_cost_${table}`);
  }
})().then(done, error=>done({error:String(error),stack:error.stack}));
