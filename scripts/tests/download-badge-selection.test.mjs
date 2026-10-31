import assert from "node:assert/strict";
import test from "node:test";
import { PreviewDownloadBadge, PreviewDownloadRecords, ZenLibraryPreviewSources }
  from "../../src/zen/library/ZenLibraryPreviewSources.sys.mjs";

function clock() {
  let now = 0, next = 0;
  const pending = new Map(), callbacks = [];
  return { pending, callbacks,
    setTimeout(fn, delay) {
      const id = ++next; callbacks.push(fn); pending.set(id, {fn, at:now + delay}); return id;
    },
    clearTimeout(id) { pending.delete(id); },
    advance(ms) {
      const end = now + ms;
      while (true) {
        const pair = [...pending].sort((a,b) => a[1].at - b[1].at)[0];
        if (!pair || pair[1].at > end) break;
        now = pair[1].at; pending.delete(pair[0]); pair[1].fn();
      }
      now = end;
    },
  };
}
const item = (state, name = state) => ({name, stopped:state !== "active",
  succeeded:state === "completed", canceled:["paused","cancelled"].includes(state),
  hasPartialData:state === "paused", error:state === "failed" ? new Error("fixture") : null});
const change = (x, state) => Object.assign(x, item(state, x.name));
function prefs() {
  const data = new Map(), observers = new Set();
  return {getBoolPref:(key, fallback) => data.get(key) ?? fallback,
    addObserver:(_key, observer) => observers.add(observer),
    removeObserver:(_key, observer) => observers.delete(observer),
    setBoolPref(key, value) {data.set(key,value);for (const observer of observers) observer.observe(null,"nsPref:changed",key);}};
}

test("completed and unsuccessful badges use the native expiry intervals", () => {
  for (const [state, duration] of [["completed",30000],["failed",5000],["cancelled",5000]]) {
    const time = clock(), badge = new PreviewDownloadBadge(undefined,time), x = item(state);
    badge.select(x);time.advance(duration - 1);assert.equal(badge.current,x,state);
    time.advance(1);assert.equal(badge.current,null,state);assert.equal(time.pending.size,0);
  }
});

test("active paused and queued badges survive elapsed time and expansion", () => {
  for (const state of ["active","paused","notStarted"]) {
    const time = clock(), badge = new PreviewDownloadBadge(undefined,time), x = item(state);
    badge.select(x);badge.expand();time.advance(3600000);
    assert.equal(badge.current,x,state);assert.equal(time.pending.size,0);
  }
});

test("completion after expansion starts its own lifetime and the next expansion consumes it", () => {
  const time = clock(), badge = new PreviewDownloadBadge(undefined,time), x = item("active");
  badge.select(x);badge.expand();time.advance(60000);
  change(x,"completed");badge.changed(x);time.advance(29999);assert.equal(badge.current,x);
  badge.expand();assert.equal(badge.current,null);assert.equal(time.pending.size,0);
});

test("replacement and restarted expiry reject callbacks from an older schedule", () => {
  const time = clock(), badge = new PreviewDownloadBadge(undefined,time), x = item("completed"), y = item("active");
  badge.select(x);const first = time.callbacks.at(-1);time.advance(10000);
  badge.changed(x);assert.equal(time.pending.size,1);first();assert.equal(badge.current,x);
  time.advance(20000);assert.equal(badge.current,x,"terminal update restarts the thirty seconds");
  badge.select(y);for (const callback of time.callbacks) callback();
  assert.equal(badge.current,y,"old expiry cannot dismiss a newer item");
  assert.equal(time.pending.size,0);
});

test("selecting the same ID does not restart expiry and unrelated changes do not affect it", () => {
  const time = clock(), badge = new PreviewDownloadBadge(undefined,time), x = item("failed");
  badge.select(x);time.advance(4000);badge.select(x);badge.changed(item("completed"));
  time.advance(1000);assert.equal(badge.current,null);
});

test("terminal updates switch directly to the newest other active visible download", () => {
  const time = clock(), pool = new PreviewDownloadRecords(false,time);
  const older = item("active","older"), next = item("active","next"), paused = item("paused"), selected = item("active","selected");
  for (const x of [older,next,paused,selected]) pool.records.add(x);
  pool.setVisible([older,next,paused,selected]);pool.badge.select(selected);
  change(selected,"completed");pool.badge.changed(selected);
  assert.equal(pool.badge.current,next);assert.equal(time.pending.size,0);
  change(next,"failed");pool.badge.changed(next);assert.equal(pool.badge.current,older);
  change(older,"cancelled");pool.badge.changed(older);time.advance(5000);
  assert.equal(pool.badge.current,null,"paused downloads are not replacement candidates");
});

test("files occupy preview slots and an active download outside the four cannot replace", () => {
  const time = clock(), pool = new PreviewDownloadRecords(false,time);
  const hidden = item("active"), completed = item("completed");
  pool.records.add(hidden);pool.records.add(completed);
  pool.setVisible([hidden, {}, {}, {}, completed]);pool.badge.select(completed);pool.badge.expand();
  assert.equal(pool.badge.current,null);
  pool.setVisible([hidden, {}, completed]);pool.badge.select(completed);pool.badge.expand();
  assert.equal(pool.badge.current,hidden);
});

test("removing the selected item returns to activity and never revives an old completed badge", () => {
  const time = clock(), pool = new PreviewDownloadRecords(false,time), source = new ZenLibraryPreviewSources(undefined,prefs(),pool);
  const old = item("completed"), active = item("active"), latest = item("completed");
  source.add(old);source.add(active);source.add(latest);source.setVisible([old,active,latest]);
  source.remove(latest);assert.equal(source.badge.current,active);
  source.remove(active);assert.equal(source.badge.current,null);
  assert.equal(time.pending.size,0);source.destroy();
});

test("windows share consumption and lifetime while private teardown clears only its own state", () => {
  const time = clock(), settings = prefs(), normal = new PreviewDownloadRecords(false,time), privatePool = new PreviewDownloadRecords(true,time);
  const first = new ZenLibraryPreviewSources(undefined,settings,normal), second = new ZenLibraryPreviewSources(undefined,settings,normal);
  const x = item("completed"), secret = item("completed");first.add(x);time.advance(10000);
  second.add(x);time.advance(10000);first.destroy();time.advance(10000);
  assert.equal(second.badge.current,null,"joining window does not restart the same arrival");
  const third = new ZenLibraryPreviewSources(undefined,settings,normal);
  const y = item("completed");second.add(y);third.badge.expand();assert.equal(second.badge.current,null);
  const privateOne = new ZenLibraryPreviewSources(undefined,settings,privatePool);
  const privateTwo = new ZenLibraryPreviewSources(undefined,settings,privatePool);
  privateOne.add(secret);privateOne.destroy();assert.equal(privateTwo.badge.current,secret);
  privateTwo.destroy();assert.equal(privatePool.badge.current,null);
  assert.equal(privatePool.records.size,0);assert.equal(time.pending.size,0);
  second.destroy();third.destroy();
});

test("history initialization and disabled-source rebuilds cannot resurrect consumed badges", () => {
  const time = clock(), settings = prefs(), pool = new PreviewDownloadRecords(false,time);
  const source = new ZenLibraryPreviewSources(undefined,settings,pool), x = item("completed");
  source.add(x,true);assert.equal(source.badge.current,null);
  source.add(x);source.set("download",false);assert.equal(source.badge.current,null);assert.equal(time.pending.size,0);
  source.set("download",true);assert.equal(source.badge.current,null);
  source.add(item("completed"));source.destroy();
  assert.equal(time.pending.size,1,"normal-session expiry outlives a closing window");
  time.advance(30000);assert.equal(pool.badge.current,null);
});

test("only one window processes each change and closing it transfers ownership", () => {
  const time=clock(), pool=new PreviewDownloadRecords(false,time), settings=prefs();
  const first=new ZenLibraryPreviewSources(undefined,settings,pool), second=new ZenLibraryPreviewSources(undefined,settings,pool);
  const x=item("active");first.add(x);change(x,"completed");
  first.changed(x);const timers=time.callbacks.length;second.changed(x);
  assert.equal(time.callbacks.length,timers,"duplicate window notification does not restart expiry");
  first.destroy();time.advance(5000);second.changed(x);
  assert.equal(time.callbacks.length,timers+1,"remaining window owns subsequent updates");
  time.advance(29999);assert.equal(second.badge.current,x);time.advance(1);assert.equal(second.badge.current,null);
  second.destroy();
});

test("a new retry attempt restores an expired badge, while resuming does not steal another selection", () => {
  const time=clock(), pool=new PreviewDownloadRecords(false,time), source=new ZenLibraryPreviewSources(undefined,prefs(),pool);
  const failed={...item("failed"),startTime:new Date(1000)};source.add(failed);time.advance(5000);
  change(failed,"active");failed.startTime=new Date(2000);source.changed(failed);
  assert.equal(source.badge.current,failed);assert.equal(time.pending.size,0);
  change(failed,"paused");source.changed(failed);
  const newer=item("active");source.add(newer);change(failed,"active");failed.startTime=new Date(3000);source.changed(failed);
  assert.equal(source.badge.current,newer,"resuming a paused item retains current badge ownership");
  source.destroy();pool.clear();
});
