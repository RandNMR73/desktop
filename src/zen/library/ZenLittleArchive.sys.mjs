/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  SessionStore: "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
  TabState: "moz-src:///browser/components/sessionstore/TabState.sys.mjs",
  TabStateFlusher: "moz-src:///browser/components/sessionstore/TabStateFlusher.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

const KEY = "zen-little-archive-v1";
const TOPIC = "sessionstore-closed-objects-changed";
const captured = new WeakSet();
let privateRecords = [];
let cachedValue;
let cachedRecords = [];
const pendingRecords = new Map();
Services.obs.addObserver(() => {
  privateRecords = [];
  for (const [id, isPrivate] of pendingRecords) if (isPrivate) pendingRecords.delete(id);
}, "last-pb-context-exited");

function recordFor(item, isPrivate) {
  const { state, littleArchiveId, closedAt } = item;
  if (!isPrivate && state.isPrivate) return null;
  state.zenArchiveLocation = "little";
  const entry = state.entries?.[(state.index || state.entries.length) - 1];
  if (!entry?.url || ["about:blank", "about:newtab", "about:privatebrowsing"].includes(entry.url)) return null;
  return { littleArchiveId, closedAt, state, title: entry.title || item.title,
    image: state.image || item.image };
}

function read(isPrivate) {
  if (isPrivate) return privateRecords;
  try {
    const raw = lazy.SessionStore.getCustomGlobalValue(KEY) || "[]";
    if (raw !== cachedValue) {
      const value = JSON.parse(raw);
      cachedRecords = Array.isArray(value) ? value.filter(record => record.littleArchiveId && record.state?.entries?.length) : [];
      cachedValue = raw;
    }
    return cachedRecords;
  } catch {
    return [];
  }
}

function write(isPrivate, records) {
  if (isPrivate) {
    privateRecords = records;
  } else {
    cachedValue = JSON.stringify(records);
    cachedRecords = records;
    lazy.SessionStore.setCustomGlobalValue(KEY, cachedValue);
  }
  Services.obs.notifyObservers(null, TOPIC);
}

export const ZenLittleArchive = {
  getRecords(win) {
    return read(lazy.PrivateBrowsingUtils.isWindowPrivate(win));
  },

  /** Keep closed Little windows separate from the shared main-window session. */
  capture(win) {
    if (Services.startup.shuttingDown || captured.has(win)) return;
    captured.add(win);
    const closedAt = Date.now();
    const pending = [...win.gBrowser.tabs].filter(tab => !tab.hasAttribute("zen-empty-tab"))
      .map(tab => ({
        littleArchiveId: Services.uuid.generateUUID().toString(),
        closedAt,
        state: JSON.parse(lazy.SessionStore.getTabState(tab)),
        permanentKey: tab.linkedBrowser.permanentKey,
        title: tab.label,
        image: win.gBrowser.getIcon(tab),
      }));
    const isPrivate = lazy.PrivateBrowsingUtils.isWindowPrivate(win);
    for (const item of pending) pendingRecords.set(item.littleArchiveId, isPrivate);
    const initial = pending.map(item => recordFor(item, isPrivate)).filter(Boolean);
    if (initial.length) write(isPrivate, [...initial, ...read(isPrivate)]);
    // Publish cached state immediately; the final content flush fills in late updates.
    // Removing/restoring a pending record cancels that update, so it cannot reappear.
    return lazy.TabStateFlusher.flushWindow(win).then(() => {
      if (isPrivate &&
          ![...Services.wm.getEnumerator("navigator:browser")].some(other =>
            !other.closed && lazy.PrivateBrowsingUtils.isWindowPrivate(other))) return;
      const ids = new Set();
      const records = pending.map(item => {
        if (!pendingRecords.delete(item.littleArchiveId)) return null;
        ids.add(item.littleArchiveId);
        lazy.TabState.copyFromCache(item.permanentKey, item.state);
        return recordFor(item, isPrivate);
      }).filter(Boolean);
      if (ids.size) write(isPrivate, [...records, ...read(isPrivate).filter(item => !ids.has(item.littleArchiveId))]);
    }).catch(console.error).finally(() => {
      for (const item of pending) pendingRecords.delete(item.littleArchiveId);
    });
  },

  remove(win, id) {
    pendingRecords.delete(id);
    const isPrivate = lazy.PrivateBrowsingUtils.isWindowPrivate(win);
    write(isPrivate, read(isPrivate).filter(record => record.littleArchiveId !== id));
  },

  clear(win) {
    const isPrivate = lazy.PrivateBrowsingUtils.isWindowPrivate(win);
    for (const [id, entryPrivate] of pendingRecords) if (entryPrivate === isPrivate) pendingRecords.delete(id);
    write(isPrivate, []);
  },

  restore(win, id, inBackground = false) {
    const record = this.getRecords(win).find(item => item.littleArchiveId === id);
    if (!record) return null;
    const state = structuredClone(record.state);
    state.zenWorkspace = win.gZenWorkspaces.activeWorkspace;
    delete state.zenSyncId;
    delete state.zenClosedSplit;
    const tab = win.gBrowser.addTrustedTab(null, {
      skipLoad: true, userContextId: state.userContextId || 0,
      zenWorkspaceId: state.zenWorkspace,
    });
    try {
      lazy.SessionStore.setTabState(tab, state);
      if (!inBackground) win.gBrowser.selectedTab = tab;
      this.remove(win, id);
      return tab;
    } catch (error) {
      win.gBrowser.removeTab(tab, { animate: false, skipSessionStore: true });
      throw error;
    }
  },
};
