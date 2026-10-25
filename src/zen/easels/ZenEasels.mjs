/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { ZenEaselStore, EASEL_CHANGED } = ChromeUtils.importESModule(
  "resource:///modules/zen/ZenEaselStore.sys.mjs",
);
import { ZenEaselView } from "./ZenEaselView.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});
ChromeUtils.defineESModuleGetters(lazy, {
  SessionStore:
    "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
});
const PREFIX = "about:blank#zen-easel-";
const SIDEBAR_LABEL = "zen-easel-sidebar-label";
const EASEL_ICON =
  "chrome://browser/content/zen-easels/icons/easel-freehand.svg";

// Imported into the current browser window only when an Easel is opened or
// restored. Ordinary browsing never loads a document, canvas, or image asset.
export const ZenEasels = {
  views: new Map(),
  pending: new Map(),
  mounts: new Map(),
  previewGeneration: 0,
  initialized: false,
  init() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    window.gZenEasels = this;
    const style = window.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "link",
    );
    style.rel = "stylesheet";
    style.href = "chrome://browser/content/zen-easels/easel.css";
    window.document.documentElement.append(style);
    window.addEventListener("TabClose", (event) => {
      this.mounts.get(event.target)?.abort();
      this.views.get(event.target)?.destroy();
      this.views.delete(event.target);
    });
    this.progress = {
      onLocationChange: (browser, progress, request, uri) => {
        if (!progress.isTopLevel) {
          return;
        }
        const tab = gBrowser.getTabForBrowser(browser);
        const id = tab?.getAttribute("zen-easel-id");
        if (!id || uri.spec === "about:blank" || uri.spec === PREFIX + id) {
          return;
        }
        this.mounts.get(tab)?.abort();
        this.views.get(tab)?.destroy();
        this.views.delete(tab);
        tab.removeAttribute("zen-easel-id");
        lazy.SessionStore.deleteCustomTabValue(tab, "zen-easel-id");
        lazy.SessionStore.deleteCustomTabValue(tab, SIDEBAR_LABEL);
        delete tab.zenStaticLabel;
        if (tab.zenStaticIcon === EASEL_ICON) {
          delete tab.zenStaticIcon;
          gBrowser.setIcon(tab, "");
        }
        gBrowser.setTabTitle(tab);
      },
      onStateChange: (browser, progress, request, flags) => {
        if (
          !progress.isTopLevel ||
          !(flags & Ci.nsIWebProgressListener.STATE_STOP)
        ) {
          return;
        }
        const tab = gBrowser.getTabForBrowser(browser);
        const view = this.views.get(tab);
        if (view) {
          // The backing about:blank load may finish after mounting the editor.
          // Restore content-title ownership after its ordinary page callbacks.
          this.label(tab, view.data.title);
        }
      },
    };
    gBrowser.addTabsProgressListener(this.progress);
    window.addEventListener(
      "unload",
      () => {
        for (const view of this.views.values()) {
          view.destroy();
        }
        for (const controller of this.mounts.values()) {
          controller.abort();
        }
        this.closePreview();
        gBrowser.removeTabsProgressListener(this.progress);
        Services.obs.removeObserver(this, EASEL_CHANGED);
      },
      { once: true },
    );
    Services.obs.addObserver(this, EASEL_CHANGED);
  },
  observe(subject, topic, id) {
    // Refresh other open views after a saved edit. Never replace the DOM under
    // an active text selection or pointer gesture.
    for (const view of [...this.views.values(), this.previewView].filter(
      Boolean,
    )) {
      if (
        view.data.id !== id ||
        view === this.savingView ||
        view.editing ||
        view.gesture
      ) {
        continue;
      }
      const previous = view.persisted;
      ZenEaselStore.get(id)
        .then((document) => {
          if (
            !view.destroyed &&
            document &&
            !view.editing &&
            !view.gesture &&
            view.persisted === previous
          ) {
            view.editor.integrateRemote(document, () => ZenEaselStore.id());
            view.persisted = structuredClone(document);
            view.render();
          }
        })
        .catch(console.error);
    }
  },
  saveView(view, document) {
    this.savingView = view;
    let merged;
    try {
      merged = ZenEaselStore.save(document, view.persisted);
      if (JSON.stringify(merged) !== JSON.stringify(document)) {
        view.editor.integrateRemote(merged, () => ZenEaselStore.id());
      }
      view.persisted = structuredClone(merged);
    } finally {
      this.savingView = null;
    }
    for (const [tab, other] of this.views) {
      if (other.data.id === document.id) {
        this.label(tab, merged.title);
      }
    }
  },
  label(tab, title) {
    const label = lazy.SessionStore.getCustomTabValue(tab, SIDEBAR_LABEL) || title;
    tab.zenStaticLabel = label;
    tab.zenStaticIcon ||= EASEL_ICON;
    gBrowser._setTabLabel(tab, label, {
      _zenChangeLabelFlag: true,
      isContentTitle: true,
    });
    gBrowser.setIcon(tab, tab.zenStaticIcon);
    if (tab.selected) {
      gBrowser.updateTitlebar();
    }
  },
  async renameSidebarTab(tab, name) {
    const id = tab.getAttribute("zen-easel-id");
    const document = id && (await ZenEaselStore.get(id));
    if (!document || !tab.isConnected || tab.getAttribute("zen-easel-id") !== id) {
      return false;
    }
    if (name) {
      lazy.SessionStore.setCustomTabValue(tab, SIDEBAR_LABEL, name);
    } else {
      lazy.SessionStore.deleteCustomTabValue(tab, SIDEBAR_LABEL);
    }
    this.label(tab, document.title);
    return true;
  },
  async create() {
    if (lazy.PrivateBrowsingUtils.isWindowPrivate(window)) {
      return null;
    }
    const document = await ZenEaselStore.create(
      gBrowser.selectedBrowser.getBoundingClientRect().width,
    );
    return this.open(document.id, { pin: true });
  },
  async open(id, { pin = false } = {}) {
    if (lazy.PrivateBrowsingUtils.isWindowPrivate(window)) {
      return null;
    }
    this.init();
    this.closePreview();
    const library = window.document.querySelector("zen-library");
    if (library?.constructor.isLibrarySlightlyOpen) {
      await library.constructor.animateProgress(0);
    }
    const document = await ZenEaselStore.get(id);
    if (!document) {
      throw new Error("Easel not found");
    }
    // gBrowser.tabs contains only the current Space's tab strip in Zen.
    // Search stored Spaces too, before deciding that a new sidebar tab is needed.
    let tab = gZenWorkspaces.allStoredTabs.find(
      (tab) =>
        tab.getAttribute("zen-easel-id") === id ||
        tab.linkedBrowser.currentURI?.spec === PREFIX + id,
    );
    if (!tab) {
      tab = gBrowser.addTrustedTab(PREFIX + id, {
        skipAnimation: true,
        userContextId: gZenWorkspaces.getActiveWorkspace()?.containerTabId || 0,
      });
      tab.setAttribute("zen-easel-id", id);
      lazy.SessionStore.setCustomTabValue(tab, "zen-easel-id", id);
      // Arc pins newly created Easels, while Library reopening creates an
      // ordinary tab. Choose the location before selecting or mounting it.
      if (pin) {
        gBrowser.pinTab(tab);
      }
    }
    this.label(tab, document.title);
    const spaceId = tab.getAttribute("zen-workspace-id");
    if (spaceId && gZenWorkspaces.getActiveWorkspace()?.uuid !== spaceId) {
      await gZenWorkspaces.changeWorkspaceWithID(spaceId);
    }
    gBrowser.selectedTab = tab;
    await this.attach(tab, document);
    this.views.get(tab)?.root.focus();
    return tab;
  },
  async restore(tab) {
    if (!tab || lazy.PrivateBrowsingUtils.isWindowPrivate(window)) {
      return;
    }
    this.init();
    const url = tab.linkedBrowser.currentURI?.spec || "";
    const id =
      tab.getAttribute("zen-easel-id") ||
      (url.startsWith(PREFIX) ? url.slice(PREFIX.length) : "");
    if (!/^[\w-]{1,100}$/.test(id)) {
      return;
    }
    const document = await ZenEaselStore.get(id);
    if (document && tab.isConnected) {
      await this.attach(tab, document);
    }
  },
  async attach(tab, document) {
    if (this.views.has(tab)) {
      return;
    }
    // Concurrent tab selection/restoration callbacks must not mount twice.
    if (this.pending.has(tab)) {
      return this.pending.get(tab);
    }
    const promise = (async () => {
      await gZenWorkspaces.promiseInitialized;
      if (!tab.isConnected || this.views.has(tab)) {
        return;
      }
      const host = tab.linkedBrowser.closest(".browserStack");
      if (!host) {
        return;
      }
      tab.setAttribute("zen-easel-id", document.id);
      this.label(tab, document.title);
      let view;
      const controller = new AbortController();
      this.mounts.set(tab, controller);
      view = await ZenEaselView.mount(host, document, {
        onChange: (changed) => this.saveView(view, changed),
        signal: controller.signal,
      });
      if (!tab.isConnected) {
        view.destroy();
        return;
      }
      this.views.set(tab, view);
    })();
    this.pending.set(tab, promise);
    try {
      await promise;
    } catch (error) {
      if (error.name !== "AbortError") {
        throw error;
      }
    } finally {
      this.pending.delete(tab);
      this.mounts.delete(tab);
    }
  },
  async preview(id) {
    if (lazy.PrivateBrowsingUtils.isWindowPrivate(window)) {
      return;
    }
    this.init();
    this.closePreview();
    const generation = this.previewGeneration;
    const document = await ZenEaselStore.get(id);
    if (!document || generation !== this.previewGeneration) {
      return;
    }
    this.previewFocus = window.document.activeElement;
    const controller = new AbortController();
    this.previewController = controller;
    const overlay = window.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    );
    overlay.className = "zen-easel-preview-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", document.title);
    this.previewHost = overlay;
    const container = window.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    );
    container.className = "zen-easel-preview";
    overlay.append(container);
    // The Library is translated and sidebar-sized. A child of it cannot be
    // centered in the window, even with position:fixed.
    window.document.documentElement.append(overlay);
    const controls = window.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div",
    );
    controls.className = "zen-easel-preview-controls";
    const addButton = (label, icon, handler) => {
      const button = window.document.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "button",
      );
      button.setAttribute("aria-label", label);
      button.title = label;
      button.dataset.icon = icon;
      button.addEventListener("click", handler, { signal: controller.signal });
      controls.append(button);
    };
    addButton("Close preview", "close", () => this.closePreview());
    addButton("Open in Space", "expand", () =>
      this.open(id).catch(console.error),
    );
    overlay.append(controls);
    overlay.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      { signal: controller.signal },
    );
    let view;
    try {
      view = await ZenEaselView.mount(container, document, {
        onChange: (changed) => this.saveView(view, changed),
        preview: true,
        signal: controller.signal,
      });
    } catch (error) {
      if (generation === this.previewGeneration) {
        this.closePreview();
      }
      if (error.name !== "AbortError") {
        throw error;
      }
      return;
    }
    if (generation !== this.previewGeneration) {
      view.destroy();
      return;
    }
    this.previewView = view;
    view.root.focus();
  },
  closePreview() {
    this.previewGeneration++;
    this.previewController?.abort();
    this.previewController = null;
    const view = this.previewView;
    this.previewView = null;
    view?.destroy();
    this.previewHost?.remove();
    this.previewHost = null;
    this.previewFocus?.focus();
    this.previewFocus = null;
  },
};
