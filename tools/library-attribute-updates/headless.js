const [ownedProfile, moduleDirectory, variant] = arguments;
const checks = [];
const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
const stage = name => IOUtils.writeUTF8(PathUtils.join(ownedProfile, "fixture-stage.txt"), name);
const deadline = (promise, name) => Promise.race([promise, pause(15000).then(() => { throw new Error(`Timed out awaiting ${name}`); })]);
const check = (name, ok, details = null) => {
  checks.push({ name, ok: !!ok, ...(ok ? {} : { details }) });
};
const wait = async (condition, name) => {
  for (let i = 0; i < 400; i++) {
    if (condition()) return;
    await pause(25);
  }
  throw new Error(`Timed out: ${name}`);
};
if (Services.dirsvc.get("ProfD", Ci.nsIFile).path !== ownedProfile ||
    !Cc["@mozilla.org/gfx/info;1"].getService(Ci.nsIGfxInfo).isHeadless) {
  throw new Error("Runtime is not the owned headless profile");
}
await stage("session restore");
await deadline(w.SessionStore.promiseAllWindowsRestored, "session restore");
await stage("workspace initialization");
await deadline(w.gZenWorkspaces.promiseInitialized, "workspace initialization");
await stage("original section registration");
await deadline(w.customElements.whenDefined("zen-library-spaces-section"), "original section registration");
const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
file.initWithPath(moduleDirectory);
const resources = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
resources.setSubstitution("owned-library-attributes", Services.io.newFileURI(file));
const script = w.document.createElement("script");
script.type = "module";
script.src = "resource://owned-library-attributes/section.mjs";
await stage("test module loading");
await deadline(new Promise((resolve, reject) => {
  script.onload = resolve;
  script.onerror = () => reject(new Error("Candidate module failed to load"));
  w.document.documentElement.appendChild(script);
}), "test module loading");
await deadline(w.customElements.whenDefined("zen-library-spaces-section-attribute-test"), "test section registration");
await stage("test tabs and Library");
const Library = w.customElements.get("zen-library");
const tabs = Array.from({ length: 8 }, () => w.gBrowser.addTrustedTab("about:blank", { skipAnimation: true }));
await pause(400);
tabs.forEach((tab, index) => tab.setAttribute("label", `Owned tab ${index}`));
Library.toggle("spaces");
let section;
await wait(() => {
  section = w.document.querySelector("zen-library-spaces-section-attribute-test");
  return Library.libraryProgress === 1 && section?.copyForTab(tabs[0]);
}, "owned section opens");
check("real custom tab element is initialized", !!section.copyForTab(tabs[0]).querySelector(".tab-label"));
const notify = (tab, changed) => tab.dispatchEvent(new w.CustomEvent("TabAttrModified", { bubbles: true, detail: { changed } }));
Library.toggle("spaces");
await wait(() => Library.libraryProgress === 0, "Library closes");
const initial = tabs.map(tab => section.copyForTab(tab));
const originalClone = w.Node.prototype.cloneNode;
const originalRect = w.Element.prototype.getBoundingClientRect;
const work = { copiedOwnedTabs: 0, copiedRowGeometryReads: 0, replacedOwnedRows: 0 };
w.Node.prototype.cloneNode = function(...args) {
  if (tabs.includes(this)) work.copiedOwnedTabs++;
  return originalClone.apply(this, args);
};
w.Element.prototype.getBoundingClientRect = function(...args) {
  if (section.contains(this) && this.matches("tab, .tab-group-label-container")) work.copiedRowGeometryReads++;
  return originalRect.apply(this, args);
};
try {
  for (let i = 0; i < 3; i++) {
    const before = tabs.map(tab => section.copyForTab(tab));
    tabs[0].setAttribute("label", `Closed update ${i}`);
    notify(tabs[0], ["label"]);
    await wait(() => section.copyForTab(tabs[0]).getAttribute("label") === `Closed update ${i}`, "closed update");
    work.replacedOwnedRows += tabs.filter((tab, index) => section.copyForTab(tab) !== before[index]).length;
  }
} finally {
  w.Node.prototype.cloneNode = originalClone;
  w.Element.prototype.getBoundingClientRect = originalRect;
}
check("closed update identity matches expected behavior", variant === "candidate"
  ? tabs.every((tab, index) => section.copyForTab(tab) === initial[index])
  : tabs.every((tab, index) => section.copyForTab(tab) !== initial[index]), work);
check("candidate avoids copied rows and geometry work", variant !== "candidate" ||
  (!work.copiedOwnedTabs && !work.copiedRowGeometryReads && !work.replacedOwnedRows), work);

const changed = tabs[0];
changed.setAttribute("image", "chrome://global/skin/icons/info.svg");
changed.setAttribute("requestcontextid", "0");
changed.setAttribute("labeldirection", "rtl");
changed.setAttribute("pending", "true");
changed.setAttribute("muted", "true");
changed.setAttribute("soundplaying", "true");
notify(changed, ["image", "pending", "muted", "soundplaying"]);
await wait(() => section.copyForTab(changed).hasAttribute("pending"), "added attributes");
let copy = section.copyForTab(changed);
check("favicon custom-element inheritance is current", copy.querySelector(".tab-icon-image").getAttribute("src") === changed.getAttribute("image"));
check("label custom-element inheritance is current", copy.querySelector(".tab-label").textContent === changed.getAttribute("label"));
check("related source attributes are current", copy.getAttribute("requestcontextid") === "0" && copy.getAttribute("labeldirection") === "rtl");
check("separate ID and unselected state", copy.id === `${changed.id}-copy` &&
  ["selected", "visuallyselected", "multiselected"].every(name => !copy.hasAttribute(name)));
for (const name of ["pending", "muted", "soundplaying", "requestcontextid"]) changed.removeAttribute(name);
changed.setAttribute("label", "Opening flush");
notify(changed, ["label", "pending", "muted", "soundplaying"]);
Library.toggle("spaces");
await wait(() => Library.libraryProgress === 1, "Library reopens");
copy = section.copyForTab(changed);
check("opening flushes pending attributes", copy.getAttribute("label") === "Opening flush" &&
  ["pending", "muted", "soundplaying", "requestcontextid"].every(name => !copy.hasAttribute(name)));

await stage("folder editor");
let folder;
section.library.keepOpenWhile(() => {
  folder = w.gZenFolders.createFolder(tabs.slice(1, 3), { renameFolder: false, label: "Owned folder", collapsed: false });
});
await wait(() => section.querySelector(`#${w.CSS.escape(`${folder.id}-copy`)}`), "folder is copied");
check("folder editor starts", section.renameFolder(folder, "Owned editor"));
const input = section.querySelector("#tab-label-input");
if (!input) throw new Error(`Folder editor missing: ${JSON.stringify({ folderConnected: folder.isConnected, libraryOpen: Library.isLibraryOpen, workspace: folder.getAttribute("zen-workspace-id") })}`);
input.value = "Keep this draft";
input.setSelectionRange(2, 7);
const nested = section.copyForTab(tabs[1]);
tabs[1].setAttribute("label", "Changed beside editor");
notify(tabs[1], ["label"]);
await pause(300);
check("attribute update preserves editor and selection", input.isConnected && input.value === "Keep this draft" &&
  input.selectionStart === 2 && input.selectionEnd === 7 && w.document.activeElement === input);
check("attribute update preserves folder's tab node", section.copyForTab(tabs[1]) === nested);
check("candidate updates nested tab while editor remains open", variant !== "candidate" || nested.getAttribute("label") === "Changed beside editor");
input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
await wait(() => !input.isConnected && section.copyForTab(tabs[1]).getAttribute("label") === "Changed beside editor", "editor closes without losing attributes");

await stage("drag landing");
section.beginTabLanding(changed);
const landing = section.copyForTab(changed);
changed.setAttribute("label", "Changed during landing");
notify(changed, ["label"]);
await pause(300);
check("landing continues to defer attribute work", landing.isConnected && landing.getAttribute("label") === "Opening flush");
w.dispatchEvent(new w.Event("dragend"));
await wait(() => section.copyForTab(changed).getAttribute("label") === "Changed during landing", "drag-end rebuild catches up");
check("drag end retains the structural rebuild path", section.copyForTab(changed) !== landing);

const finalDOM = tabs.map(tab => {
  const node = section.copyForTab(tab);
  return {
    attributes: Object.fromEntries(["label", "image", "labeldirection", "requestcontextid", "pending", "muted", "soundplaying"].map(name => [name, node.getAttribute(name)])),
    inheritedLabel: node.querySelector(".tab-label")?.textContent,
    inheritedImage: node.querySelector(".tab-icon-image")?.getAttribute("src"),
    nestedInFolder: !!node.closest("zen-folder"),
  };
});
Library.toggle("spaces");
await wait(() => Library.libraryProgress === 0, "final close");
resources.setSubstitution("owned-library-attributes", null);
return { ok: checks.every(item => item.ok), checks, work, finalDOM,
  app: { version: Services.appinfo.version, buildID: Services.appinfo.appBuildID },
  sourceLoad: "Only custom-element tag names and the section render registration differ from the tested source." };
