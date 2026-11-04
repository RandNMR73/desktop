/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { recentSiteSearches, siteSearchHistoryPrefix } from '../../src/zen/urlbar/ZenSiteSearchHistory.sys.mjs';
const engine = { id:'fixture', getSubmission:q=>({uri:{spec:'https://example.test/find?q='+encodeURIComponent(q)}}) };
const parse = url => ({engine,terms:new URL(url).searchParams.get('q')});
const row = (q,date=1) => ({getResultByName:key=>({url:'https://example.test/find?q='+encodeURIComponent(q),date})[key]});
test('recent searches limit unique queries after sorting, without lowering their displayed case',async()=>{
  const db={executeCached:async(sql,args,callback)=>{
    assert.equal(args.end-args.begin,14*86400000*1000);
    let stopped=false; for(const r of [row('A'),row('a'),row(''),row('B'),row('C')]) {
      callback(r,()=>{stopped=true;}); if(stopped)break;
    }
  }};
  assert.deepEqual((await recentSiteSearches(db,engine,parse,{limit:2})).map(r=>r.query),['A','B']);
});
test('asynchronous cancellation cannot publish results from a previous scope',async()=>{
  let current=true, resolve;
  const pending=recentSiteSearches({executeCached:(_sql,_args,callback)=>new Promise(r=>{resolve=rows=>{rows.forEach(row=>callback(row,()=>{}));r();};})},engine,parse,{current:()=>current});
  current=false;resolve([row('old scope')]);assert.deepEqual(await pending,[]);
});
test('scope history refuses unrelated engines and unsafe or non-GET submissions',async()=>{
  const db={executeCached:async(_sql,_args,callback)=>callback(row('not this engine'),()=>{})};
  assert.deepEqual(await recentSiteSearches(db,engine,url=>({...parse(url),engine:{id:'other'}})),[]);
  for(const submission of [null,{uri:{spec:'file:///tmp/zen_scope_history_probe'}},{postData:{},uri:{spec:'https://example.test/?q=zen_scope_history_probe'}}])
    assert.equal(siteSearchHistoryPrefix({getSubmission:()=>submission}),null);
});
