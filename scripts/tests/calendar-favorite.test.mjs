import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { favoriteAppArtwork } from "../../src/zen/tabs/ZenFavoriteArtwork.sys.mjs";

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
    gBrowser: { tabContainer, getTabForBrowser: browser => browser.tab },
    BrowserUIUtils: { checkEmptyPageOrigin: () => true },
    nsZenDOMOperatedFeature: class {},
    ChromeUtils: { importESModule: () => ({ favoriteAppArtwork }) },
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

test("an unloaded Calendar keeps its site favicon across midnight, focus and time zone changes", () => {
  const f = fixture("2026-11-01T23:59:00"), t = f.tab();
  t.setAttribute("image", "site-supplied-day-1");
  t.setAttribute("pending", "true");
  f.manager.setEssentialTabIcon(t);
  f.time("2026-11-03T12:00:00");
  f.manager.setEssentialTabIcon(t);
  assert.equal(t.getAttribute("image"), "site-supplied-day-1");
  assert.equal(t.properties.get("--zen-essential-tab-icon"), 'url("site-supplied-day-1")');
  assert.equal(t.hasAttribute("zen-favorite-icon-override"), false);
  assert.equal(t.hasAttribute("zen-favorite-app-icon"), false);
  assert.equal(t.hasAttribute("zen-calendar-day"), false);
  assert.equal(t.hasAttribute("pending"), true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.observers.size, 0);
  assert.equal(f.window.listeners.size, 0);
});

test("Calendar accepts a new favicon supplied by the page and refreshes the selected outline", () => {
  const f = fixture(), t = f.tab();
  const icons = [];
  f.manager._favoriteOutline = { invalidate: (_tab, icon) => icons.push(icon) };
  t.setAttribute("image", "site-supplied-day-1");
  f.manager.setEssentialTabIcon(t);
  f.manager.setEssentialTabIcon(t, "site-supplied-day-3");
  assert.equal(icons.at(-1), "site-supplied-day-3");
  assert.equal(t.properties.get("--zen-essential-tab-icon"), 'url("site-supplied-day-3")');
  assert.equal(t.hasAttribute("zen-favorite-icon-override"), false);
  t.setAttribute("image", "site-supplied-day-3");
  f.manager.setEssentialTabIcon(t);
  assert.equal(t.getAttribute("image"), "site-supplied-day-3");
  assert.equal(t.hasAttribute("zen-calendar-day"), false);
});

test("a Favorite keeps saved artwork when Gecko supplies a missing or error icon", () => {
  const f=fixture(),t=f.tab("https://arbitrary.fixture.test/");
  const saved='data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E';
  t._zenPinnedInitialState.image=saved;
  const invalidations=[];
  f.manager._favoriteOutline={invalidate:(_tab,icon)=>invalidations.push(icon)};
  for (const icon of ["",null,"chrome://global/skin/icons/defaultFavicon.svg","chrome://global/skin/icons/info.svg"]) {
    t.setAttribute("image",icon??"");
    f.manager.setEssentialTabIcon(t,icon);
    assert.equal(t.hasAttribute("zen-favorite-icon-override"),true);
    assert.equal(t.properties.get("--zen-essential-tab-icon"),`url(${JSON.stringify(saved)})`);
    assert.equal(t.getAttribute("image"),icon??"");
    assert.equal(invalidations.at(-1),saved);
    assert.equal(t.zenStaticIcon,undefined);
  }
});


test("a real favicon update removes the saved-artwork override even before the image attribute updates", () => {
  const f=fixture(),t=f.tab("https://arbitrary.fixture.test/");
  t._zenPinnedInitialState.image="saved-icon";
  t.setAttribute("image","chrome://global/skin/icons/info.svg");
  f.manager.setEssentialTabIcon(t);
  f.manager.setEssentialTabIcon(t,"new-site-icon");
  assert.equal(t.hasAttribute("zen-favorite-icon-override"),false);
  assert.equal(t.properties.get("--zen-essential-tab-icon"),'url("new-site-icon")');
  assert.equal(t._zenPinnedInitialState.image,"saved-icon");
});


test("custom artwork wins over the saved fallback and removing it restores the saved artwork", () => {
  const f=fixture(),t=f.tab("https://arbitrary.fixture.test/");
  t._zenPinnedInitialState.image="saved-icon";
  t.setAttribute("image","chrome://global/skin/icons/info.svg");
  t.zenStaticIcon="custom-icon";
  f.manager.setEssentialTabIcon(t);
  assert.equal(t.properties.get("--zen-essential-tab-icon"),'url("custom-icon")');
  assert.equal(t.hasAttribute("zen-essential-site"),false);
  delete t.zenStaticIcon;
  f.manager.setEssentialTabIcon(t);
  assert.equal(t.properties.get("--zen-essential-tab-icon"),'url("saved-icon")');
  t._zenPinnedInitialState.image="chrome://global/skin/icons/info.svg";
  f.manager.setEssentialTabIcon(t);
  assert.equal(t.hasAttribute("zen-favorite-icon-override"),false);
});


test("app artwork follows the current destination, preserves custom icons, and clears when disabled", () => {
  const f = fixture(), t = f.tab("https://twitter.com/");
  f.manager.setEssentialTabIcon(t);
  assert.equal(t.getAttribute("zen-favorite-app-icon"), "twitter");
  assert.match(t.properties.get("--zen-favorite-app-icon-dark"), /twitter-dark\.svg/);
  t.linkedBrowser.currentURI.spec = "https://x.com/";
  f.manager.setEssentialTabIcon(t);
  assert.equal(t.hasAttribute("zen-favorite-app-icon"), false);
  assert.equal(t.getAttribute("image"), "original-favicon");
  t.linkedBrowser.currentURI.spec = "https://twitter.com/";
  t.zenStaticIcon = "custom-icon";
  f.manager.setEssentialTabIcon(t);
  assert.equal(t.hasAttribute("zen-favorite-app-icon"), false);
  assert.equal(t.properties.has("--zen-favorite-app-icon-dark"), false);
  delete t.zenStaticIcon;
  f.manager.setEssentialTabIcon(t);
  assert.equal(t.getAttribute("zen-favorite-app-icon"), "twitter");
  t.linkedBrowser.currentURI.spec = "https://music.youtube.com/";
  f.manager.setEssentialTabIcon(t);
  assert.equal(t.hasAttribute("zen-favorite-app-icon"), false);
  t.linkedBrowser.currentURI.spec = "https://youtube.com/";
  f.manager.setEssentialTabIcon(t);
  assert.equal(t.getAttribute("zen-favorite-app-icon"), "youtube");
  t.removeAttribute("zen-essential");
  f.manager.setEssentialTabIcon(t);
  assert.equal(t.hasAttribute("zen-favorite-app-icon"), false);
});

test("app artwork falls back to the saved URL only when the browser has no current URL", () => {
  const f = fixture(), t = f.tab("https://youtube.com/");
  t.linkedBrowser.currentURI = null;
  f.manager.setEssentialTabIcon(t);
  assert.equal(t.getAttribute("zen-favorite-app-icon"), "youtube");
  t.linkedBrowser.currentURI = { spec: "about:blank" };
  f.manager.setEssentialTabIcon(t);
  assert.equal(t.hasAttribute("zen-favorite-app-icon"), false);
  t.linkedBrowser.currentURI.spec = "https://mail.google.com/mail/";
  t.setAttribute("pending", "true");
  f.manager.setEssentialTabIcon(t);
  assert.equal(t.getAttribute("zen-favorite-app-icon"), "gmail");
  assert.equal(t.hasAttribute("pending"), true);
});

test("top-level navigation refreshes app artwork and its outline without a favicon change", () => {
  const f = fixture(), t = f.tab("https://mail.google.com/mail/");
  t.linkedBrowser.tab = t;
  f.manager.setEssentialTabIcon(t);
  const invalidations = [];
  f.manager._favoriteOutline = { invalidate: tab => invalidations.push(tab) };
  const navigate = (spec, isTopLevel = true) =>
    f.manager.onLocationChange(t.linkedBrowser, { isTopLevel }, null, { spec });
  navigate("https://mail.google.com/chat/", false);
  assert.equal(t.getAttribute("zen-favorite-app-icon"), "gmail");
  assert.equal(invalidations.length, 0);
  navigate("https://mail.google.com/chat/");
  assert.equal(t.hasAttribute("zen-favorite-app-icon"), false);
  assert.equal(invalidations.length, 1);
  navigate("https://mail.google.com/mail/");
  assert.equal(t.getAttribute("zen-favorite-app-icon"), "gmail");
  assert.equal(invalidations.length, 2);
  navigate("https://mail.google.com/mail/#inbox");
  assert.equal(invalidations.length, 2);
  navigate("about:blank");
  assert.equal(t.hasAttribute("zen-favorite-app-icon"), false);
  assert.equal(invalidations.length, 3);
  t.zenStaticIcon = "custom-icon";
  f.manager.setEssentialTabIcon(t);
  navigate("https://youtube.com/");
  assert.equal(t.hasAttribute("zen-favorite-app-icon"), false);
  assert.equal(t.properties.get("--zen-essential-tab-icon"), 'url("custom-icon")');
  assert.equal(t.getAttribute("image"), "original-favicon");
});
