/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { recentSiteSearches, siteSearchHistoryPrefix, typedSiteSearches } from '../../src/zen/urlbar/ZenSiteSearchHistory.sys.mjs';
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
test('empty scopes only convert the five newest matching history pages',async()=>{
  const unrelated={getResultByName:key=>({url:'https://unrelated.test/',title:'Elsewhere',date:10})[key]};
  const values=[unrelated,row('A'),row('a'),row(''),row('B'),row('C'),row('Older')];
  let examined=0;
  const db={executeCached:async(_sql,_args,callback)=>{
    let stopped=false;
    for(const value of values){examined++;callback(value,()=>{stopped=true;});if(stopped)break;}
  }};
  assert.deepEqual((await recentSiteSearches(db,engine,parse,{limit:10})).map(r=>r.query),['A','B','C']);
  assert.equal(examined,6,'unmatched pages do not consume the five-page candidate budget');
  assert.deepEqual((await recentSiteSearches(db,engine,parse,{limit:1})).map(r=>r.query),['A']);
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

test('typed history retains old prefix matches and aggregates URL variants before limiting',async()=>{
  const now=Date.UTC(2026,10,4),day=86400000;
  const rows=[
    {query:'general purpose',date:(now-20*day)*1000,visitCount:3},
    {query:'GPU mode',date:(now-30*day)*1000,visitCount:2},
    {query:'gpu MODE',date:(now-29*day)*1000,visitCount:4},
    {query:'gpu benchmarks',date:(now-day)*1000,visitCount:2},
    {query:'unrelated',date:now*1000,visitCount:100},
  ];
  const db={executeCached:async(_sql,args,callback)=>{
    assert.equal(args.revHost,'tset.elpmaxe.');
    for(const data of rows) callback({getResultByName:key=>key==='url'?
      engine.getSubmission(data.query).uri.spec:data[key]},()=>{});
  }};
  const result=await typedSiteSearches(db,engine,parse,'GPU',{now,limit:2});
  assert.deepEqual(result.map(r=>r.query),['gpu benchmarks','gpu MODE']);
  assert.equal(result[1].visitCount,6);
  assert.equal(result[1].date,now-29*day);
});

test('typed history is engine-isolated and cancelled reads cannot return old completions',async()=>{
  const db={executeCached:async(_sql,_args,callback)=>callback(row('query'),()=>{})};
  assert.deepEqual(await typedSiteSearches(db,engine,url=>({...parse(url),engine:{id:'elsewhere'}}),'q'),[]);
  let current=true,resolve;
  const pending=typedSiteSearches({executeCached:(_sql,_args,callback)=>new Promise(r=>{
    resolve=()=>{callback(row('query'),()=>{});r();};
  })},engine,parse,'q',{current:()=>current});
  current=false;resolve();assert.deepEqual(await pending,[]);
});

test('an engine with terms in its authority cannot fail a history lookup',async()=>{
  const unsafe={getSubmission:()=>({uri:{spec:'https://zen_scope_history_probe.example.test/'}})};
  const db={executeCached:()=>assert.fail('invalid history origin must not be queried')};
  assert.deepEqual(await typedSiteSearches(db,unsafe,parse,'q'),[]);
});
