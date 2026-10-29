import assert from "node:assert/strict";
import test from "node:test";
import {
  developerSite,
  DeveloperModeSettings,
  DeveloperNavigation,
} from "../../src/zen/urlbar/ZenDeveloperModeState.mjs";

test("local development defaults do not match lookalike public domains", () => {
  for (const host of ["localhost", "sample.localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(developerSite(`http://${host}:8000/path`).automatic, true);
  }
  for (const host of [
    "localhost.example.com",
    "notlocalhost",
    "127.0.0.1.example.com",
  ]) {
    assert.equal(developerSite(`https://${host}`).automatic, false);
  }
  for (const spec of [
    "about:blank",
    "file:///tmp/a.html",
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.equal(developerSite(spec), null);
  }
});

test("settings survive reload, share paths, and isolate containers and origins", () => {
  let saved = "[]";
  const store = () =>
    new DeveloperModeSettings(
      () => saved,
      (value) => {
        saved = value;
      },
    );
  const a = developerSite("https://example.com/a", 4);
  store().set(a, true);
  const restored = store();
  assert.equal(
    restored.enabled(developerSite("https://example.com/b", 4)),
    true,
  );
  for (const site of [
    developerSite("https://example.com/b", 5),
    developerSite("http://example.com", 4),
    developerSite("https://example.com:4433", 4),
  ]) {
    assert.equal(restored.enabled(site), false);
  }
});

test("private decisions never write, remain private, and expire with the last private window", () => {
  let writes = 0;
  const settings = new DeveloperModeSettings(
    () => "[]",
    () => writes++,
  );
  const site = developerSite("http://localhost");
  settings.set(site, false, true);
  assert.equal(settings.enabled(site, true), false);
  assert.equal(settings.enabled(site, false), true);
  assert.equal(writes, 0);
  settings.reload("[]");
  assert.equal(settings.enabled(site, true), false);
  settings.clearPrivate();
  assert.equal(settings.enabled(site, true), true);
});

test("invalid saved entries and failed writes cannot corrupt effective settings", () => {
  const site = developerSite("https://example.com");
  for (const raw of ["oops", "{}", '[null,42,["oops",true]]']) {
    const settings = new DeveloperModeSettings(
      () => raw,
      () => {
        throw new Error("locked pref");
      },
    );
    assert.equal(settings.enabled(site), false);
    assert.throws(() => settings.set(site, true), /locked pref/);
    assert.equal(settings.enabled(site), false);
  }
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("resolving a URL cannot retarget it to a newly selected tab", async () => {
  const navigation = new DeveloperNavigation();
  const a = { currentURI: { spec: "https://a.test/" }, lastLocationChange: 1 };
  const b = { currentURI: { spec: "https://b.test/" }, lastLocationChange: 1 };
  let selected = a;
  const pending = deferred();
  const committed = [];
  const action = navigation.run(
    a,
    () => true,
    () => pending.promise,
    (url) => committed.push([a, url]),
  );
  selected = b;
  pending.resolve("https://a.test/next");
  assert.equal(await action, true);
  assert.equal(committed[0][0], a);
  assert.equal(selected, b);
});

test("newer submissions win; stale resolution after close, navigation or teardown is discarded", async () => {
  for (const mutation of [
    "submit",
    "close",
    "navigate",
    "same-uri",
    "destroy",
    "cancel",
  ]) {
    const navigation = new DeveloperNavigation();
    const browser = {
      currentURI: { spec: "https://a.test/" },
      lastLocationChange: 1,
    };
    let alive = true;
    const pending = deferred();
    const committed = [];
    const action = navigation.run(
      browser,
      () => alive,
      () => pending.promise,
      (value) => committed.push(value),
    );
    if (mutation === "submit")
      await navigation.run(
        browser,
        () => true,
        async () => "new",
        (value) => committed.push(value),
      );
    if (mutation === "close") alive = false;
    if (mutation === "navigate") browser.currentURI.spec = "https://b.test/";
    if (mutation === "same-uri") browser.lastLocationChange++;
    if (mutation === "destroy") navigation.clear();
    if (mutation === "cancel") navigation.cancel(browser);
    pending.resolve("old");
    assert.equal(await action, false, mutation);
    assert.deepEqual(committed, mutation === "submit" ? ["new"] : [], mutation);
  }
});
