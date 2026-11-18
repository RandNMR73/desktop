const [ownedProfile, moduleDirectory, variant, expectedMethod] = arguments;
const checks = [], work = {}, snapshots = [];
const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
const check = (name, ok, details = null) => checks.push({ name, ok: !!ok, ...(ok ? {} : { details }) });
const stage = name => IOUtils.writeUTF8(PathUtils.join(ownedProfile, "fixture-stage.txt"), name);
const wait = async (condition, name) => {
  for (let i = 0; i < 500; i++) { if (condition()) return; await pause(25); }
  throw new Error(`Timed out: ${name}`);
};
if (Services.dirsvc.get("ProfD", Ci.nsIFile).path !== ownedProfile ||
    !Cc["@mozilla.org/gfx/info;1"].getService(Ci.nsIGfxInfo).isHeadless) {
  throw new Error("Runtime is not the owned headless profile");
}
await stage("initialization");
await w.SessionStore.promiseAllWindowsRestored;
await w.gZenWorkspaces.promiseInitialized;
const manager = w.gZenWorkspaces;
const resources = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
if (variant === "candidate") {
  const directory = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  directory.initWithPath(moduleDirectory);
  resources.setSubstitution("owned-separator-layout", Services.io.newFileURI(directory));
  const script = w.document.createElement("script");
  script.type = "module";
  script.src = "resource://owned-separator-layout/separator.mjs";
  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = () => reject(new Error("Candidate method failed to load"));
    w.document.documentElement.appendChild(script);
  });
}
if (manager.updateShouldHideSeparator.toString().trim() !== expectedMethod) {
  throw new Error("Runtime method differs from the audited production source");
}
check("runtime uses exact audited production method", true);

await stage("two Spaces and eight tabs");
const firstID = manager.activeWorkspace;
const add = label => {
  const tab = w.gBrowser.addTrustedTab("about:blank", { skipAnimation: true });
  tab.setAttribute("label", label);
  return tab;
};
const first = Array.from({ length: 4 }, (_, index) => add(`Owned first ${index}`));
const secondData = await manager.createAndSaveWorkspace("Owned second Space");
await wait(() => manager.activeWorkspace === secondData.uuid && !manager._animatingChange, "second Space settles");
const second = Array.from({ length: 4 }, (_, index) => add(`Owned second ${index}`));
await pause(500);

const prototype = Object.getPrototypeOf(manager);
const stored = Object.getOwnPropertyDescriptor(prototype, "allStoredTabs");
const separator = manager.updateShouldHideSeparator;
const getAttribute = w.Element.prototype.getAttribute;
const streams = w.webrtcUI.browserHasStreams;
let phase = null, depth = 0;
const fresh = () => ({ separatorCalls: 0, enumerations: 0, enumeratedTabs: 0, workspaceAttributeReads: 0, streamChecks: 0 });
manager.updateShouldHideSeparator = function(...args) {
  if (phase) work[phase].separatorCalls++;
  depth++;
  try { return separator.apply(this, args); } finally { depth--; }
};
Object.defineProperty(manager, "allStoredTabs", {
  configurable: true,
  get() {
    const tabs = stored.get.call(this);
    if (phase && depth) { work[phase].enumerations++; work[phase].enumeratedTabs += tabs.length; }
    return tabs;
  },
});
w.Element.prototype.getAttribute = function(name) {
  if (phase && depth && name === "zen-workspace-id" && this.localName === "tab") work[phase].workspaceAttributeReads++;
  return getAttribute.call(this, name);
};
w.webrtcUI.browserHasStreams = function(...args) {
  if (phase && depth) work[phase].streamChecks++;
  return streams.apply(this, args);
};
const snapshot = name => {
  const result = { name, separators: [firstID, secondData.uuid].map(id =>
    manager.workspaceElement(id).pinnedTabsContainer.hasAttribute("hide-separator")) };
  snapshots.push(result);
  return result;
};
const run = async (name, action) => {
  await stage(name);
  work[name] = fresh(); phase = name;
  try { await action(); await pause(350); } finally { phase = null; }
  snapshot(name);
  check(`${name} reaches real separator layout`, work[name].separatorCalls > 0, work[name]);
  check(`${name} scan behavior matches variant`, variant === "baseline"
    ? work[name].enumerations > 0 && work[name].workspaceAttributeReads === work[name].enumeratedTabs
    : !work[name].enumerations && !work[name].workspaceAttributeReads && !work[name].streamChecks, work[name]);
};

try {
  await run("general layout", async () => manager.updateTabsContainers());
  let opened;
  await run("TabOpen event", async () => { opened = add("Owned transient"); });
  await run("TabClose event", async () => {
    w.gBrowser.removeTab(opened, { animate: false });
    await wait(() => !opened.isConnected, "transient tab closes");
  });
  await run("Space switch", async () => {
    await manager.changeWorkspaceWithID(firstID);
    await wait(() => manager.activeWorkspace === firstID && !manager._animatingChange, "first Space settles");
  });

  await stage("Clear preserves protected and pinned tabs");
  w.gBrowser.pinTab(first[0]);
  w.gBrowser.selectedTab = first[1];
  first[2].setAttribute("soundplaying", "true");
  await pause(250);
  w.document.getElementById("cmd_zenCloseUnpinnedTabs").doCommand();
  await wait(() => !first[3].isConnected, "Clear closes eligible tab");
  check("Clear preserves selected, playing, pinned and other-Space tabs",
    first.slice(0, 3).every(tab => tab.isConnected) && second.every(tab => tab.isConnected));
  await pause(250);
  snapshot("after first Clear");

  await stage("Clear all-protected fallback");
  w.document.getElementById("cmd_zenCloseUnpinnedTabs").doCommand();
  await wait(() => !first[1].isConnected && !first[2].isConnected, "Clear closes remaining protected tabs");
  await pause(350);
  manager.updateTabsContainers();
  await pause(250);
  check("Clear fallback leaves pinned and other-Space tabs", first[0].isConnected && second.every(tab => tab.isConnected));
  check("empty normal section hides separator", manager.workspaceElement(firstID).pinnedTabsContainer.hasAttribute("hide-separator"));
  snapshot("after fallback Clear");

  await stage("Tidy command remains stable for one site");
  await manager.changeWorkspaceWithID(secondData.uuid);
  await wait(() => manager.activeWorkspace === secondData.uuid && !manager._animatingChange, "second Space settles again");
  const order = second.map(tab => tab._tPos);
  w.document.getElementById("cmd_zenTidyUnpinnedTabs").doCommand();
  check("Tidy retains same-site tab order", second.every((tab, index) => tab._tPos === order[index]));
  snapshot("after Tidy");
} finally {
  manager.updateShouldHideSeparator = separator;
  delete manager.allStoredTabs;
  w.Element.prototype.getAttribute = getAttribute;
  w.webrtcUI.browserHasStreams = streams;
  resources.setSubstitution("owned-separator-layout", null);
}
const finalDOM = { snapshots, firstTabsConnected: first.map(tab => tab.isConnected), secondTabsConnected: second.map(tab => tab.isConnected) };
return { ok: checks.every(item => item.ok), checks, work, finalDOM,
  app: { version: Services.appinfo.version, buildID: Services.appinfo.appBuildID },
  sourceLoad: "Baseline packaged module equals audited source; candidate replaces only updateShouldHideSeparator with its exact source. All surrounding browser code and real Clear/Tidy commands run normally." };
