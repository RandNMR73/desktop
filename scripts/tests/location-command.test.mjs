/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../../src/zen/urlbar/ZenUrlbarController.mjs", import.meta.url), "utf8")
  .replace(/^import .*UrlbarShared.*;$/m, "")
  .replace("export class nsZenUrlbarController", "globalThis.Controller = class nsZenUrlbarController");
function fixture() {
  const attrs = new Map(), timers = new Map(), events = [], buttons = new Set(), styles = new Map(), observers = [], positionObservers = [];
  let serial = 0, controller, commands = 0, closed = 0, focusedPage = 0, clearedCache = 0, queries = 0;
  const tab = { closing: false, documentGlobal: { closed: false }, _visuallySelected: true, hasAttribute: () => false };
  const bar = {
    value: "https://example.com/path", _untrimmedValue: "https://example.com/path", focused: true,
    valueIsTyped: false, searchMode: null, style: { setProperty(k,v) { styles.set(k,v); }, removeProperty(k) { styles.delete(k); } },
    inputField: {},
    view: { isOpen: true, queryContextCache: { clearTopSitesCache() { clearedCache++; } }, close() { this.isOpen = false; closed++; controller.onUrlbarClose(); } },
    hasAttribute: name => attrs.has(name), getAttribute: name => attrs.get(name),
    setAttribute: (name, value) => attrs.set(name, String(value)), removeAttribute: name => attrs.delete(name),
    toggleAttribute(name, value) { if (value) attrs.set(name, ""); else attrs.delete(name); },
    setPageProxyState(value) { attrs.set("pageproxystate", value); },
    search(value) { this.value = value; this._untrimmedValue = value; this.view.isOpen = true; },
    setValue(value) { this.value = value; this._untrimmedValue = value; this.valueIsTyped = false; },
    setSelectionRange(start, end) { this.selection = [start, end]; },
    select() { this.selection = [0, this.value.length]; },
    handleRevert() { this.searchMode = null; this.valueIsTyped = false; this.setValue("https://example.com/path"); this.setPageProxyState("valid"); },
    updateTextOverflow() {}, startQuery() { queries++; },
  };
  const event = () => ({ prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });
  const browser = { selectedTab: tab, selectedBrowser: { focus() { focusedPage++; }, currentURI: { displaySpec: "https://example.com/path", schemeIs: s => s === "https" } } };
  const context = vm.createContext({
    gURLBar: bar, gBrowser: browser,
    gNavToolbox: { querySelectorAll: () => [{ setAttribute: name => buttons.add(name), removeAttribute: name => buttons.delete(name) }] },
    gZenUIManager: { testingEnabled: false },
    gZenVerticalTabsManager: { _canReplaceNewTab: true, _hasSetSingleToolbar: true },
    document: { documentElement: { hasAttribute: () => false }, l10n: { setAttributes() {} }, getElementById: () => ({ doCommand() { commands++; const e = event(); controller.handleLocationCommand(e); assert.equal(e.prevented, false, "internal new-tab command must pass through"); } }) },
    Services: { io: { createExposableURI: value => value }, prefs: { getBoolPref: () => true } },
    UrlbarShared: { RESULT_SOURCE: { TABS: 4 } },
    XPCOMUtils: { defineLazyPreferenceGetter(target, name, key, value) { target[name] = value; } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    setTimeout(fn) { timers.set(++serial, fn); return serial; }, clearTimeout(id) { timers.delete(id); },
    window: { dispatchEvent(e) { events.push(e); }, cancelAnimationFrame() {}, MutationObserver: class { constructor(callback) { this.callback=callback; positionObservers.push(this); } observe(anchor,options) { this.anchor=anchor; this.options=options; } disconnect() { this.disconnected=true; } }, ResizeObserver: class { constructor(callback) { this.callback=callback; observers.push(this); } observe(anchor) { this.anchor=anchor; } disconnect() { this.disconnected=true; } } }, console,
  });
  vm.runInContext(source, context); controller = new context.Controller();
  const flush = () => { while (timers.size) { const [id, fn] = timers.entries().next().value; timers.delete(id); fn(); } };
  return { controller, bar, browser, tab, context, events, buttons, styles, observers, positionObservers, flush, command() { const e = event(); controller.handleLocationCommand(e); return e; }, newtab() { const token = {}; assert.equal(controller.handleNewTab(false, false, "tab", false, token), true); return token; }, get queries() { return queries; }, get clearedCache() { return clearedCache; }, get commands() { return commands; }, get closed() { return closed; }, get focusedPage() { return focusedPage; } };
}
test("repeated location command closes even after a typed query and returns focus to page", () => {
  const f = fixture(); f.bar.value = "changed query"; f.bar.valueIsTyped = true;
  const e = f.command(); assert.ok(e.prevented && e.stopped); assert.equal(f.closed, 1); assert.equal(f.focusedPage, 1); assert.equal(f.bar.value, "https://example.com/path");
});
test("new-tab command is not intercepted; conversion retires ownership without closing the popover", () => {
  const f = fixture(); const token = f.newtab(); const oldClose = f.bar._zenHandleUrlbarClose;
  assert.equal(f.commands, 1); assert.equal(f.tab._visuallySelected, false);
  assert.ok(f.command().prevented); f.flush();
  assert.equal(f.closed, 0); assert.equal(f.controller.isOwner(token.id), false); assert.equal(f.bar._zenHandleUrlbarClose, null);
  assert.equal(f.bar.value, "example.com/path"); assert.deepEqual(f.bar.selection, [0, 16]); assert.ok(f.bar.hasAttribute("zen-arc-address-preview")); assert.ok(!f.bar.hasAttribute("zen-newtab"));
  assert.ok(f.tab._visuallySelected); assert.equal(f.buttons.size, 0); assert.equal(f.events[0].detail.closeSeq, token.id);
  oldClose(); f.flush(); assert.equal(f.closed, 0, "old callback cannot close converted address view");
});
test("a stale close callback cannot clear a newer new-tab close handler", () => {
  const f = fixture(); f.newtab(); const staleClose = f.bar._zenHandleUrlbarClose; f.command(); f.flush();
  const next = f.newtab(); const currentClose = f.bar._zenHandleUrlbarClose; staleClose(); f.flush();
  assert.equal(f.bar._zenHandleUrlbarClose, currentClose); assert.ok(f.controller.isOwner(next.id)); assert.ok(f.bar.hasAttribute("zen-newtab")); assert.equal(f.closed, 0);
});
test("conversion starts one replacement query before returning to the event loop", () => {
  const f = fixture(); f.newtab(); f.command();
  assert.equal(f.queries, 1);
  assert.ok(f.bar.hasAttribute("zen-arc-address-preview"));
  assert.equal(f.bar.value, "example.com/path");
  f.flush(); assert.equal(f.queries, 1, "no duplicate deferred query");
});
test("a queued old close does not overwrite the converted address", () => {
  const f = fixture(); f.newtab(); f.bar._zenHandleUrlbarClose(); f.command(); f.flush();
  assert.equal(f.bar.value, "example.com/path"); assert.ok(f.bar.view.isOpen); assert.ok(!f.bar.hasAttribute("zen-newtab"));
});
test("conversion clears a cancelled query before the next new-tab invocation", () => {
  const f = fixture(); f.newtab(); f.bar.value = f.bar._untrimmedValue = "discard me"; f.command(); f.flush(); f.command();
  f.newtab(); assert.equal(f.bar.value, ""); assert.equal(f.commands, 2);
});
test("closed, unfocused, Little, empty split and non-single-toolbar views use normal location handling", () => {
  for (const change of [f => f.bar.view.isOpen = false, f => f.bar.focused = false, f => f.context.window._zenLittleWindow = true, f => f.tab.hasAttribute = name => name === "zen-empty-tab", f => f.context.gZenVerticalTabsManager._hasSetSingleToolbar = false]) {
    const f = fixture(); change(f); const e = f.command(); assert.ok(!e.prevented && !e.stopped); assert.equal(f.closed, 0);
  }
});

test("fresh location command prepares the current page before the first query and drops only Top Sites cache", () => {
  const f = fixture(); f.bar.view.isOpen = false; f.bar.focused = false; f.bar.setPageProxyState("valid");
  const e = f.command();
  assert.ok(!e.prevented && !e.stopped, "Firefox still owns focus and the first query");
  assert.ok(f.bar.hasAttribute("zen-arc-address-preview"));
  assert.ok(f.bar.hasAttribute("zen-arc-open-tabs"));
  assert.equal(f.bar.searchMode, null); assert.equal(f.clearedCache, 1);
  assert.equal(f.bar.value, "https://example.com/path"); assert.equal(f.closed, 0);
});
test("typed and explicit-mode location commands retain their query and cache", () => {
  for (const change of [f => f.bar.valueIsTyped = true, f => f.bar.searchMode = { engineName: "Fixture" }]) {
    const f = fixture(); f.bar.view.isOpen = false; f.bar.setPageProxyState("valid"); change(f); f.command();
    assert.equal(f.clearedCache, 0); assert.ok(!f.bar.hasAttribute("zen-arc-address-preview"));
  }
});

test("Developer address preview follows its live pane and releases resize observation for new-tab searches", () => {
  const f=fixture(), rect={left:228,top:8,width:1200};
  const anchor={isConnected:true,closest:()=>null,getBoundingClientRect:()=>rect};
  f.context.window.gZenDeveloperMode={addressEditorAnchor:browser=>browser===f.browser.selectedBrowser?anchor:null};
  f.bar.view.isOpen=false;f.bar.setPageProxyState('valid');f.command();
  assert.ok(f.bar.hasAttribute('zen-developer-url-editor'));
  assert.equal(f.styles.get('--arc-developer-editor-left'),'228px');
  assert.equal(f.styles.get('--arc-developer-editor-width'),'1200px');
  f.bar.view.isOpen=true;f.controller.onUrlbarOpen();f.flush();
  assert.equal(f.observers.length,1,'opening the prepared view reuses its observer');
  rect.width=600;f.observers[0].callback();
  assert.equal(f.styles.get('--arc-developer-editor-width'),'600px');
  f.newtab();assert.ok(!f.bar.hasAttribute('zen-developer-url-editor'));
  assert.ok(f.observers[0].disconnected);assert.ok(!f.styles.has('--arc-developer-editor-width'));
  f.command();assert.ok(f.bar.hasAttribute('zen-developer-url-editor'));
  f.controller.onUrlbarClose();assert.ok(f.observers[1].disconnected);
});
test("removing the Developer pane closes its obsolete address editor", () => {
  const f=fixture(),anchor={isConnected:true,closest:()=>null,getBoundingClientRect:()=>({left:228,top:8,width:600})};
  f.context.window.gZenDeveloperMode={addressEditorAnchor:()=>anchor};
  f.bar.view.isOpen=false;f.bar.setPageProxyState('valid');f.command();f.bar.view.isOpen=true;
  anchor.isConnected=false;f.observers[0].callback();
  assert.equal(f.closed,1);assert.ok(f.observers[0].disconnected);assert.ok(!f.bar.hasAttribute('zen-developer-url-editor'));
});

test("same-sized split pane movement updates the anchor and releases its observer", () => {
  const f=fixture(),rect={left:400,top:8,width:400},pane={getAnimations:()=>[]};
  const anchor={isConnected:true,closest:()=>pane,getBoundingClientRect:()=>rect};
  f.context.window.gZenDeveloperMode={addressEditorAnchor:()=>anchor};
  f.bar.view.isOpen=false;f.bar.setPageProxyState('valid');f.command();
  assert.equal(f.positionObservers[0].anchor,pane);
  assert.deepEqual(Array.from(f.positionObservers[0].options.attributeFilter),['style']);
  rect.left=500;f.positionObservers[0].callback();
  assert.equal(f.styles.get('--arc-developer-editor-left'),'500px');
  f.newtab();assert.ok(f.positionObservers[0].disconnected);
});

test("pane animation tracking stops at rest and is cancelled when the editor closes", () => {
  const f=fixture(),rect={left:400,top:8,width:400},frames=new Map();let running=true,id=0;
  const pane={getAnimations:()=>running?[{playState:'running'}]:[]};
  const anchor={isConnected:true,closest:()=>pane,getBoundingClientRect:()=>rect};
  f.context.window.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};
  f.context.window.cancelAnimationFrame=id=>frames.delete(id);
  f.context.window.gZenDeveloperMode={addressEditorAnchor:()=>anchor};
  f.bar.view.isOpen=false;f.bar.setPageProxyState('valid');f.command();
  assert.equal(frames.size,1);
  const tick=()=>{const [id,fn]=frames.entries().next().value;frames.delete(id);fn();};
  rect.left=450;tick();assert.equal(f.styles.get('--arc-developer-editor-left'),'450px');assert.equal(frames.size,1);
  running=false;rect.left=500;tick();assert.equal(f.styles.get('--arc-developer-editor-left'),'500px');assert.equal(frames.size,0);
  running=true;f.positionObservers[0].callback();assert.equal(frames.size,1);
  f.controller.onUrlbarClose();assert.equal(frames.size,0);assert.ok(f.positionObservers[0].disconnected);
});


test("Developer conversion preserves the full HTTPS address and selects its entire value", () => {
  const f = fixture();
  const anchor = {isConnected: true, closest: () => null,
    getBoundingClientRect: () => ({left: 228, top: 8, width: 1200})};
  f.context.window.gZenDeveloperMode = {addressEditorAnchor: () => anchor};
  const token = f.newtab();
  f.command();
  assert.equal(f.bar.value, "https://example.com/path");
  assert.deepEqual(f.bar.selection, [0, 24]);
  assert.ok(f.bar.hasAttribute("zen-developer-url-editor"));
  assert.equal(f.controller.isOwner(token.id), false);
  assert.equal(f.queries, 1);
  f.flush();
  assert.equal(f.bar.value, "https://example.com/path");
  assert.equal(f.queries, 1);
});
