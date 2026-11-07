import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { FavoriteOutlineCache, FAVORITE_CACHE_BYTES } from "../../src/zen/tabs/ZenFavoriteOutlineCache.sys.mjs";

const key = (source = "data:image/png;base64,AAAA", scale = 2, filter = "none") =>
  JSON.stringify([source, 16, scale, filter]);
// Only the bounded PNG header is inspected here. The browser integration test
// supplies actual native-rendered PNGs to Gecko's decoder.
function pixels(size = 94) {
  const header = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").copy(header);
  header.writeUInt32BE(size, 16); header.writeUInt32BE(size, 20);
  return "data:image/png;base64," + header.toString("base64");
}
const bytes = data => new TextEncoder().encode(JSON.stringify(data));

test("saved pixels round-trip only for identical artwork, scale, filter and renderer", () => {
  const original = new FavoriteOutlineCache("renderer-a");
  assert(original.set(key(), pixels()));
  assert(original.set(key(undefined, 1), pixels(47)));
  assert(original.set(key(undefined, 2, "brightness(0)"), pixels()));
  const restored = new FavoriteOutlineCache("renderer-a");
  restored.restore(original.serialize());
  assert.deepEqual([...restored.entries()], [...original.entries()]);
  assert(!new Map(restored.entries()).has(key("data:image/png;base64,QkJC")));
  const changedRenderer = new FavoriteOutlineCache("renderer-b");
  changedRenderer.restore(original.serialize());
  assert.equal([...changedRenderer.entries()].length, 0);
});

test("remote URLs, malformed cache rows and oversized decoded images are rejected", () => {
  const store = new FavoriteOutlineCache("v1");
  for (const source of ["https://site.test/favicon.png", "file:///tmp/icon.png", "resource://other/icon.png"])
    assert.equal(store.set(key(source), pixels()), false);
  for (const invalid of [null, 42, "bad", JSON.stringify(["data:image/png;base64,A", 16, 2]),
    JSON.stringify(["data:image/png;base64,A", 0, 2, "none"]), key(undefined, 5)])
    assert.equal(store.set(invalid, pixels()), false);
  for (const invalid of [null, "data:image/svg+xml,<svg/>", pixels(100000), pixels(47),
    pixels().slice(0, -1) + "!", pixels() + "A".repeat(350000)])
    assert.equal(store.set(key(), invalid), false);
  store.restore(bytes({version:"v1", entries:[null,{},[null,pixels()],[key(),pixels()]]}));
  assert.deepEqual([...store.entries()], [[key(),pixels()]]);
});

test("embedded SVG wrappers preserve their artwork, appearance and raster identity across restart", () => {
  const wrap = (image, scheme = "light", width = 32) =>
    "moz-remote-image://?" + new URLSearchParams({url:image,colorScheme:scheme,width:String(width),height:String(width),stretch:"true"});
  const source = "data:image/svg+xml," + '<svg xmlns="http://www.w3.org/2000/svg"><style>@media(prefers-color-scheme:dark){path{fill:white}}</style></svg>';
  const original = new FavoriteOutlineCache("renderer-a");
  const light = key(wrap(source));
  const dark = key(wrap(source,"dark"));
  const larger = key(wrap(source,"dark",64));
  for (const id of [light,dark,larger]) assert(original.set(id,pixels()));
  const restored = new FavoriteOutlineCache("renderer-a");restored.restore(original.serialize());
  assert.deepEqual([...restored.entries()], [...original.entries()]);
  assert.equal([...restored.entries()].length,3);
  assert(!new Map(restored.entries()).has(key(wrap(source.replace("white","red")))));
});

test("SVG wrappers cannot make remote or mutable sources persistable", () => {
  const store = new FavoriteOutlineCache("v1");
  const embedded = encodeURIComponent("data:image/svg+xml,<svg/>");
  for (const source of [
    "moz-remote-image://?url="+encodeURIComponent("https://site.test/favicon.svg"),
    "moz-remote-image://?url="+encodeURIComponent("file:///tmp/icon.svg"),
    "moz-remote-image://?url="+embedded+"&url=https://site.test/favicon.svg",
    "moz-remote-image://?url=https://site.test/favicon.svg&url="+embedded,
    "moz-remote-image://?url="+encodeURIComponent("moz-remote-image://?url="+embedded),
    "moz-remote-image://host?url="+embedded,
    "moz-remote-image:///path?url="+embedded,
    "moz-remote-image://?url="+embedded+"#fragment",
    "moz-remote-image://?other="+embedded,
    "moz-remote-image://?url=data:text/html,hello",
  ]) assert.equal(store.set(key(source),pixels()),false,source);
  assert.equal([...store.entries()].length,0);
});

test("corrupt, oversized and old cache files cannot replace current artwork", () => {
  const store = new FavoriteOutlineCache("v1");
  store.set(key(), pixels());
  for (const content of [new TextEncoder().encode("broken"), new Uint8Array(FAVORITE_CACHE_BYTES+1),
    bytes({version:"old", entries:[[key(),pixels()]]}),
    bytes({version:"v1",entries:Array.from({length:65},()=>[key(),pixels()])})]) store.restore(content);
  assert.deepEqual([...store.entries()], [[key(),pixels()]]);
  const replacement = pixels() + "AAAA";
  store.set(key(), replacement);
  store.restore(bytes({version:"v1",entries:[[key(),pixels()]]}));
  assert.equal(new Map(store.entries()).get(key()), replacement, "late disk reads cannot overwrite a new render");
});

test("entry count, memory and serialized bytes stay bounded", () => {
  const store = new FavoriteOutlineCache("v1");
  for(let i=0;i<80;i++) store.set(key("data:image/svg+xml,"+i),pixels());
  assert.equal([...store.entries()].length,64);
  assert(!new Map(store.entries()).has(key("data:image/svg+xml,0")));
  for(let i=0;i<20;i++) store.set(key("data:image/svg+xml,"+i+'"'.repeat(700000)),pixels());
  assert(store.serialize().length <= FAVORITE_CACHE_BYTES);
  assert([...store.entries()].reduce((sum,[k,v])=>sum+2*(k.length+v.length),0) <= FAVORITE_CACHE_BYTES);
});

function prewarmFixture({privateWindow = false, failRead = false} = {}) {
  const source = readFileSync(new URL("../../src/zen/tabs/ZenFavoriteOutline.sys.mjs",import.meta.url),"utf8")
    .replaceAll("export ","");
  const listeners = new Map(), images = [], reads = [], writes = [], blockers = [];
  const file = path => ({path,fileSize:1,lastModifiedTime:1,
    clone(){return file(this.path);}, append(part){this.path+='/'+part;}, get parent(){return file('/owned');}});
  const disk = new FavoriteOutlineCache("1:build:1:1:1:1");disk.set(key(),pixels());
  let resolveRead;
  const read = new Promise(resolve=>{resolveRead=resolve;});
  const context = vm.createContext({console,TextDecoder,TextEncoder,atob,btoa,
    Services:{appinfo:{OS:"Darwin",platformBuildID:"build"},dirsvc:{get:()=>file('/owned/profile')}},
    Ci:{nsIFile:{}},PathUtils:{join:(...parts)=>parts.join('/')},
    IOUtils:{read:(path,options)=>{reads.push({path,options});return failRead?Promise.reject(Error('missing')):read;},
      write:async(path,data)=>{writes.push({path,data});}},
    ChromeUtils:{importESModule(uri){
      if(uri.includes('PrivateBrowsingUtils'))return {PrivateBrowsingUtils:{isWindowPrivate:()=>privateWindow}};
      if(uri.includes('ZenFavoriteOutlineCache'))return {FavoriteOutlineCache,FAVORITE_CACHE_BYTES};
      if(uri.includes('Timer'))return {setTimeout,clearTimeout};
      if(uri.includes('AsyncShutdown'))return {AsyncShutdown:{profileBeforeChange:{addBlocker:(_name,fn)=>blockers.push(fn)}}};
      throw Error(uri);
    }},
  });
  const window={closed:false,addEventListener:(name,fn)=>listeners.set(name,fn),
    Image:class {constructor(){images.push(this);} decode(){return new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});}}};
  const api=vm.runInContext(source+'\n({prewarmFavoriteOutlines,preparedWindows,cache})',context);
  return {api,window,images,reads,writes,listeners,blockers,load:()=>resolveRead(disk.serialize())};
}
const tick = async()=>{await new Promise(resolve=>setImmediate(resolve));};

test("prewarming needs no tabbrowser and shares a decoded border with the upcoming controller", async()=>{
  const f=prewarmFixture();f.api.prewarmFavoriteOutlines(f.window);f.api.prewarmFavoriteOutlines(f.window);
  assert.equal(f.reads.length,1);assert.equal(f.reads[0].options.maxBytes,FAVORITE_CACHE_BYTES+1);
  f.load();await tick();assert.equal(f.images.length,1);
  assert.equal(f.api.preparedWindows.get(f.window).decoded.size,0);
  f.images[0].resolve();await tick();
  assert.equal(f.api.preparedWindows.get(f.window).decoded.get(key()),f.images[0]);
  assert.equal(f.api.cache.get(key()),pixels());assert.equal(f.writes.length,0);
});

test("private windows never open the disk cache or enroll a persistent writer",()=>{
  const f=prewarmFixture({privateWindow:true});f.api.prewarmFavoriteOutlines(f.window);
  assert.equal(f.reads.length,0);assert.equal(f.blockers.length,0);
  assert.equal(f.api.preparedWindows.has(f.window),false);
});

test("missing cache, failed decoding and closed windows preserve normal rendering fallback",async()=>{
  const missing=prewarmFixture({failRead:true});missing.api.prewarmFavoriteOutlines(missing.window);await tick();
  assert.equal(missing.images.length,0);
  const failed=prewarmFixture();failed.api.prewarmFavoriteOutlines(failed.window);failed.load();await tick();
  failed.images[0].reject(Error('bad pixels'));await tick();
  assert.equal(failed.api.preparedWindows.get(failed.window).decoded.size,0);
  const closed=prewarmFixture();closed.api.prewarmFavoriteOutlines(closed.window);closed.load();await tick();
  closed.listeners.get('unload')();closed.images[0].resolve();await tick();
  assert.equal(closed.api.preparedWindows.has(closed.window),false);assert.equal(closed.api.cache.size,0);
  assert.equal(closed.images[0].src,"");
});

test("ordinary pixels flush atomically at shutdown and remote artwork is not persisted",async()=>{
  const f=prewarmFixture();f.api.prewarmFavoriteOutlines(f.window);f.load();await tick();
  const store=f.api.preparedWindows.get(f.window).store;
  store.record(key('https://site.test/favicon.png'),pixels());await f.blockers[0]();
  assert.equal(f.writes.length,0);
  store.record(key('data:image/png;base64,QkJC'),pixels());await f.blockers[0]();
  assert.equal(f.writes.length,1);
  const saved=new FavoriteOutlineCache('1:build:1:1:1:1');saved.restore(f.writes[0].data);
  assert.equal([...saved.entries()].length,2);
});
