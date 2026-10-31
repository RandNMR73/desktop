import assert from "node:assert/strict";
import test from "node:test";
import { downloadPreviewState, downloadPreviewSubtitle, ZenDownloadPreview }
  from "../../src/zen/library/ZenDownloadPreview.sys.mjs";

const item = (extra = {}) => ({ stopped: true, succeeded: false, canceled: false,
  hasPartialData: false, error: null, currentBytes: 1200000, totalBytes: 3600000,
  speed: 40000, ...extra });

test("preview distinguishes all six native download states", () => {
  assert.equal(downloadPreviewState(null), "none");
  for (const [extra, state] of [
    [{ stopped: false }, "active"], [{ succeeded: true }, "completed"],
    [{ canceled: true, hasPartialData: true }, "paused"], [{ canceled: true }, "cancelled"],
    [{ error: {} }, "failed"], [{}, "notStarted"],
  ]) assert.equal(downloadPreviewState(item(extra)), state);
  assert.equal(downloadPreviewState(item({ canceled: true, hasPartialData: true, error: {} })), "paused");
});

test("terminal and retained subtitles select native labels and optional source text", () => {
  assert.deepEqual(downloadPreviewSubtitle(item()), { text: "" });
  assert.deepEqual(downloadPreviewSubtitle(item({ error: {} })), { id: "library-preview-failed" });
  for (const [extra,state] of [[{canceled:true},"cancelled"],[{canceled:true,hasPartialData:true},"paused"]]) {
    assert.deepEqual(downloadPreviewSubtitle(item(extra)), {id:`library-preview-${state}`});
    assert.deepEqual(downloadPreviewSubtitle(item(extra),{domain:"example.co.uk"}),
      {id:`library-preview-${state}-source`,args:{domain:"example.co.uk"}});
  }
  assert.deepEqual(downloadPreviewSubtitle(item({succeeded:true}),{date:"5 days ago"}),{text:"5 days ago"});
});

test("active subtitle requires a known positive total before showing transfer or opening text", () => {
  for (const totalBytes of [undefined,-1,0]) for (const launchWhenSucceeded of [false,true]) {
    assert.deepEqual(downloadPreviewSubtitle(item({stopped:false,totalBytes,launchWhenSucceeded}),{transfer:"ignored"}),{text:""});
  }
  assert.deepEqual(downloadPreviewSubtitle(item({stopped:false}),{transfer:"1.2/3.6 MB · 1m"}),{text:"1.2/3.6 MB · 1m"});
  assert.deepEqual(downloadPreviewSubtitle(item({stopped:false,launchWhenSucceeded:true})),
    {id:"library-preview-opening",args:{progress:33}});
  assert.deepEqual(downloadPreviewSubtitle(item({stopped:false,currentBytes:99,totalBytes:100,launchWhenSucceeded:true})),
    {id:"library-preview-opening",args:{progress:99}});
});

test("transfer formatting caches equivalent updates, bounds retention and stops after teardown", () => {
  const calls=[];
  const preview=new ZenDownloadPreview({}, {transfer:(...args)=>{calls.push(args);return "";}});
  const x=item({stopped:false});
  assert.equal(preview.transfer(x,100000),"");
  assert.equal(preview.transfer(x,100050),"");
  assert.deepEqual(calls,[[1200000,3600000,60,100000]]);
  preview.transfer(x,101000); assert.equal(calls.length,2);
  for(let i=0;i<16;i++)preview.transfer({...x,currentBytes:i},101000);
  preview.transfer(x,101000); assert.equal(calls.length,19,"evicted inputs are formatted again");
  preview.destroy(); assert.equal(preview.transfer(x,101000),null); assert.equal(calls.length,19);
});

test("unknown speed and total do not invent a remaining-time estimate", () => {
  const calls=[],preview=new ZenDownloadPreview({}, {transfer:(...args)=>{calls.push(args);return "";}});
  for(const extra of [{speed:0},{speed:Infinity},{totalBytes:-1},{currentBytes:4000000}])preview.transfer(item(extra),100000);
  assert.ok(calls.every(call=>call[2]===-1));
  assert.equal(new ZenDownloadPreview({},{}).transfer(item()),null,"older native bundles select fallback");
  preview.destroy();
});

test("source-domain cache follows URL changes and omits unknown suffixes and parser errors", t => {
  const old=globalThis.Services,calls=[];
  globalThis.Services={eTLD:{
    getKnownPublicSuffixFromHost(host){calls.push(host);return host.endsWith(".invalid")?"":"co.uk";},
    getBaseDomainFromHost(host){if(host==="127.0.0.1")throw Error("IP");return "example.co.uk";},
  }};
  t.after(()=>{globalThis.Services=old;});
  const preview=new ZenDownloadPreview({},{}),x={source:{url:"https://cdn.example.co.uk/file"}};
  assert.equal(preview.sourceDomain(x),"example.co.uk");
  assert.equal(preview.sourceDomain(x),"example.co.uk");assert.equal(calls.length,1);
  x.source.url="https://example.invalid/file";assert.equal(preview.sourceDomain(x),"");
  x.source.url="http://127.0.0.1/file";assert.equal(preview.sourceDomain(x),"");
  x.source.url="data:text/plain,fixture";assert.equal(preview.sourceDomain(x),"");
  preview.destroy();
});
