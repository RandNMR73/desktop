/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const sourcePath = "src/zen/library/sections/ZenLibrarySpacesSection.mjs";
const baseline = execFileSync("git", ["show", `9cc08095:${sourcePath}`], { encoding: "utf8" });
const candidate = readFileSync(sourcePath, "utf8");

// This small DOM model counts work in the unchanged production class. It does
// not model Gecko custom-element rendering or provide browser timings.
function fixture(source, count = 100) {
  const work = { copiedTabs: 0, replacedStrips: 0, geometryReads: 0, attributeWrites: 0 };
  const handlers = new Map();
  const scheduled = new Map();
  let nextTask = 1;
  const schedule = callback => {
    const id = nextTask++;
    scheduled.set(id, callback);
    return id;
  };
  const cancel = id => scheduled.delete(id);
  class Element {
    constructor(name = "section", attrs = {}) {
      this.localName = name;
      this.nodeType = name === "fragment" ? 11 : 1;
      this.attrs = new Map(Object.entries(attrs));
      this.children = [];
      this.parentElement = null;
      this.root = false;
      this.closing = false;
      this.style = { removeProperty() {} };
      this.classList = { contains: name => (this.getAttribute("class") || "").split(" ").includes(name) };
    }
    get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
    get id() { return this.getAttribute("id") || ""; }
    set id(value) { this.setAttribute("id", value); }
    get label() { return this.getAttribute("label"); }
    set label(value) { this.setAttribute("label", value); }
    get dataset() { return { uuid: this.getAttribute("data-uuid") }; }
    get childElementCount() { return this.children.length; }
    get isConnected() { return this.root || !!this.parentElement?.isConnected; }
    getAttribute(name) { return this.attrs.get(name) ?? null; }
    getAttributeNames() { return [...this.attrs.keys()]; }
    hasAttribute(name) { return this.attrs.has(name); }
    setAttribute(name, value) { this.attrs.set(name, String(value)); work.attributeWrites++; }
    removeAttribute(name) { this.attrs.delete(name); work.attributeWrites++; }
    appendChild(child) {
      if (child.nodeType === 11) {
        for (const item of [...child.children]) this.appendChild(item);
        return child;
      }
      child.remove();
      this.children.push(child);
      child.parentElement = this;
      return child;
    }
    remove() {
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter(item => item !== this);
        this.parentElement = null;
      }
    }
    replaceChildren(...children) {
      if (this.classList.contains("zen-library-space-tabs")) work.replacedStrips++;
      for (const child of [...this.children]) child.remove();
      for (const child of children) this.appendChild(child);
    }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    matches(selector) {
      if (selector === "[id]") return this.hasAttribute("id");
      if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
      return this.localName === selector;
    }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) {
        if (node.matches(selector)) return node;
      }
      return null;
    }
    querySelectorAll(selector) {
      const selectors = selector.split(",").map(item => item.trim());
      const result = [];
      const walk = node => {
        for (const child of node.children) {
          if (selectors.some(item => {
            const parts = item.split(" ");
            return child.matches(parts.at(-1)) &&
              (parts.length === 1 || child.parentElement?.closest(parts[0]));
          })) result.push(child);
          walk(child);
        }
      };
      walk(this);
      return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    cloneNode(deep) {
      if (this.localName === "tab") work.copiedTabs++;
      const copy = new Element(this.localName, Object.fromEntries(this.attrs));
      if (deep) for (const child of this.children) copy.appendChild(child.cloneNode(true));
      return copy;
    }
    getBoundingClientRect() { work.geometryReads++; return { left: 0, top: 0, width: 20, height: 20 }; }
    addEventListener() {}
    removeEventListener() {}
    connectedCallback() {}
    disconnectedCallback() {}
  }
  let Section;
  const window = {
    addEventListener(type, callback) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(callback);
    },
    removeEventListener(type, callback) { handlers.get(type)?.delete(callback); },
    requestIdleCallback: schedule,
    cancelIdleCallback: cancel,
    clearTimeout: cancel,
    setTimeout: schedule,
  };
  const observer = class { observe() {} disconnect() {} };
  const pinned = new Element("box");
  const strip = new Element("box");
  const realRoot = new Element("window");
  realRoot.root = true;
  realRoot.appendChild(pinned);
  realRoot.appendChild(strip);
  const tabs = Array.from({ length: count }, (_, index) => strip.appendChild(new Element("tab", {
    id: `tab-${index}`, label: `Tab ${index}`, "zen-workspace-id": "space", selected: "true",
  })));
  const globals = {
    window, setTimeout: schedule, clearTimeout: cancel,
    MozLitElement: Element, ZenLibraryDragAndDrop: class { clearDragOverVisuals() {} },
    ResizeObserver: observer, IntersectionObserver: observer,
    Services: { obs: { addObserver() {}, removeObserver() {} } },
    document: { createDocumentFragment: () => new Element("fragment") },
    Node: { ELEMENT_NODE: 1 },
    gBrowser: { isTab: node => node.localName === "tab" },
    gZenWorkspaces: { activeWorkspace: "space", workspaceElement: () => ({ pinnedTabsContainer: pinned, tabsContainer: strip }) },
    gZenUIManager: { elementAnimate() {} },
    gZenFolders: { updateFolderIcon() {} },
    gReduceMotion: false,
    customElements: { define(name, value) { Section = value; } },
  };
  vm.runInNewContext(source.replace(/^import[\s\S]*?;\n/gm, "").replace("export class", "class"), globals);
  const section = new Section();
  section.root = true;
  const list = section.appendChild(new Element("div", { class: "zen-library-spaces" }));
  const card = list.appendChild(new Element("div", { class: "zen-library-space", "data-uuid": "space" }));
  card.appendChild(new Element("div", { class: "zen-library-space-tabs" }));
  section.connectedCallback();
  section.onLibraryOpening();
  const emit = (tab, changed, type = "TabAttrModified") => {
    for (const callback of handlers.get(type) ?? []) callback({ target: tab, type, detail: { changed } });
  };
  const flush = () => {
    for (const [id, callback] of [...scheduled]) {
      if (scheduled.delete(id)) callback();
    }
  };
  const reset = () => Object.keys(work).forEach(key => { work[key] = 0; });
  return { section, tabs, strip, emit, flush, reset, work, Element, scheduled };
}

function workload(source) {
  const f = fixture(source);
  f.section.onLibraryClosing();
  f.reset();
  for (let i = 0; i < 20; i++) {
    f.tabs[0].setAttribute("label", `Update ${i}`);
    f.emit(f.tabs[0], ["label"]);
    f.flush();
  }
  return { ...f.work, finalLabel: f.section.copyForTab(f.tabs[0]).label };
}

const before = workload(baseline);
const after = workload(candidate);
assert.equal(before.finalLabel, "Update 19");
assert.equal(after.finalLabel, before.finalLabel);
assert.equal(before.copiedTabs, 2000);
assert.equal(after.copiedTabs, 0);
assert.equal(after.replacedStrips, 0);
assert.equal(after.geometryReads, 0);

const f = fixture(candidate, 8);
const copies = f.tabs.map(tab => f.section.copyForTab(tab));
const tab = f.tabs[0], copy = copies[0];
copy.setAttribute("generated-by-copy", "keep");
f.section.onLibraryClosing();
f.reset();
for (const [name, value] of Object.entries({ label: "latest", image: "icon.svg", requestcontextid: "7", labeldirection: "rtl", muted: "true", soundplaying: "true", pending: "true" })) {
  tab.setAttribute(name, value);
  f.emit(tab, [name]);
}
assert.equal(f.scheduled.size, 1, "attribute bursts share one idle callback");
f.flush();
assert.ok(f.tabs.every((item, i) => f.section.copyForTab(item) === copies[i]));
assert.equal(copy.getAttribute("generated-by-copy"), "keep");
assert.equal(copy.getAttribute("requestcontextid"), "7");
assert.equal(copy.getAttribute("labeldirection"), "rtl");
assert.equal(copy.id, `${tab.id}-copy`);
assert.ok(!copy.hasAttribute("selected"));
for (const name of ["muted", "soundplaying", "pending", "requestcontextid"]) tab.removeAttribute(name);
f.emit(tab, ["muted", "soundplaying", "pending"]);
f.section.onLibraryOpening();
for (const name of ["muted", "soundplaying", "pending", "requestcontextid"]) assert.ok(!copy.hasAttribute(name));
assert.equal(f.section.copyForTab(tab), copy, "opening flushes attributes without rebuilding");
f.emit(copy, ["label"]);
f.emit(tab, ["selected"]);
assert.equal(f.scheduled.size, 0, "copy events and unrelated changes schedule no work");

tab.setAttribute("label", "structural update");
f.emit(tab, ["label"]);
f.emit(tab, [], "TabMove");
f.flush();
assert.notEqual(f.section.copyForTab(tab), copy);
assert.equal(f.section.copyForTab(tab).label, "structural update");
const rebuilt = f.section.copyForTab(tab);
tab.setAttribute("label", "after rebuilding");
f.emit(tab, ["label"]);
f.flush();
assert.equal(rebuilt.label, "after rebuilding", "attribute updates find the replacement copy");
assert.equal(copy.label, "latest", "old detached copies are left alone");
tab.setAttribute("label", "closing");
f.emit(tab, ["label"]);
tab.closing = true;
f.flush();
assert.equal(rebuilt.label, "after rebuilding", "closing tabs cannot update copies");
tab.closing = false;
tab.setAttribute("label", "detached");
f.emit(tab, ["label"]);
tab.remove();
f.flush();
assert.equal(rebuilt.label, "after rebuilding", "detached tabs cannot update copies");

const folder = new f.Element("zen-folder", { id: "folder", label: "Folder", collapsed: "true" });
f.strip.appendChild(folder);
folder.appendChild(f.tabs[1]);
folder.appendChild(f.tabs[2]);
f.emit(f.tabs[1], [], "TabGrouped");
f.flush();
const nestedCopy = f.section.copyForTab(f.tabs[1]);
const folderCopy = nestedCopy.parentElement;
f.tabs[1].setAttribute("label", "inside folder");
f.emit(f.tabs[1], ["label"]);
f.flush();
assert.equal(f.section.copyForTab(f.tabs[1]), nestedCopy, "nested copies update in place");
assert.equal(nestedCopy.label, "inside folder");
assert.equal(nestedCopy.parentElement, folderCopy);
assert.ok(folderCopy.hasAttribute("collapsed"), "folder state is preserved");

f.emit(f.tabs[1], ["label"]);
f.section.disconnectedCallback();
assert.equal(f.scheduled.size, 0, "disconnect cancels queued work");

console.log(JSON.stringify({
  baseline: "9cc08095", tabs: 100, isolatedAttributeChanges: 20, before, after,
  correctness: "passed",
  limitation: "Production source evaluated in a deterministic DOM model; no Gecko layout, custom-element rendering, elapsed-time, or browser-wide speed claims.",
}, null, 2));
