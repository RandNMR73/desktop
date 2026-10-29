import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = fs.readFileSync(
  new URL(
    "../../src/zen/urlbar/ZenAutoPictureInPicture.sys.mjs",
    import.meta.url,
  ),
  "utf8",
);
const enabledPref =
  "media.videocontrols.picture-in-picture.enable-when-switching-tabs.enabled";

function principal(spec, attrs = {}) {
  const url = new URL(spec);
  const originAttributes = { userContextId: 0, privateBrowsingId: 0, ...attrs };
  return {
    isContentPrincipal: true,
    URI: { spec, schemeIs: (scheme) => url.protocol === `${scheme}:` },
    originAttributes,
    origin: url.origin + JSON.stringify(originAttributes),
  };
}

function fixture() {
  const values = new Map(),
    prefs = new Map(),
    observers = [];
  let writes = 0;
  // Match Gecko's default permission-key normalization, which does not isolate
  // ordinary permission types by container even for exact-principal lookups.
  const permissionKey = (p, type) =>
    new URL(p.URI.spec).origin +
    JSON.stringify({ ...p.originAttributes, userContextId: 0 }) +
    "|" +
    type;
  const services = {
    prefs: { getBoolPref: (key, fallback) => prefs.get(key) ?? fallback },
    obs: {
      addObserver: (observer, topic) => observers.push([observer, topic]),
    },
    perms: {
      DENY_ACTION: 2,
      EXPIRE_NEVER: 0,
      testExactPermissionFromPrincipal: (p, type) =>
        values.get(permissionKey(p, type)) ?? 0,
      addFromPrincipal(p, key, value) {
        values.set(permissionKey(p, key), value);
        writes++;
      },
      removeFromPrincipal(p, key) {
        values.delete(permissionKey(p, key));
        writes++;
      },
    },
    scriptSecurityManager: {
      createContentPrincipal: (uri, attrs) => principal(uri.spec, attrs),
    },
  };
  const load = () =>
    vm.runInNewContext(
      source.replaceAll("export ", "") + "\nZenAutoPictureInPicture",
      { Services: services },
    );
  return {
    policy: load(),
    load,
    prefs,
    values,
    get writes() {
      return writes;
    },
    browser: (spec = "https://video.example/watch", attrs) => ({
      isConnected: true,
      contentPrincipal: principal(spec, attrs),
    }),
    closePrivate: () =>
      observers.forEach(([o, topic]) => o.observe(null, topic)),
  };
}

test("HTTP sites default to automatic PiP; unsupported and detached documents do not", () => {
  const f = fixture();
  assert.equal(f.policy.allowed(f.browser()), true);
  for (const spec of [
    "about:blank",
    "file:///video.webm",
    "data:text/html,test",
    "moz-extension://example/video",
  ])
    assert.equal(f.policy.allowed(f.browser(spec)), false);
  const b = f.browser();
  b.isConnected = false;
  assert.equal(f.policy.allowed(b), false);
  b.isConnected = true;
  b.contentPrincipal.isContentPrincipal = false;
  assert.equal(f.policy.allowed(b), false);
  assert.equal(f.policy.allowed(null), false);
});

test("site exclusions persist across policy reloads and stay exact-origin/container scoped", () => {
  const f = fixture(),
    b = f.browser();
  assert.equal(f.policy.setAllowed(b, false), true);
  assert.equal(
    f.load().allowed(f.browser("https://video.example/other")),
    false,
  );
  for (const other of [
    f.browser("http://video.example/"),
    f.browser("https://sub.video.example/"),
    f.browser("https://video.example:8443/"),
    f.browser(undefined, { userContextId: 4 }),
  ])
    assert.equal(f.policy.allowed(other), true);
  assert.equal(f.policy.setAllowed(b, true), true);
  assert.equal(f.values.size, 0);
  assert.equal(f.load().allowed(b), true);
});

test("private overrides inherit regular choices without writing or leaking on private-context exit", () => {
  const f = fixture(),
    normal = f.browser(undefined, { userContextId: 3 });
  f.policy.setAllowed(normal, false);
  const privateTab = f.browser(undefined, {
    userContextId: 3,
    privateBrowsingId: 1,
  });
  assert.equal(f.policy.allowed(privateTab), false);
  const writes = f.writes;
  f.policy.setAllowed(privateTab, true);
  assert.equal(f.policy.allowed(privateTab), true);
  assert.equal(f.policy.allowed(normal), false);
  assert.equal(f.writes, writes);
  f.closePrivate();
  assert.equal(f.policy.allowed(privateTab), false);
});

test("private exclusions stay private and container scoped", () => {
  const f = fixture(),
    privateTab = f.browser(undefined, { privateBrowsingId: 1 });
  f.policy.setAllowed(privateTab, false);
  assert.equal(f.policy.allowed(privateTab), false);
  assert.equal(f.policy.allowed(f.browser()), true);
  assert.equal(
    f.policy.allowed(
      f.browser(undefined, { privateBrowsingId: 1, userContextId: 8 }),
    ),
    true,
  );
  assert.equal(f.writes, 0);
  f.closePrivate();
  assert.equal(f.policy.allowed(privateTab), true);
});

test("global disabling remains authoritative and the site toggle cannot re-enable it", () => {
  for (const key of [
    enabledPref,
    "media.videocontrols.picture-in-picture.enabled",
  ]) {
    const f = fixture(),
      b = f.browser();
    f.prefs.set(key, false);
    assert.equal(f.policy.allowed(b), false);
    assert.equal(f.policy.setAllowed(b, true), false);
    assert.equal(f.policy.setAllowed(b, false), false);
    assert.equal(f.writes, 0);
    assert.equal(f.prefs.get(key), false);
  }
});

test("invalid toggle inputs cannot add permissions", () => {
  const f = fixture();
  for (const value of [null, undefined, 1, "true"])
    assert.equal(f.policy.setAllowed(f.browser(), value), false);
  assert.equal(f.policy.setAllowed(f.browser("about:blank"), true), false);
  assert.equal(f.writes, 0);
});

test("late automatic requests recheck selection, mute, lifetime and site policy", () => {
  const f = fixture(),
    browser = f.browser();
  const window = { closed: false, gBrowser: { selectedBrowser: {} } };
  browser.documentGlobal = window;
  assert.equal(f.policy.shouldDetach(browser), true);
  window.gBrowser.selectedBrowser = browser;
  assert.equal(f.policy.shouldDetach(browser), false);
  window.gBrowser.selectedBrowser = {};
  browser.audioMuted = true;
  assert.equal(f.policy.shouldDetach(browser), false);
  browser.audioMuted = false;
  f.policy.setAllowed(browser, false);
  assert.equal(f.policy.shouldDetach(browser), false);
  f.policy.setAllowed(browser, true);
  window.closed = true;
  assert.equal(f.policy.shouldDetach(browser), false);
  window.closed = false;
  browser.isConnected = false;
  assert.equal(f.policy.shouldDetach(browser), false);
  assert.equal(f.policy.shouldDetach(null), false);
});
