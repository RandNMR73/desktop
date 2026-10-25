import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../../src/zen/tabs/ZenPinnedTabManager.mjs", import.meta.url),
  "utf8",
).replace(/^import .*;\n/m, "");

function fixture(initial = "2026-10-25T12:00:00") {
  let now = new Date(initial).valueOf(),
    timerId = 0;
  const timers = new Map(),
    observers = new Map();
  const target = () => ({
    listeners: new Map(),
    addEventListener(name, fn) {
      this.listeners.set(name, fn);
    },
    removeEventListener(name, fn) {
      if (this.listeners.get(name) === fn) this.listeners.delete(name);
    },
  });
  const window = Object.assign(target(), {
    setTimeout(fn, delay) {
      timers.set(++timerId, { fn, delay });
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  });
  const tabContainer = target();
  class Clock extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  }
  const context = vm.createContext({
    window,
    gBrowser: { tabContainer },
    nsZenDOMOperatedFeature: class {},
    Date: Clock,
    Services: {
      io: { newURI: (spec) => ({ host: new URL(spec).hostname }) },
      obs: {
        addObserver(fn, topic) {
          observers.set(topic, fn);
        },
        removeObserver(fn, topic) {
          if (observers.get(topic) === fn) observers.delete(topic);
        },
      },
    },
  });
  vm.runInContext(source, context);
  const manager = window.gZenPinnedTabManager;
  function tab(url = "https://calendar.google.com/calendar/u/0/r") {
    const attributes = new Map([
      ["zen-essential", "true"],
      ["image", "original-favicon"],
    ]);
    const properties = new Map();
    return {
      attributes,
      properties,
      isConnected: true,
      documentGlobal: window,
      _zenPinnedInitialState: { entry: { url } },
      linkedBrowser: { currentURI: { spec: url } },
      hasAttribute: (name) => attributes.has(name),
      getAttribute: (name) => attributes.get(name) ?? "",
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: (name) => attributes.delete(name),
      style: {
        setProperty: (name, value) => properties.set(name, value),
        removeProperty: (name) => properties.delete(name),
      },
    };
  }
  return {
    manager,
    window,
    tabContainer,
    observers,
    timers,
    tab,
    time(value) {
      now = new Date(value).valueOf();
    },
    day(tab) {
      return tab.getAttribute("zen-calendar-day");
    },
  };
}

test("unloaded Calendar gets local day artwork without replacing its favicon", () => {
  const f = fixture(),
    t = f.tab();
  t.setAttribute("pending", "true");
  f.manager.setEssentialTabIcon(t);
  assert.equal(f.day(t), "25");
  assert.match(t.properties.get("--zen-calendar-favorite-icon"), /\/25\.svg/);
  assert.equal(t.getAttribute("image"), "original-favicon");
  assert.equal(t.hasAttribute("pending"), true);
  assert.equal(f.timers.size, 1);
  assert.equal(f.observers.size, 2);
});

test("all Favorites share one timer and repeated focus does not repaint the same day", () => {
  const f = fixture(),
    a = f.tab(),
    b = f.tab();
  f.manager.setEssentialTabIcon(a);
  f.manager.setEssentialTabIcon(b);
  let writes = 0;
  a.setAttribute = () => {
    writes++;
  };
  f.window.listeners.get("focus")();
  assert.equal(writes, 0);
  assert.equal(f.timers.size, 1);
  assert.equal(f.day(b), "25");
});

test("midnight changes both icons at month and year boundaries", () => {
  const f = fixture("2026-12-31T23:59:00"),
    a = f.tab(),
    b = f.tab();
  f.manager.setEssentialTabIcon(a);
  f.manager.setEssentialTabIcon(b);
  assert.equal(f.day(a), "31");
  assert.equal([...f.timers.values()][0].delay, 60000);
  f.time("2027-01-01T00:00:00");
  [...f.timers.values()][0].fn();
  assert.equal(f.day(a), "1");
  assert.equal(f.day(b), "1");
  assert.equal(f.timers.size, 1);
});

test("wake and timezone notifications correct a stale day", () => {
  const f = fixture(),
    t = f.tab();
  f.manager.setEssentialTabIcon(t);
  f.time("2026-10-28T08:00:00");
  f.observers.get("wake_notification")();
  assert.equal(f.day(t), "28");
  f.time("2026-10-27T23:00:00");
  f.observers.get("default-timezone-changed")();
  assert.equal(f.day(t), "27");
  assert.equal([...f.timers.values()][0].delay, 3600000);
});

test("custom icon disables date decoration and releases the last timer", () => {
  const f = fixture(),
    t = f.tab();
  f.manager.setEssentialTabIcon(t);
  t.zenStaticIcon = "custom";
  f.manager.setEssentialTabIcon(t, "custom");
  assert.equal(f.day(t), "");
  assert.equal(t.properties.has("--zen-calendar-favorite-icon"), false);
  assert.equal(f.timers.size, 0);
  assert.equal(f.observers.size, 0);
  assert.equal(f.window.listeners.size, 0);
  assert.equal(f.tabContainer.listeners.size, 0);
  delete t.zenStaticIcon;
  f.manager.setEssentialTabIcon(t);
  assert.equal(f.day(t), "25");
  assert.equal(f.timers.size, 1);
});

test("artwork follows the pinned Calendar destination after navigation", () => {
  const f = fixture(),
    t = f.tab();
  t.linkedBrowser.currentURI.spec = "https://accounts.google.com/";
  f.manager.setEssentialTabIcon(t);
  assert.equal(f.day(t), "25");
  t._zenPinnedInitialState.entry.url = "https://example.com/";
  f.manager.setEssentialTabIcon(t);
  assert.equal(f.day(t), "");
  assert.equal(f.timers.size, 0);
});

test("ordinary tabs and similarly named hosts are left alone", () => {
  const f = fixture();
  for (const url of [
    "https://calendar.google.com.example.org/",
    "https://other.google.com/",
  ]) {
    const t = f.tab(url);
    f.manager.setEssentialTabIcon(t);
    assert.equal(f.day(t), "");
  }
  const t = f.tab();
  t.removeAttribute("zen-essential");
  f.manager.setEssentialTabIcon(t);
  assert.equal(f.day(t), "");
  assert.equal(f.timers.size, 0);
});

test("closing one Favorite keeps the other alive; closing the last releases all observers", () => {
  const f = fixture(),
    a = f.tab(),
    b = f.tab();
  f.manager.setEssentialTabIcon(a);
  f.manager.setEssentialTabIcon(b);
  f.tabContainer.listeners.get("TabClose")({ target: a });
  assert.equal(f.day(a), "");
  assert.equal(f.timers.size, 1);
  f.tabContainer.listeners.get("TabClose")({ target: b });
  assert.equal(f.timers.size, 0);
  assert.equal(f.observers.size, 0);
});

test("adopted, disconnected, and removed Favorites are pruned", () => {
  for (const change of [
    (t) => {
      t.documentGlobal = {};
    },
    (t) => {
      t.isConnected = false;
    },
    (t) => t.removeAttribute("zen-essential"),
  ]) {
    const f = fixture(),
      t = f.tab();
    f.manager.setEssentialTabIcon(t);
    change(t);
    f.manager._refreshCalendarFavorites();
    assert.equal(f.day(t), "");
    assert.equal(f.timers.size, 0);
  }
});

test("closing the window cancels the timer and observers", () => {
  const f = fixture(),
    t = f.tab();
  f.manager.setEssentialTabIcon(t);
  f.window.listeners.get("unload")();
  assert.equal(f.timers.size, 0);
  assert.equal(f.observers.size, 0);
  assert.equal(f.manager._calendarFavorites.size, 0);
});

test("local midnight handles the 23 and 25 hour daylight-saving days", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    for (const [date, hours] of [
      ["2026-03-08T00:00:00", 23],
      ["2026-11-01T00:00:00", 25],
    ]) {
      const f = fixture(date);
      f.manager.setEssentialTabIcon(f.tab());
      assert.equal([...f.timers.values()][0].delay, hours * 3600000);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
