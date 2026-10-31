import assert from "node:assert/strict";
import test from "node:test";
import { PREVIEW_SOURCES, PreviewDownloadRecords, ZenLibraryPreviewSources, ZenLibraryPreviewSourceMenu }
  from "../../src/zen/library/ZenLibraryPreviewSources.sys.mjs";

function preferences() {
  const values = new Map(), observers = new Set();
  return { values, observers,
    getBoolPref(name, fallback) { return values.get(name) ?? fallback; },
    setBoolPref(name, value) {
      if (values.get(name) === value) return;
      values.set(name, value);
      for (const observer of observers) observer.observe(null, "nsPref:changed", name);
    },
    addObserver(_prefix, observer) { observers.add(observer); },
    removeObserver(_prefix, observer) { observers.delete(observer); },
  };
}

test("source changes persist across windows and preserve independent checkboxes", () => {
  const prefs = preferences();
  let firstChanges = 0, secondChanges = 0;
  const first = new ZenLibraryPreviewSources(() => firstChanges++, prefs);
  const second = new ZenLibraryPreviewSources(() => secondChanges++, prefs);
  assert.deepEqual(Object.values(first.sources), [true, true, true, true, true]);
  assert.equal(Object.isFrozen(first.sources), true);
  first.set("desktop", false);
  assert.equal(second.sources.desktop, false);
  assert.equal(second.sources.screenshot, true);
  assert.equal(firstChanges, 1);
  assert.equal(secondChanges, 1);
  prefs.setBoolPref("zen.library.preview.sources.unrelated", false);
  assert.equal(firstChanges, 1);
  assert.throws(() => first.set("unknown", true), TypeError);
  assert.throws(() => first.set("download", "false"), TypeError);
  first.destroy(); first.destroy();
  second.set("capture", false);
  assert.equal(firstChanges, 1);
  assert.equal(secondChanges, 2);
  const reopened = new ZenLibraryPreviewSources(() => {}, prefs);
  assert.equal(reopened.sources.desktop, false);
  assert.equal(reopened.sources.capture, false);
  first.set("desktop", true);
  assert.equal(reopened.sources.desktop, false);
  second.destroy(); reopened.destroy();
  assert.equal(prefs.observers.size, 0);
});

test("source reconfiguration removes old downloads while new live arrivals can still appear", () => {
  const model = new ZenLibraryPreviewSources(() => {}, preferences());
  const restored = { name: "persisted complete download" };
  const active = { stopped: false }, completed = { succeeded: true };
  const newest = { stopped: false };
  const records = [restored, active, completed, newest];
  model.add(restored, true);
  model.add(active); model.add(completed);
  assert.deepEqual(model.downloads(records), [active, completed]);
  assert.equal(model.newest(records), completed);
  model.set("download", false);
  assert.deepEqual(model.downloads(records), []);
  model.add(newest);
  assert.deepEqual(model.downloads(records), [newest]);
  newest.stopped = true; newest.succeeded = true;
  assert.equal(model.newest(records), newest);
  model.set("documents", false);
  assert.deepEqual(model.downloads(records), []);
  model.set("download", true);
  assert.deepEqual(model.downloads(records), [], "reenabling reads disk; it does not restore old DownloadData");
  model.add(active); model.remove(active);
  assert.deepEqual(model.downloads(records), []);
  model.destroy(); model.add(newest);
  assert.equal(model.newest(records), undefined);
});

test("new windows share live arrivals and private sessions release their own records", () => {
  const prefs = preferences(), publicPool = new PreviewDownloadRecords(false), privatePool = new PreviewDownloadRecords(true);
  const first = new ZenLibraryPreviewSources(() => {}, prefs, publicPool);
  const download = { name: "normal live transfer" };
  first.add(download);
  const second = new ZenLibraryPreviewSources(() => {}, prefs, publicPool);
  second.add(download, true);
  assert.equal(second.newest([download]), download);
  first.destroy();
  assert.equal(second.newest([download]), download, "closing one window preserves the other window's preview");
  second.destroy();
  const reopened = new ZenLibraryPreviewSources(() => {}, prefs, publicPool);
  assert.equal(reopened.newest([download]), download, "normal arrivals survive closing and reopening browser windows");
  const privateOne = new ZenLibraryPreviewSources(() => {}, prefs, privatePool);
  assert.deepEqual(privateOne.downloads([download]), []);
  const secret = { name: "private transfer" }; privateOne.add(secret);
  const privateTwo = new ZenLibraryPreviewSources(() => {}, prefs, privatePool);
  privateOne.destroy();
  assert.equal(privateTwo.newest([secret]), secret);
  privateTwo.destroy();
  const nextPrivateSession = new ZenLibraryPreviewSources(() => {}, prefs, privatePool);
  assert.deepEqual(nextPrivateSession.downloads([download, secret]), []);
  assert.deepEqual(reopened.downloads([download, secret]), [download]);
  nextPrivateSession.destroy(); reopened.remove(download); reopened.destroy();
});

function menuWindow(translate = async () => {}) {
  class Node {
    children = [];
    dataset = {};
    attributes = new Map();
    listeners = new Map();
    constructor(type) { this.type = type; }
    appendChild(child) { this.children.push(child); child.parent = this; return child; }
    setAttribute(key, value) { this.attributes.set(key, value); }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    emit(name) { this.listeners.get(name)?.({ target: this }); }
    openPopupAtScreen(x, y, context) { this.opened = { x, y, context }; }
    hidePopup() { this.emit("popuphidden"); }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
      this.parent = null;
    }
  }
  const root = new Node("popupset");
  return { root, document: {
    createXULElement: type => new Node(type), getElementById: () => root,
    l10n: { setAttributes(node, id) { node.l10n = id; }, translateFragment: translate },
  } };
}
const event = () => ({ screenX: 12, screenY: 34,
  preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });

test("native source menu matches reference order, checks, disabled header and toggle behavior", async () => {
  const model = new ZenLibraryPreviewSources(() => {}, preferences());
  const window = menuWindow(); let opened = 0, closed = 0;
  const menu = new ZenLibraryPreviewSourceMenu(window, model,
    { onOpen: () => opened++, onClose: () => closed++ });
  const input = event(); await menu.show(input);
  assert.equal(input.prevented && input.stopped, true);
  const [popup] = window.root.children;
  assert.deepEqual(popup.opened, { x: 12, y: 34, context: true });
  assert.equal(popup.children.length, 6);
  assert.equal(popup.children[0].disabled, true);
  assert.equal(popup.children[0].l10n, "library-preview-sources-header");
  assert.deepEqual(popup.children.slice(1).map(item => item.dataset.source), PREVIEW_SOURCES);
  assert.ok(popup.children.slice(1).every(item => item.attributes.get("checked") === "true"));
  const desktop = popup.children[2];
  desktop.emit("command");
  assert.equal(model.sources.desktop, false);
  assert.equal(desktop.attributes.get("checked"), "false");
  model.set("desktop", true);
  assert.equal(desktop.attributes.get("checked"), "true");
  popup.hidePopup();
  assert.equal(opened, 1); assert.equal(closed, 1);
  assert.deepEqual(window.root.children, []);
  menu.destroy(); model.destroy();
});

test("menu replacement and teardown discard delayed translations", async () => {
  const pending = [];
  const model = new ZenLibraryPreviewSources(() => {}, preferences());
  const window = menuWindow(() => new Promise(resolve => pending.push(resolve)));
  let closed = 0;
  const menu = new ZenLibraryPreviewSourceMenu(window, model, { onClose: () => closed++ });
  const first = menu.show(event()), second = menu.show(event());
  model.set("download", false);
  pending[1](); await second;
  assert.equal(window.root.children.length, 1);
  assert.equal(window.root.children[0].children[5].attributes.get("checked"), "false");
  pending[0](); await first;
  assert.equal(window.root.children.length, 1);
  const third = menu.show(event());
  menu.destroy(); pending[2](); await third;
  assert.deepEqual(window.root.children, []);
  assert.equal(closed, 0, "stale popup cleanup cannot close a newer owner");
  model.destroy();
});
