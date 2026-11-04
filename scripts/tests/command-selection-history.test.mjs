import assert from "node:assert/strict";
import test from "node:test";
import { CommandSelectionHistory } from "../../src/zen/urlbar/ZenCommandSelectionHistory.sys.mjs";
import { applyLearnedSelection } from "../../src/zen/urlbar/ZenCommandRanking.sys.mjs";

const DAY = 86400 * 1000;
const NOW = 1000 * DAY;
const identity = value => ({ kind: 3, value: `https://fixture.test/${value}` });
function fixture({ data = {}, queryRules = () => ({ isURLLike: false }), now = () => NOW } = {}) {
  let loads = 0;
  const writes = [];
  const store = new CommandSelectionHistory({ queryRules, now, storage: async () => {
    loads++;
    return { data, save: value => writes.push(structuredClone(value)) };
  } });
  return { store, writes, loads: () => loads };
}

test("remembered choices preserve exact queries and isolate profiles", async () => {
  const f = fixture();
  for (const [query, profileID, value] of [["cats", undefined, "a"], ["Cats", undefined, "b"],
    [" cats", undefined, "c"], ["cats ", undefined, "d"], ["cats", "work", "e"]]) {
    assert.equal(await f.store.record({ query, profileID, identity: identity(value) }), true);
    assert.equal((await f.store.selectedResult(query, {profileID})).identity.value, identity(value).value);
  }
  assert.equal((await f.store.selectedResult("cats")).identity.value, identity("a").value);
  assert.equal((await f.store.selectedResult("cats", {profileID:"Default"})).identity.value, identity("a").value);
  assert.equal(await f.store.selectedResult("cats", {profileID:"other"}), null);
  assert.equal(f.loads(), 1);
});

test("canonical Unicode query and profile keys replace the same choice", async () => {
  const f = fixture();
  await f.store.record({query:"cafe\u0301",profileID:"re\u0301sume\u0301",identity:identity("old")});
  await f.store.record({query:"café",profileID:"résumé",identity:identity("new")});
  assert.equal((await f.store.selectedResult("cafe\u0301",{profileID:"résumé"})).identity.value,identity("new").value);
  assert.equal(f.writes.at(-1).profiles[0].entries.length,1);
});

test("private reads and writes do not initialize or touch storage", async () => {
  const f = fixture({queryRules:()=>{throw Error("Private query must not reach classifier");}});
  assert.equal(await f.store.record({query:"private",identity:identity("private"),isPrivate:true}),false);
  assert.equal(await f.store.selectedResult("private",{isPrivate:true}),null);
  assert.equal(f.loads(),0);
  assert.equal(f.writes.length,0);
});

test("URL-like inputs and unmeasured classifiers cannot overwrite a learned choice", async () => {
  let rules = {isURLLike:false};
  const f = fixture({queryRules:()=>rules});
  await f.store.record({query:"original",identity:identity("kept")});
  for (const value of [true,undefined,null,"false",0]) {
    rules = {isURLLike:value,urlInterpretation:"search"};
    assert.equal(await f.store.record({query:"original",identity:identity("wrong")}),false);
  }
  rules=null;
  assert.equal(await f.store.record({query:"original",identity:identity("wrong")}),false);
  assert.equal((await f.store.selectedResult("original")).identity.value,identity("kept").value);
  assert.equal(f.writes.length,1);
});

test("empty queries and arbitrary dictionary keys round trip without prototype behavior", async () => {
  const f = fixture();
  for (const query of ["", "__proto__", "constructor", "toString"]) {
    await f.store.record({query,profileID:"__proto__",identity:identity(query)});
  }
  const restored = fixture({data:f.writes.at(-1)}).store;
  for (const query of ["", "__proto__", "constructor", "toString"]) {
    assert.deepEqual((await restored.selectedResult(query,{profileID:"__proto__"})).identity,identity(query));
  }
});

test("90-day pruning includes the boundary, retains future dates, and visits every profile", async () => {
  const f = fixture({data:{version:1,profiles:[{id:"other",entries:[
    {query:"expired",identity:identity("a"),selectedAt:NOW-90*DAY-1},
    {query:"boundary",identity:identity("b"),selectedAt:NOW-90*DAY},
    {query:"future",identity:identity("c"),selectedAt:NOW+200*DAY},
  ]}]}});
  await f.store.record({query:"new",identity:identity("d")});
  assert.equal(await f.store.selectedResult("expired",{profileID:"other"}),null);
  assert.equal((await f.store.selectedResult("boundary",{profileID:"other"})).ageSeconds,90*86400);
  assert.equal((await f.store.selectedResult("future",{profileID:"other"})).ageSeconds,-200*86400);
});

test("retention is separate from the inclusive absolute 24-hour promotion window", async () => {
  const f = fixture();
  const first={candidate:{archetype:"searchWhatYouTyped"}},second={candidate:{archetype:"tab",selectionIdentity:identity("saved")}};
  for (const delta of [-DAY-1,-DAY,0,DAY,DAY+1,2*DAY]) {
    await f.store.record({query:"saved",identity:identity("saved"),selectedAt:NOW-delta});
    const selectedResult=await f.store.selectedResult("saved");
    assert.ok(selectedResult);
    const result=applyLearnedSelection([first,second],{query:"saved",selectedResult,suggestionsEqual:(a,b)=>a===b});
    assert.equal(result[0],Math.abs(delta)<=DAY?second:first);
  }
});

test("choice records are not capped by the recently-switched-tab limit", async () => {
  const f = fixture();
  await Promise.all(Array.from({length:120},(_,i)=>f.store.record({query:`q${i}`,identity:identity(`${i}`)})));
  assert.equal(f.loads(),1);
  assert.equal(f.writes.at(-1).profiles[0].entries.length,120);
  assert.ok(await f.store.selectedResult("q0"));
});

test("recording snapshots identity before async load and never stores activation payloads", async () => {
  let release;
  let saved;
  const store = new CommandSelectionHistory({queryRules:()=>({isURLLike:false}),now:()=>NOW,
    storage:()=>new Promise(resolve=>{release=()=>resolve({data:{},save:data=>{saved=data;}});})});
  const original={kind:2,value:"one",secondary:"two",activate(){},browser:{secret:true}};
  const pending=store.record({query:"pair",identity:original});
  original.value="mutated";
  release();await pending;
  const result=await store.selectedResult("pair");
  assert.deepEqual(result.identity,{kind:2,value:"one",secondary:"two"});
  result.identity.value="changed";
  assert.equal((await store.selectedResult("pair")).identity.value,"one");
  assert.equal(JSON.stringify(saved).includes("secret"),false);
});

test("unknown schemas and failed loads are not overwritten", async () => {
  for (const data of [{version:2,profiles:[]},{version:1,profiles:{}},{unrecognized:true},[],"invalid",42]) {
    const f=fixture({data});
    assert.equal(await f.store.record({query:"q",identity:identity("a")}),false);
    assert.equal(await f.store.selectedResult("q"),null);
    assert.equal(f.writes.length,0);
  }
  const store=new CommandSelectionHistory({queryRules:()=>({isURLLike:false}),storage:async()=>{throw Error("unreadable");}});
  assert.equal(await store.record({query:"q",identity:identity("a")}),false);
});

test("malformed entries are discarded and clear supports one or all profiles", async () => {
  const f=fixture({data:{version:1,profiles:[{id:"Default",entries:[null,
    {query:"bad",identity:{kind:2,value:"x"},selectedAt:NOW},
    {query:"valid",identity:identity("a"),selectedAt:NOW}]}]}});
  assert.equal(await f.store.selectedResult("bad"),null);
  for (const invalid of [{kind:9,value:"x"},{kind:2,value:"x"},null]) {
    assert.equal(await f.store.record({query:"bad",identity:invalid}),false);
  }
  await f.store.record({query:"q",identity:identity("b"),profileID:"work"});
  await f.store.clear();
  assert.equal(await f.store.selectedResult("valid"),null);
  assert.ok(await f.store.selectedResult("q",{profileID:"work"}));
  await f.store.clear({allProfiles:true});
  assert.deepEqual(f.writes.at(-1),{version:1,profiles:[]});
});
