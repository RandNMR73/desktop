import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { DownloadFluidSpring, DownloadThumbnailChannel, DownloadThumbnailState, ZenDownloadThumbnails }
  from "../../src/zen/library/ZenDownloadThumbnailMotion.sys.mjs";

const fixture = name => JSON.parse(fs.readFileSync(new URL(
  `../../tools/download-preview/${name}.json`, import.meta.url)));
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);

test("FluidSpring matches 2404 native numerical samples", () => {
  let count = 0;
  for (const reference of fixture("fluid-spring-reference").filter(r => r.case === "rest")) {
    const spring = new DownloadFluidSpring(0);
    for (const sample of reference.samples) {
      const value = spring.sample(reference.target, sample.milliseconds / 1000);
      near(value, sample.value ?? reference.target, 1e-10, "value");
      for (const key of ["offset", "velocity", "force", "time"]) {
        near(spring[key], sample.state[key], 1e-9, key);
      }
      count++;
    }
  }
  assert.equal(count, 2404);
});

test("only equal-delay springs merge and preserve sampled force and velocity", () => {
  for (const reference of fixture("fluid-delay-reference")) {
    const { delay, oldDelay, samples } = reference;
    let channel = new DownloadThumbnailChannel(0).write(20, 0, "fluid", oldDelay);
    for (let ms = 0; ms < 100; ms += 5) channel.sample(ms / 1000);
    const previous = channel;
    channel = channel.write(-30, 0.1, "fluid", delay);
    assert.equal(channel === previous, samples[0].merge);
    if (delay !== oldDelay) continue;
    // Native DelayAnimation's numerical integration uses its local clock.
    for (const sample of samples) {
      if (!Object.hasOwn(sample, "merge")) channel.sample(sample.milliseconds / 1000);
      if (!channel.fluid) break;
      for (const key of ["offset", "force", "velocity"]) {
        near(channel.fluid[key], sample.state[key], 1e-8, key);
      }
      near(channel.fluid.time, sample.state.time, 1e-10, "time");
    }
  }
});

for (const reference of fixture("thumbnail-overlap-reference")) {
  test(`rendered native thumbnail: ${reference.case}, ${reference.inspected}`, () => {
    const state = new DownloadThumbnailState({ items: ["A", "B", "C", "D"],
      selected: reference.initial, active: reference.active });
    const expected = new Map(reference.samples.map(s => [s.milliseconds, s.geometry]));
    let epsilon = 0, checked = 0;
    for (let ms = 0; ms <= 1200; ms += 10) {
      const time = ms / 1000;
      if (ms) state.sample(time + epsilon);
      for (const event of reference.inputs.filter(e => e.milliseconds === ms)) {
        if (event.name.startsWith("select-")) {
          state.select(event.name === "select-nil" ? null : event.name.at(-1),
            time + epsilon, ["select-B", "select-C"].includes(event.name));
        } else state.setExpanded(event.name === "expand", time + epsilon);
      }
      state.callbacks(time + epsilon);
      state.sample(time + epsilon);
      epsilon += 0.000001; // Native fixture's second render flush.
      const value = state.sample(time + epsilon).get(reference.inspected);
      const native = expected.get(ms);
      if (!native?.visible || Math.min(...native.areas) <= 1) continue;
      const offset = value.scale * (value.localX - value.width / 2);
      const radians = value.rotation * Math.PI / 180;
      const x = 4 + value.width / 2 + Math.cos(radians) * offset + value.x;
      const y = 254 - 56 * state.items.indexOf(reference.inspected) + Math.sin(radians) * offset + value.y;
      near(x, native.centerX, 0.04, `${ms}ms x`);
      near(y, native.centerY, 0.04, `${ms}ms y`);
      checked++;
    }
    assert.ok(checked > 0, "the fixture contains visible native geometry");
    assert.equal(checked, reference.samples.filter(s => s.geometry.visible &&
      Math.min(...s.geometry.areas) > 1).length, "check every reliably visible native sample");
    // A quickly replaced item can disappear before its markers are opaque
    // enough for centroid recovery. Verify that disappearance independently.
    const last = reference.samples.at(-1).geometry;
    if (!last.visible) assert.equal(state.sample(1.3).get(reference.inspected).opacity, 0);
  });
}

test("reordering retains channels by identity and removes departed items", () => {
  const state = new DownloadThumbnailState({ items: ["A", "B"], selected: "A", active: ["A"] });
  state.setExpanded(true, 0);
  state.sample(0.04);
  const channel = state.nodes.get("A").width;
  state.setItems(["B", "A", "C"], ["A"], 0.04);
  assert.equal(state.nodes.get("A").width, channel);
  state.setItems(["A", "C"], ["A"], 0.05);
  assert.equal(state.nodes.has("B"), false);
});

test("old callbacks remain live after a new selection and expansion", () => {
  const state = new DownloadThumbnailState({ items: ["A", "B"], selected: "A" });
  state.select(null, 0);
  state.select("B", 0.05, true);
  state.setExpanded(true, 0.1);
  assert.equal(state.pending.length, 2);
  state.callbacks(0.27);
  assert.equal(state.pending.length, 1);
  state.callbacks(0.39);
  assert.equal(state.visible, state.selected);
  assert.equal(state.pending.length, 0);
});

function rendererFixture() {
  let now = 0, next = 0, reduced = false, changes = 0;
  const frames = new Map(), timers = new Map();
  const clock = { setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); } };
  const window = { document: { timeline: { currentTime: 0 } },
    performance: { now: () => now },
    matchMedia: () => ({ matches: reduced }),
    requestAnimationFrame(fn) { const id = ++next; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); } };
  const animations=[];
  const sprite = { animate() { const animation={ finished: new Promise(() => {}), cancel() {} }; animations.push(animation); return animation; } };
  const renderer = new ZenDownloadThumbnails(window, sprite, () => changes++, clock);
  const row = item => ({ download: item, hidden: false, clientWidth: 212, style: {},
    badge: { offsetLeft: 2, offsetTop: 6, offsetWidth: 40, offsetHeight: 40 },
    details: [{ style: {} }, { style: {} }], attributes: new Map(),
    querySelector() { return this.badge; }, querySelectorAll() { return this.details; },
    toggleAttribute(name, value) { if (value) this.attributes.set(name, ""); else this.attributes.delete(name); } });
  const advance = (milliseconds, render = true) => {
    const end = now + milliseconds;
    while (now < end) {
      now = Math.min(end, now + 1000 / 120);
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
      if (render) for (const [id, fn] of [...frames]) { frames.delete(id); fn(now); }
    }
  };
  return { renderer, row, advance, frames, timers, animations, setReduced() { reduced = true; },
    get changes() { return changes; } };
}

test("renderer keeps the arrival return after hover and goes idle after settling", async () => {
  const f = rendererFixture(), item = { target: { path: "/owned/A" }, succeeded: false };
  const row = f.row(item);
  f.advance(20000); // DocumentTimeline remains stale during this idle period.
  f.renderer.sync([row], item);
  assert.equal(f.animations[0].startTime, 20000, "icon uses current time after idle too");
  f.advance(80);
  f.renderer.setExpanded(true);
  f.advance(100);
  const closing = f.renderer.setExpanded(false);
  f.advance(1500);
  await closing;
  assert.equal(f.renderer.displayed, item);
  assert.equal(row.style.opacity, 1);
  assert.ok(row.style.transform.includes("scale(0.8)"));
  assert.equal(row.details[0].style.opacity, 0);
  assert.equal(f.frames.size, 0, "no frame loop at rest");
  assert.equal(f.timers.size, 0, "all delayed callbacks completed");
  f.renderer.destroy();
});

test("dismissal cleanup runs while presentation frames are suspended", () => {
  const f = rendererFixture(), item = { target: { path: "/owned/A" }, succeeded: true };
  const row = f.row(item);
  f.renderer.sync([row], item, { animate: false });
  f.renderer.sync([row], null);
  f.advance(400, false);
  assert.equal(f.renderer.displayed, null);
  assert.equal(f.changes, 1);
  assert.equal(f.timers.size, 0);
  f.renderer.destroy();
  assert.equal(f.frames.size, 0);
});

test("reduced motion applies the final layout and destroy cancels pending work", () => {
  const f = rendererFixture(), item = { target: { path: "/owned/A" }, succeeded: false };
  const row = f.row(item);
  f.setReduced();
  f.renderer.sync([row], item);
  f.renderer.setExpanded(true);
  assert.equal(row.style.opacity, 1);
  assert.ok(row.style.transform.includes("scale(1)"));
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
  f.renderer.destroy();
});
