// Deterministic production-method work comparison; no timing measurement.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const path = "src/zen/spaces/ZenSpaceManager.mjs";
const baseline = execFileSync("git", ["show", `21a8752b9:${path}`], { cwd: root, encoding: "utf8" });
const candidate = readFileSync(new URL(path, root), "utf8");
const between = (source, start, end) => (() => { const a = source.indexOf(start), b = source.indexOf(end, a); assert.ok(a >= 0 && b > a, `Missing method bounds: ${start} .. ${end}`); return source.slice(a, b); })();
const separator = source => between(source, "  updateShouldHideSeparator(", "  onPinnedTabsResize(");
const unchanged = {
  clearAndTidy: between(baseline, "  async closeAllUnpinnedTabs()", "  // Arc's pill tooltip for Tidy and Clear") ===
    between(candidate, "  async closeAllUnpinnedTabs()", "  // Arc's pill tooltip for Tidy and Clear"),
  helpers: between(baseline, "  #unpinnedTabsInWorkspace(", "  #deleteWorkspaceOwnedTabs(") ===
    between(candidate, "  #unpinnedTabsInWorkspace(", "  #deleteWorkspaceOwnedTabs("),
};
assert.ok(Object.values(unchanged).every(Boolean));
assert.ok(baseline.includes("  async closeAllUnpinnedTabs()"));
assert.ok(baseline.includes("  // Arc's pill tooltip for Tidy and Clear"));
const run = source => {
  const work = { enumerations: 0, workspaceAttributeReads: 0, streamChecks: 0, peerConnectionChecks: 0, buttonQueries: 0, buttonAttributeWrites: 0 };
  const tabs = Array.from({ length: 100 }, (_, i) => ({
    visible: true, pinned: false,
    getAttribute(name) { assert.equal(name, "zen-workspace-id"); work.workspaceAttributeReads++; return String(i % 4); },
    hasAttribute() { return false; },
    linkedBrowser: { browsingContext: { currentWindowGlobal: {
      hasActivePeerConnections() { work.peerConnectionChecks++; return false; },
    } } },
  }));
  const context = vm.createContext({ window: { webrtcUI: {
    browserHasStreams() { work.streamChecks++; return false; },
  } } });
  const Manager = vm.runInContext(`(class {
    ${between(source, "  #unpinnedTabsInWorkspace(", "  #deleteAllUnpinnedTabsInWorkspace(")}
    ${separator(source)}
  })`, context);
  const manager = new Manager();
  Object.defineProperty(manager, "allStoredTabs", { get() { work.enumerations++; return tabs; } });
  const visible = [];
  for (let id = 0; id < 4; id++) {
    const attrs = new Map([["hide-separator", "true"]]);
    const pinned = {
      hasAttribute: name => attrs.has(name),
      getAttribute: () => String(id),
      setAttribute: (name, value) => attrs.set(name, value),
      removeAttribute: name => attrs.delete(name),
      querySelector() { work.buttonQueries++; return {
        setAttribute() { work.buttonAttributeWrites++; },
        removeAttribute() { work.buttonAttributeWrites++; },
      }; },
    };
    manager.updateShouldHideSeparator({ children: [{ hasAttribute: () => false }, { hasAttribute: () => false }] }, pinned);
    visible.push(!attrs.has("hide-separator"));
  }
  return { work, visible };
};
const before = run(baseline), after = run(candidate);
assert.deepEqual(before.visible, after.visible);
assert.deepEqual(before.work, { enumerations: 4, workspaceAttributeReads: 400, streamChecks: 100, peerConnectionChecks: 100, buttonQueries: 4, buttonAttributeWrites: 4 });
assert.ok(Object.values(after.work).every(value => value === 0));
const result = { baselineRevision: "21a8752b9d139cfff8c573b6d5e6544fa47b5b5a", fixture: "100 unpinned tabs across four nonempty Spaces; one separator update per Space", unchanged, before, after, limitation: "Deterministic work counts, not a browser timing benchmark." };
writeFileSync(new URL("result.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
