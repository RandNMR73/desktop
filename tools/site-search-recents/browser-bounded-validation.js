/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
// Separate disposable database; the installed pre-window query is frozen below
// as the equivalence/performance oracle. Never use a normal Places database.
const done = arguments[arguments.length - 1];
(async () => {
  const profile = Services.dirsvc.get('ProfD', Ci.nsIFile).path;
  if (!PathUtils.filename(profile).startsWith('zen-recents-bounded-')) throw Error('Owned profile required');
  const {Sqlite} = ChromeUtils.importESModule('resource://gre/modules/Sqlite.sys.mjs');
  const [module = 'resource:///modules/zen/urlbar/ZenSiteSearchHistory.sys.mjs'] = arguments;
  const {recentSiteSearches, siteSearchHistoryPrefix} = ChromeUtils.importESModule(module);
  const {tidySiteSearchTitle} = ChromeUtils.importESModule('resource:///modules/zen/urlbar/ZenSiteSearchTitles.mjs');
  const SITE_SEARCH_HISTORY_DAYS=14, SITE_SEARCH_RECENT_CANDIDATES=5;
async function baseline(db, engine, {
  now = Date.now(), limit = 10, current = () => true,
} = {}) {
  const prefix = siteSearchHistoryPrefix(engine);
  if (!prefix || limit <= 0 || !current()) return [];
  const begin = (now - SITE_SEARCH_HISTORY_DAYS * 86400000) * 1000;
  const end = now * 1000;
  const filter = siteSearchHistoryPrefilter(prefix);
  const results = [], seen = new Set(), matches = siteSearchHistoryMatcher(prefix);
  let candidates = 0;
  // Fix the join order so the cheap page filter runs before visit aggregation.
  // The full word matcher below remains authoritative; the SQL filter only
  // removes impossible matches, without changing the five-page budget.
  await db.executeCached(`
    SELECT p.url, p.title, MAX(v.visit_date) AS date
    FROM moz_places p CROSS JOIN moz_historyvisits v ON p.id = v.place_id
    WHERE p.hidden = 0 AND p.last_visit_date >= :begin AND (${filter.condition})
      AND v.visit_date >= :begin AND v.visit_date <= :end
      AND v.visit_type IN (1, 2, 3, 5, 6, 9)
      AND NOT EXISTS (SELECT 1 FROM moz_historyvisits next
        WHERE next.from_visit = v.id AND next.visit_type IN (5, 6))
    GROUP BY p.id ORDER BY date DESC, p.id DESC`,
  { begin, end, ...filter.params }, (row, cancel) => {
    if (!current()) { cancel(); return; }
    const url = row.getResultByName("url");
    const title = row.getResultByName("title");
    if (!matches(url, title)) return;
    if (++candidates >= SITE_SEARCH_RECENT_CANDIDATES) cancel();
    // The reference converts history page titles into recent-search labels.
    // A visit without a title consumes a candidate but produces no label;
    // decoding its URL would invent a visible recent search.
    if (!title?.trim()) return;
    // Empty scopes use the history text matcher, including title-only matches.
    // Requiring SearchService to decode a current engine submission drops
    // redirects, old URL templates, and other matching saved pages.
    const label = tidySiteSearchTitle(url, title) ?? title;
    // Search-result identities use the full lowercased display title. NFC also
    // preserves Swift String's canonical equivalence when comparing labels.
    const key = label.toLowerCase().normalize("NFC");
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ title: label, url, date: row.getResultByName("date") });
    if (results.length >= limit) cancel();
  });
  return current() ? results : [];
}

  const {siteSearchHistoryMatcher,siteSearchHistoryPrefilter} = ChromeUtils.importESModule('resource:///modules/zen/urlbar/ZenUrlbarSiteSearch.mjs');
  const path = PathUtils.join(profile,'bounded-probe.sqlite');
  const db = await Sqlite.openConnection({path});
  const now = Date.UTC(2026,10,6), end = now*1000, day = 86400000000;
  const engine = host => ({getSubmission:q=>({uri:{spec:`https://${host}/find?q=${q}`}})});
  let fastCount=0,fallbackCount=0;
  async function candidate(engine, options={}) {
    let calls=0;
    const tracked={executeCached:(...args)=>{calls++;return db.executeCached(...args);}};
    const result=await recentSiteSearches(tracked,engine,{now,...options});
    if(calls===1)fastCount++;else if(calls===2)fallbackCount++;
    return result;
  }
  const checks=[],bench=[];
  const check=(name,pass)=>{checks.push({name,pass});if(!pass)throw Error(name);};
  let visitID=0;
  async function page(id,url,title,visits,hidden=0){
    await db.execute('INSERT INTO moz_places VALUES(:id,:url,:title,:hidden,:last)',{id,url,title,hidden,last:Math.max(...visits.map(v=>v.date))});
    for(const v of visits)await db.execute('INSERT INTO moz_historyvisits VALUES(:id,:place,:date,:type,:from)',{id:++visitID,place:id,date:v.date,type:v.type??1,from:v.from??null});
  }
  async function compare(label,hosts){
    for(const host of hosts)for(const shift of [0,1,14])for(const limit of [1,3,10]){
      const options={now:now+shift*86400000,limit};
      const expected=await baseline(db,engine(host),options), actual=await candidate(engine(host),options);
      check(`${label}:${host}:${shift}:${limit}`,JSON.stringify(actual)===JSON.stringify(expected));
    }
  }
  try{
    for(const sql of ['CREATE TABLE moz_places(id INTEGER PRIMARY KEY,url TEXT,title TEXT,hidden INTEGER,last_visit_date INTEGER)',
      'CREATE TABLE moz_historyvisits(id INTEGER PRIMARY KEY,place_id INTEGER,visit_date INTEGER,visit_type INTEGER,from_visit INTEGER)',
      'CREATE INDEX p_date ON moz_places(last_visit_date)','CREATE INDEX v_place ON moz_historyvisits(place_id,visit_date)',
      'CREATE INDEX v_from ON moz_historyvisits(from_visit)'])await db.execute(sql);
    let rng=1701;const rand=n=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng%n;};
    for(let id=1;id<=350;id++)await page(id,`https://${['example.test','elsewhere.test','Kelvin.test'][rand(3)]}/find?q=${id}`,
      [null,'','DUPLICATE','duplicate','https://example.test/find?q= title-only',`Item ${id}`][rand(6)],
      Array.from({length:1+rand(5)},()=>({date:end-(rand(17)-1)*day,type:1+rand(9)})),rand(12)===0?1:0);
    await page(351,'https://example.test/find?q=future','future',[{date:end+day},{date:end-1000}]);
    await page(352,'https://example.test/find?q=frame','frame',[{date:end,type:7},{date:end-2000}]);
    await page(353,'https://example.test/find?q=redirect','redirect',[{date:end-500}]);const from=visitID;
    await page(354,'https://elsewhere.test/destination','destination',[{date:end-499,type:5,from}]);
    await compare('mixed',['example.test','elsewhere.test','missing.test','kelvin.test']);
    await db.execute('DELETE FROM moz_historyvisits');await db.execute('DELETE FROM moz_places');visitID=0;
    for(let id=1;id<=300;id++)await page(id,`https://ties.test/find?q=${id}`,id%3?'Same':'',[{date:end},{date:end-1}]);
    await compare('ties',['ties.test','missing.test']);
    const beforeFast=fastCount;
    await candidate(engine('ties.test'));
    check('equal timestamps prove the fast path using place-id order',fastCount===beforeFast+1);
    await db.execute('DELETE FROM moz_historyvisits');await db.execute('DELETE FROM moz_places');visitID=0;
    // A newer excluded visit can put a low-id page in the window even though
    // its visible date ties an unread higher-id page. Date alone is not proof.
    for(let id=1;id<=300;id++)await page(id,`https://${id===1||id===44||id>=297?'boundary.test':'other.test'}/find?q=${id}`,
      `Boundary ${id}`,id===1?[{date:end+day},{date:end}]:[{date:end}]);
    const beforeFallback=fallbackCount;
    const tieResult=await candidate(engine('boundary.test'));
    check('boundary tie falls back when an unread page can outrank the fifth',fallbackCount===beforeFallback+1);
    check('unread tie is retained instead of the newer excluded visit',JSON.stringify(tieResult.map(x=>x.title))===JSON.stringify([300,299,298,297,44].map(x=>`Boundary ${x}`)));
    await compare('boundary',['boundary.test']);
    let active=true,calls=0;
    const cancellingDB={executeCached:async(sql,params,callback)=>{
      calls++;
      return db.executeCached(sql,params,(row,cancel)=>{
        callback(row,cancel);
        active=false;
      });
    }};
    check('cancel during bounded read returns nothing',(await recentSiteSearches(cancellingDB,engine('boundary.test'),{now,current:()=>active})).length===0);
    check('cancel during bounded read never starts fallback',calls===1);
    active=true;calls=0;
    const cancelFallbackDB={executeCached:async(sql,params,callback)=>{
      const query=++calls;
      return db.executeCached(sql,params,(row,cancel)=>{
        callback(row,cancel);
        if(query===2)active=false;
      });
    }};
    check('cancel during fallback returns nothing',(await recentSiteSearches(cancelFallbackDB,engine('boundary.test'),{now,current:()=>active})).length===0);
    check('fallback cancellation exercised both queries',calls===2);
    await db.execute('DELETE FROM moz_historyvisits');
    // Leave page dates behind deliberately: no persistent lookup cache may
    // return titles once their eligible visits have been removed.
    check('deleted visits immediately disappear',(await candidate(engine('boundary.test'))).length===0);
    for(const limit of [0,-1])check(`nonpositive limit ${limit}`, (await candidate(engine('boundary.test'),{limit})).length===0);
    check('cancelled before reading returns nothing',(await candidate(engine('boundary.test'),{current:()=>false})).length===0);
    await db.execute('DELETE FROM moz_historyvisits');await db.execute('DELETE FROM moz_places');
    await db.execute(`WITH RECURSIVE n(x) AS(VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<20000)
      INSERT INTO moz_places SELECT x,'https://'||CASE WHEN x>19000 THEN 'rare.test' WHEN x%32=0 THEN 'example.test' ELSE 'unrelated.test' END||'/find?q='||x,'Result '||x,0,:end-x*1000 FROM n`,{end});
    await db.execute(`INSERT INTO moz_historyvisits SELECT (p.id-1)*5+j.value+1,p.id,p.last_visit_date-j.value,1,NULL FROM moz_places p CROSS JOIN json_each('[0,1,2,3,4]') j`);
    await compare('large',['example.test','unrelated.test','rare.test','missing.test']);
    const queryPlans=[];
    const explainingDB={executeCached:async(sql,params,callback)=>{
      queryPlans.push((await db.executeCached('EXPLAIN QUERY PLAN '+sql,params)).map(row=>row.getResultByName('detail')));
      return db.executeCached(sql,params,callback);
    }};
    await recentSiteSearches(explainingDB,engine('example.test'),{now});
    check('recent window uses the date index',queryPlans[0].some(x=>x.includes('p_date')));
    check('bounded visits use the place/date index',queryPlans[0].some(x=>x.includes('v_place')));
    for(const host of ['example.test','unrelated.test','rare.test','missing.test']){
      const samples={baseline:[],candidate:[]};
      for(let i=0;i<8;i++)for(const label of i%2?['candidate','baseline']:['baseline','candidate']){
        const start=performance.now();const rows=label==='baseline'?await baseline(db,engine(host),{now}):await candidate(engine(host));
        if(i)samples[label].push(performance.now()-start);
      }
      const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
      bench.push({host,samples,median:Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,median(v)]))});
    }
    done({pass:true,checks,bench,fastCount,fallbackCount,queryPlans});
  }finally{await db.close();await IOUtils.remove(path,{ignoreAbsent:true});}
})().catch(error=>done({pass:false,error:String(error),stack:error.stack}));
