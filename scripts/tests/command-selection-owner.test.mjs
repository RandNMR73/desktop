import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { commandSelectionContext, commandSelectionOwner } from "../../src/zen/urlbar/ZenCommandSelectionCapture.sys.mjs";

const managerSource = readFileSync(new URL("../../src/zen/spaces/ZenSpaceManager.mjs", import.meta.url), "utf8");
// Exercise the existing resolver against the actual native manager getters,
// rather than duplicate the new guard's mode predicates in the reference.
function member(signature) {
  const start = managerSource.indexOf(`  ${signature} {`);
  assert.notEqual(start, -1, signature);
  const open = managerSource.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < managerSource.length; i++) {
    if (managerSource[i] === "{") depth++;
    else if (managerSource[i] === "}" && --depth === 0) return managerSource.slice(start, i + 1);
  }
  assert.fail("Unterminated native member: " + signature);
}
const nativeMembers = ["get shouldHaveWorkspaces()", "get isPrivateWindow()",
  "get currentWindowIsSyncing()", "get privateWindowOrDisabled()", "get workspaceEnabled()",
  "getWorkspaces(lieToMe = false)"].map(member).join("\n");

function fixture(options = {}) {
  const { chromeFlags = 1, documentURI = "chrome://browser/content/browser.xhtml" } = options;
  const container = Object.hasOwn(options, "container") ? options.container : 7;
  const attributes = new Set(), calls = { privacy: 0, clones: 0, chromeFlags: 0 };
  const root = { hasAttribute: name => attributes.has(name) };
  const document = { documentURI, documentElement: root };
  const window = { closed: false, document, private: false,
    docShell: { treeOwner: { QueryInterface: () => ({ getInterface: () => {
      calls.chromeFlags++; return { chromeFlags };
    } }) } } };
  const isPrivateWindow = value => { calls.privacy++; return value.private; };
  const PrivateBrowsingUtils = { isWindowPrivate: isPrivateWindow };
  const Ci = { nsIInterfaceRequestor: {}, nsIAppWindow: {},
    nsIWebBrowserChrome: { CHROME_TOOLBAR: 1, CHROME_MENUBAR: 2 } };
  const Manager = new Function("window", "document", "PrivateBrowsingUtils", "Ci",
    `return class { ${nativeMembers} };`)(window, document, PrivateBrowsingUtils, Ci);
  const manager = new Manager();
  manager._workspaceCache = [{ uuid: "first", containerTabId: container },
    { uuid: "same-profile", containerTabId: container }, { uuid: "other", containerTabId: 19 }];
  manager.activeWorkspace = "first";
  const getWorkspaces = manager.getWorkspaces;
  manager.getWorkspaces = function (...args) { calls.clones++; return getWorkspaces.apply(this, args); };
  window.gZenWorkspaces = manager;
  const query = { isPrivate: false };
  const reference = () => commandSelectionContext(window,
    { isPrivate: query.isPrivate, isPrivateWindow: isPrivateWindow(window) });
  return { window, query, manager, root, document, attributes, calls, isPrivateWindow, reference };
}

function create(f) { return commandSelectionOwner(f.window, f.query, f.isPrivateWindow); }
function parity(f, owner, label) {
  const live = f.reference();
  assert.equal(owner.current(), !!owner.context && !!live && live.container === owner.context.container, label);
}

test("loaded native getter modes agree with the original resolver", () => {
  let cases = 0;
  for (const chromeFlags of [0, 1, 2]) for (const container of [undefined, null, 0, "0", 7, "7", -1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    for (const taskbar of [false, true]) for (const unsynced of [false, true]) for (const flag of [undefined, "synced", "unsynced"]) {
      const f = fixture({ chromeFlags, container });
      if (taskbar) f.attributes.add("taskbartab");
      if (unsynced) f.attributes.add("zen-unsynced-window");
      f.window._zenStartupSyncFlag = flag;
      const expected = f.reference(), owner = create(f);
      assert.deepEqual(owner.context, expected);
      parity(f, owner, JSON.stringify({ chromeFlags, container, taskbar, unsynced, flag }));
      cases++;
    }
  }
  assert.equal(cases, 360);
});

test("live mode transitions preserve the default profile zero semantics", () => {
  for (const container of [0, 7]) {
    const f = fixture({ container }), owner = create(f);
    for (const attribute of ["taskbartab", "zen-unsynced-window"]) {
      f.attributes.add(attribute); parity(f, owner, attribute + " enabled");
      assert.equal(owner.current(), container === 0);
      f.attributes.delete(attribute); parity(f, owner, attribute + " removed");
    }
    f.window._zenStartupSyncFlag = "unsynced"; parity(f, owner, "startup unsynced");
    f.window._zenStartupSyncFlag = "synced"; parity(f, owner, "startup synced");
    f.manager._shouldHaveWorkspaces = 0; parity(f, owner, "no toolbar");
    f.manager._shouldHaveWorkspaces = 2; parity(f, owner, "menubar restored");
  }
});

test("in-place record replacement and container deletion are read live", () => {
  const f = fixture(), owner = create(f), original = f.manager._workspaceCache[0];
  f.manager._workspaceCache[0] = { uuid: "first", containerTabId: 19 };
  parity(f, owner, "saveWorkspace replaced object in same array"); assert.equal(owner.current(), false);
  original.containerTabId = 7;
  assert.equal(owner.current(), false, "detached original cannot keep the owner valid");
  f.manager._workspaceCache[0].containerTabId = 7; parity(f, owner, "live same profile");
  f.manager._workspaceCache[0].containerTabId = 0;
  parity(f, owner, "onContainerDeleted mutation"); assert.equal(owner.current(), false);
  const defaultOwner = create(f);
  assert.equal(defaultOwner.context.container, 0); assert.equal(defaultOwner.current(), true);
});

test("array replacement, splice and reordered membership do not use a saved index", () => {
  const f = fixture(), owner = create(f);
  f.manager._workspaceCache.splice(0, 0, { uuid: "inserted", containerTabId: 88 });
  parity(f, owner, "insert before active"); assert.equal(owner.current(), true);
  f.manager._workspaceCache.reverse(); parity(f, owner, "reorder");
  f.manager._workspaceCache = f.manager._workspaceCache.map(space => ({ ...space }));
  parity(f, owner, "array and records replaced"); assert.equal(owner.current(), true);
  f.manager._workspaceCache = f.manager._workspaceCache.filter(space => space.uuid !== "first");
  parity(f, owner, "active Space deleted"); assert.equal(owner.current(), false);
});

test("different Spaces with the same container remain eligible, regardless of tab container", () => {
  const f = fixture(), owner = create(f);
  f.window.gBrowser = { selectedTab: { userContextId: 999 } };
  f.manager.activeWorkspace = "same-profile";
  parity(f, owner, "same profile new Space"); assert.equal(owner.current(), true);
  f.manager.activeWorkspace = "other";
  parity(f, owner, "different profile"); assert.equal(owner.current(), false);
  f.manager.activeWorkspace = "first";
  f.window.gBrowser.selectedTab.userContextId = 0;
  parity(f, owner, "same profile different selected tab"); assert.equal(owner.current(), true);
});

test("container coercion and invalid values match the existing resolver", () => {
  for (const initial of [0, 7]) {
    const f = fixture({ container: initial }), owner = create(f);
    for (const value of [undefined, null, "", "0", -0, "007", 7, 19, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      f.manager._workspaceCache[0].containerTabId = value;
      parity(f, owner, "container " + String(value));
    }
  }
});

test("missing active Space fails closed even when the expected profile is zero", () => {
  const f = fixture({ container: 0 }), owner = create(f);
  f.manager.activeWorkspace = "missing";
  parity(f, owner, "unresolved Space"); assert.equal(owner.current(), false);
  f.attributes.add("taskbartab");
  parity(f, owner, "disabled mode is explicitly profile zero"); assert.equal(owner.current(), true);
  f.attributes.delete("taskbartab"); assert.equal(owner.current(), false);
});

test("malformed live records and missing arrays follow the reference failure path", () => {
  const f = fixture(), owner = create(f), active = f.manager._workspaceCache[0];
  f.manager._workspaceCache = [null, active];
  parity(f, owner, "invalid record before active"); assert.equal(owner.current(), false);
  f.manager._workspaceCache = [active, null];
  parity(f, owner, "invalid later record is not inspected"); assert.equal(owner.current(), true);
  f.manager._workspaceCache = null;
  parity(f, owner, "missing cache"); assert.equal(owner.current(), false);
  f.manager._workspaceCache = [];
  parity(f, owner, "empty cache"); assert.equal(owner.current(), false);
});

test("manager, document and document-root replacement invalidate a loaded guard", () => {
  for (const replace of [f => { f.window.gZenWorkspaces = { ...f.manager }; },
    f => { f.window.document = { ...f.document }; },
    f => { f.document.documentElement = { ...f.root }; }]) {
    const f = fixture(), owner = create(f);
    replace(f); assert.equal(owner.current(), false);
  }
  const f = fixture(), owner = create(f);
  f.window.closed = true; assert.equal(owner.current(), false);
});

test("private, closed and unresolved initial owners cannot become reusable later", () => {
  for (const invalidate of [f => { f.window.private = true; }, f => { f.query.isPrivate = true; },
    f => { delete f.query.isPrivate; }, f => { f.window.closed = true; },
    f => { f.manager._workspaceCache = []; }]) {
    const f = fixture(); invalidate(f);
    const owner = create(f);
    assert.equal(owner.context, null); assert.equal(owner.current(), false);
    f.window.private = false; f.query.isPrivate = false; f.window.closed = false;
    f.manager._workspaceCache = [{ uuid: "first", containerTabId: 7 }];
    assert.equal(owner.current(), false, "a later valid state needs a new query owner");
    assert.equal(create(f).current(), true);
  }
  const missing = commandSelectionOwner(null, { isPrivate: false }, () => assert.fail("no privacy call for absent window"));
  assert.equal(missing.context, null); assert.equal(missing.current(), false);
});

test("live private query flags are checked even on the loaded fast path", () => {
  const f = fixture(), owner = create(f);
  for (const value of [true, undefined, null, 0]) {
    f.query.isPrivate = value; assert.equal(owner.current(), false);
  }
  f.query.isPrivate = false; assert.equal(owner.current(), true);
});

test("blank and unknown document shapes keep live privacy and profile resolution", () => {
  for (const documentURI of ["about:blank", "about:config", undefined]) {
    const f = fixture({ documentURI });
    if (documentURI === undefined) delete f.document.documentURI;
    const owner = create(f), before = { ...f.calls };
    assert.equal(owner.current(), true);
    assert.ok(f.calls.privacy > before.privacy); assert.ok(f.calls.clones > before.clones);
    f.window.private = true; parity(f, owner, "fallback privacy changed"); assert.equal(owner.current(), false);
    f.window.private = false; f.manager._workspaceCache[0].containerTabId = 19;
    parity(f, owner, "fallback profile changed"); assert.equal(owner.current(), false);
  }
});

test("unknown manager shapes retain the full resolver rather than assume profile zero", () => {
  for (const alter of [f => { f.manager._shouldHaveWorkspaces = true; },
    f => { f.manager._workspaceCache = new Set(f.manager._workspaceCache); },
    f => { delete f.window.document; }]) {
    const f = fixture(); f.reference(); alter(f);
    const owner = create(f), before = { ...f.calls };
    assert.equal(owner.context.container, 7); assert.equal(owner.current(), true);
    assert.ok(f.calls.clones > before.clones); assert.ok(f.calls.privacy > before.privacy);
  }
  const f = fixture({ container: 0 }); delete f.window.gZenWorkspaces;
  const owner = create(f); assert.equal(owner.context.container, 0);
  f.window.gZenWorkspaces = f.manager; f.manager._workspaceCache[0].containerTabId = 7;
  parity(f, owner, "manager appears after initial default-mode context"); assert.equal(owner.current(), false);
});

test("a loaded guard falls back if its live manager shape becomes unsupported", () => {
  const f = fixture(), owner = create(f);
  f.manager._workspaceCache = new Set(f.manager._workspaceCache);
  const before = { ...f.calls };
  parity(f, owner, "live iterable replacement"); assert.equal(owner.current(), true);
  assert.ok(f.calls.privacy > before.privacy); assert.ok(f.calls.clones > before.clones);
  f.manager._workspaceCache = [...f.manager._workspaceCache];
  f.manager._shouldHaveWorkspaces = true;
  parity(f, owner, "unsupported toolbar flag type"); assert.equal(owner.current(), true);
});

test("loaded lookups avoid additional privacy calls and cloned Space lists", () => {
  for (const container of [0, 7]) {
    const f = fixture({ container }), owner = create(f), before = { ...f.calls };
    assert.ok(before.privacy > 0 && before.clones > 0 && before.chromeFlags === 1);
    for (let i = 0; i < 400; i++) assert.equal(owner.current(), true);
    assert.deepEqual(f.calls, before, "work counts only; no timing inference");
  }
});
