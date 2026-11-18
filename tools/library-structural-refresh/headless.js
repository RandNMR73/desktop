const [ownedProfile, moduleDirectory, mode, variant] = arguments;
const checks = [], phases = [];
const pause = ms => new Promise(resolve => w.setTimeout(resolve, ms));
const stage = name => IOUtils.writeUTF8(PathUtils.join(ownedProfile, "fixture-stage.txt"), name);
const check = (name, ok, details = null) => checks.push({ name, ok: !!ok, ...(ok ? {} : { details }) });
const wait = async (predicate, name, attempts = 240) => {
  for (let i = 0; i < attempts; i++) { if (predicate()) return; await pause(25); }
  throw new Error(`Timed out: ${name}`);
};
await stage("initialization");
await w.SessionStore.promiseAllWindowsRestored;
await w.gZenWorkspaces.promiseInitialized;
const manager = w.gZenWorkspaces;
await w.customElements.whenDefined("zen-library");
await w.customElements.whenDefined("zen-library-spaces-section");
const resources = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
const tag = mode === "injection" ? "zen-library-spaces-section-structural-test" : "zen-library-spaces-section";
if (mode === "injection") {
  const directory = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  directory.initWithPath(moduleDirectory);
  resources.setSubstitution("owned-library-structure", Services.io.newFileURI(directory));
  const script = w.document.createElement("script");
  script.type = "module";
  script.src = "resource://owned-library-structure/section.mjs";
  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = () => reject(new Error("Test section failed to load"));
    w.document.documentElement.appendChild(script);
  });
  await w.customElements.whenDefined(tag);
}
const Library = w.customElements.get("zen-library");
const tabs = [], names = new Map();
let serial = 0;
const add = () => {
  const tab = w.gBrowser.addTrustedTab("about:blank", { skipAnimation: true });
  names.set(tab, `owned-${++serial}`); tabs.push(tab); return tab;
};
const firstID = manager.activeWorkspace;
const first = Array.from({ length: 6 }, add);
const second = await manager.createAndSaveWorkspace("Owned second Space");
await wait(() => manager.activeWorkspace === second.uuid && !manager._animatingChange, "second Space settles");
const secondTabs = Array.from({ length: 6 }, add);
const permanent = [...first, ...secondTabs];
const ids = [firstID, second.uuid];
await pause(500);
Library.toggle("spaces");
let section;
await wait(() => {
  section = w.document.querySelector(tag);
  return Library.libraryProgress === 1 && permanent.every(tab => section?.copyForTab(tab)?.isConnected);
}, "both Space cards fully built");
const cards = ids.map(id => [...section.querySelectorAll(".zen-library-space")].find(card => card.dataset.uuid === id));
const strips = cards.map(card => card.querySelector(".zen-library-space-tabs"));
check("two complete connected cards", strips.every(strip => strip.isConnected) && permanent.every(tab => section.copyForTab(tab)?.isConnected));
Library.toggle("spaces");
await wait(() => Library.libraryProgress === 0, "Library closes");
await pause(400);
check("closed Library retains mounted cards", section.isConnected && strips.every(strip => strip.isConnected));

let phase = null, lastMutation = 0;
const observers = strips.map((strip, space) => {
  const observer = new w.MutationObserver(records => {
    if (!phase) return;
    lastMutation = w.performance.now();
    for (const record of records) phase.cardMutations[space].push({
      type: record.type,
      addedNodes: record.addedNodes.length,
      removedNodes: record.removedNodes.length,
      addedTabRows: [...record.addedNodes].filter(node => node.localName === "tab").length,
      removedTabRows: [...record.removedNodes].filter(node => node.localName === "tab").length,
    });
  });
  observer.observe(strip, { childList: true });
  return observer;
});
const listener = event => {
  if (phase && w.gBrowser.isTab(event.target) && !section.contains(event.target)) phase.events.push({ type: event.type,
    reference: event.target, workspaceAtEvent: ids.indexOf(event.target.getAttribute("zen-workspace-id")),
    connected: event.target.isConnected, pinned: event.target.pinned,
    essential: event.target.hasAttribute("zen-essential") });
};
for (const type of ["TabOpen", "TabClose"]) w.addEventListener(type, listener);
const sourceOrder = (id, subset) => [...manager.workspaceElement(id).pinnedTabsContainer.querySelectorAll("tab"),
  ...manager.workspaceElement(id).tabsContainer.querySelectorAll("tab")]
  .filter(tab => subset.has(tab)).map(tab => names.get(tab));
const orders = () => {
  const live = tabs.filter(tab => tab.isConnected && !tab.closing && !tab.hasAttribute("zen-essential"));
  const copied = new Map(live.map(tab => [section.copyForTab(tab), names.get(tab)]));
  return ids.map((id, i) => ({ source: sourceOrder(id, new Set(live)),
    copy: [...strips[i].querySelectorAll("tab")].filter(copy => copied.has(copy)).map(copy => copied.get(copy)) }));
};
const matches = () => tabs.filter(tab => tab.isConnected && !tab.closing && !tab.hasAttribute("zen-essential")).every(tab => {
  const copy = section.copyForTab(tab);
  return copy?.isConnected && ["label", "image", "pending", "muted", "soundplaying"].every(
    name => copy.getAttribute(name) === tab.getAttribute(name));
});
const baselinePermanentOrder = ids.map(id => sourceOrder(id, new Set(permanent)));
async function run(name, action, completed) {
  await stage(name);
  const before = permanent.map(tab => section.copyForTab(tab));
  const focused = w.document.activeElement, selected = w.gBrowser.selectedTab;
  phase = { name, libraryClosedAtStart: Library.libraryProgress === 0, events: [], cardMutations: [[], []] };
  lastMutation = w.performance.now();
  action();
  await wait(() => completed() && matches() && w.performance.now() - lastMutation > 200, name + " settled");
  const result = phase; phase = null;
  result.events = result.events.map(({ reference, ...event }) => ({ ...event, tab: names.get(reference) || "unowned" }));
  result.libraryClosedAtEnd = Library.libraryProgress === 0;
  result.replacedPermanentRowsBySpace = [first, secondTabs].map(group => group.filter(tab =>
    section.copyForTab(tab) !== before[permanent.indexOf(tab)]).length);
  result.focusPreserved = w.document.activeElement === focused;
  result.selectedTabPreserved = w.gBrowser.selectedTab === selected;
  result.activeSpacePreserved = manager.activeWorkspace === second.uuid;
  result.orders = orders();
  result.contentsMatchSource = matches();
  result.permanentSourceOrderPreserved = ids.every((id, index) =>
    JSON.stringify(sourceOrder(id, new Set(permanent))) === JSON.stringify(baselinePermanentOrder[index]));
  phases.push(result);
  check(name + " preserves unaffected rows in candidate", result.replacedPermanentRowsBySpace[0] === (variant === "candidate" ? 0 : 6), result.replacedPermanentRowsBySpace);
  check(name + " still refreshes affected card", result.replacedPermanentRowsBySpace[1] === 6, result.replacedPermanentRowsBySpace);
  check(name + " keeps focus, selection and active Space", result.focusPreserved && result.selectedTabPreserved && result.activeSpacePreserved, result);
  check(name + " preserves source order and matching copied contents", result.permanentSourceOrderPreserved && result.contentsMatchSource &&
    result.orders.every(order => JSON.stringify(order.source) === JSON.stringify(order.copy)), result.orders);
  check(name + " leaves Library closed", result.libraryClosedAtStart && result.libraryClosedAtEnd);
}
let single, burst = [];
try {
  await run("single TabOpen", () => { single = add(); }, () => section.copyForTab(single)?.isConnected);
  await run("single TabClose", () => w.gBrowser.removeTab(single, { animate: false }), () => !single.isConnected && !section.copyForTab(single));
  await run("three-event TabOpen burst", () => { burst = Array.from({ length: 3 }, add); }, () => burst.every(tab => section.copyForTab(tab)?.isConnected));
  await run("three-event TabClose burst", () => burst.forEach(tab => w.gBrowser.removeTab(tab, { animate: false })),
    () => burst.every(tab => !tab.isConnected && !section.copyForTab(tab)));
} finally {
  phase = null;
}
await stage("reopen Library");
const beforeReopen = permanent.map(tab => section.copyForTab(tab));
Library.toggle("spaces");
await wait(() => Library.libraryProgress === 1 && matches(), "Library reopens with current contents");
const reopenedOrders = orders();
check("reopening keeps all 12 permanent tabs and correct contents", permanent.every(tab => tab.isConnected) &&
  tabs.filter(tab => tab.isConnected).length === 12 && matches() &&
  reopenedOrders.every(order => JSON.stringify(order.source) === JSON.stringify(order.copy)));
check("opening does not repeat the already completed rebuild", permanent.every((tab, index) => section.copyForTab(tab) === beforeReopen[index]));
Library.toggle("spaces");
await wait(() => Library.libraryProgress === 0, "final close");
// Fallback cases use real DOM and real commands, plus one explicitly
// synthetic pre-assignment notification. Their full-card behavior must remain.
async function globalRefresh(name, action, complete) {
  await stage(name);
  const before = permanent.map(tab => section.copyForTab(tab));
  phase = { name, events: [], cardMutations: [[], []] };
  lastMutation = w.performance.now();
  await action();
  await wait(() => complete() && matches() && w.performance.now() - lastMutation > 200, name + " settles");
  const result = phase; phase = null;
  result.events = result.events.map(({ reference, ...event }) => ({ ...event, tab: names.get(reference) || "unowned" }));
  result.replacedPermanentRowsBySpace = [first, secondTabs].map(group => group.filter(tab =>
    section.copyForTab(tab) !== before[permanent.indexOf(tab)]).length);
  result.orders = orders();
  phases.push(result);
  check(name + " retains both-card refresh", result.replacedPermanentRowsBySpace.every(count => count === 6), result);
  check(name + " keeps contents and order current", matches() && result.orders.every(order => JSON.stringify(order.source) === JSON.stringify(order.copy)), result.orders);
}
const settled = async () => { await wait(matches, "current copies"); await pause(300); };
const close = async tab => { w.gBrowser.removeTab(tab, { animate: false }); await wait(() => !tab.isConnected && !section.copyForTab(tab), "owned transient removed"); await settled(); };
const notify = (tab, type) => tab.dispatchEvent(new w.CustomEvent(type, { bubbles: true }));
let folder;
try {
  await globalRefresh("real folder grouping", async () => {
    folder = w.gZenFolders.createFolder(first.slice(1, 3), { renameFolder: false, label: "Owned folder", collapsed: false, workspaceId: firstID });
  }, () => !!section.copyForTab(first[1])?.closest("zen-folder"));
  check("folder belongs to the unaffected first Space", folder.getAttribute("zen-workspace-id") === firstID);
  const moved = add(); await settled();
  let extra;
  await globalRefresh("real cross-Space move followed by ordinary open", async () => {
    manager.moveTabToWorkspace(moved, firstID);
    extra = add();
  }, () => section.copyForTab(moved)?.closest(".zen-library-space")?.dataset.uuid === firstID && !!section.copyForTab(extra));
  await globalRefresh("ordinary closes from two Spaces coalesce", async () => {
    w.gBrowser.removeTab(moved, { animate: false });
    w.gBrowser.removeTab(extra, { animate: false });
  }, () => !moved.isConnected && !extra.isConnected && !section.copyForTab(moved) && !section.copyForTab(extra));
  await globalRefresh("synthetic pre-assignment TabOpen fallback", async () => {
    const tab = secondTabs[0], id = tab.getAttribute("zen-workspace-id");
    tab.removeAttribute("zen-workspace-id");
    try { notify(tab, "TabOpen"); } finally { tab.setAttribute("zen-workspace-id", id); }
  }, () => true);
  const essential = add(); await settled();
  await w.gZenPinnedTabManager.addToEssentials(essential);
  await wait(() => essential.hasAttribute("zen-essential"), "shared Essential is created");
  await settled();
  await globalRefresh("shared Essential TabClose fallback", async () => {
    w.gBrowser.removeTab(essential, { animate: false });
  }, () => !essential.isConnected);

  await stage("closed-to-opening pending refresh");
  const unaffectedBeforeOpening = first.map(tab => section.copyForTab(tab));
  const pending = add();
  Library.toggle("spaces");
  await wait(() => Library.libraryProgress === 1 && section.copyForTab(pending)?.isConnected && matches(), "opening flushes pending structural work");
  check("opening flush includes the new tab", !!section.copyForTab(pending));
  check("opening flush preserves unrelated card in candidate", first.every((tab, index) =>
    (section.copyForTab(tab) === unaffectedBeforeOpening[index]) === (variant === "candidate")));

  await stage("folder editor beside other-Space tab event");
  check("folder editor starts", section.renameFolder(folder, "Owned editor"));
  const input = section.querySelector("#tab-label-input");
  if (!input) throw new Error("Owned folder editor missing");
  input.value = "Keep this draft";
  input.setSelectionRange(2, 7);
  const nested = section.copyForTab(first[1]);
  let beside;
  section.library.keepOpenWhile(() => { beside = add(); });
  await wait(() => section.copyForTab(beside)?.isConnected, "other-Space event refreshes while editor is active");
  check("structural update preserves editor focus and selection", input.isConnected && input.value === "Keep this draft" &&
    input.selectionStart === 2 && input.selectionEnd === 7 && w.document.activeElement === input);
  check("structural update preserves edited folder rows", section.copyForTab(first[1]) === nested);
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(() => !input.isConnected && matches(), "editor ends with current copies");
  Library.toggle("spaces");
  await wait(() => Library.libraryProgress === 0, "close after editor check");
  await close(pending); await close(beside);
} finally {
  phase = null;
  observers.forEach(observer => observer.disconnect());
  for (const type of ["TabOpen", "TabClose"]) w.removeEventListener(type, listener);
  if (mode === "injection") resources.setSubstitution("owned-library-structure", null);
}
const finalState = { orders: orders(), liveOwnedTabs: tabs.filter(tab => tab.isConnected).map(tab => names.get(tab)),
  folderLabel: folder.label, folderTabs: first.filter(tab => !!tab.closest("zen-folder")).map(tab => names.get(tab)),
  libraryClosed: Library.libraryProgress === 0 };
check("all original tabs remain and temporary tabs are removed", permanent.every(tab => tab.isConnected) && finalState.liveOwnedTabs.length === 12);
return { ok: checks.every(check => check.ok), checks, phases, reopenedOrders, finalState,
  design: { spaces: 2, initialOwnedTabs: 12, totalCreatedOwnedTabs: serial,
    maxWaitPerConditionMs: 6000, measurements: "MutationObserver direct child-list records and row identity comparisons only",
    productMethodInjection: mode === "injection", instrumentationWrappers: false, timingMeasurements: false,
    contentURLs: ["about:blank"], scope: "Ordinary tab events plus real grouping/move/shared Essential, synthetic unknown assignment, opening flush and folder editor." } };
