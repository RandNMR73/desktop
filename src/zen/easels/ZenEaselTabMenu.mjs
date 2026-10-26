/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Easel documents have their own actions. Reusing the web-tab popup exposes
// reload, bookmark, container, pinned-URL and unload actions that do not apply.
export class ZenEaselTabMenu {
  constructor(manager) {
    this.manager = manager;
    const popup = document.createXULElement("menupopup");
    popup.id = "zen-easel-tab-menu";
    this.popup = popup;
    this.items = new Map();
    const item = (action, handler) => {
      const node = document.createXULElement("menuitem");
      node.id = "zen-easel-tab-" + action;
      document.l10n.setAttributes(node, node.id);
      node.addEventListener("command", () => {
        const tab = this.target();
        if (tab) {
          Promise.resolve(handler(tab)).catch(console.error);
        }
      });
      popup.append(node);
      this.items.set(action, node);
      return node;
    };
    item("copy", (tab) => this.copyLink(tab));
    item("icon", (tab) => {
      const previous = TabContextMenu.contextTab;
      TabContextMenu.contextTab = tab;
      try {
        document.getElementById("context_zen-edit-tab-icon").doCommand();
      } finally {
        TabContextMenu.contextTab = previous;
      }
    });
    item("rename", (tab) =>
      gZenTabRenamer.start({ target: tab, type: "command" }),
    );
    popup.append(document.createXULElement("menuseparator"));
    item("split", (tab) => {
      gBrowser.selectedTab = tab;
      gZenViewSplitter.createEmptySplit();
    });
    const move = document.createXULElement("menu");
    move.id = "zen-easel-tab-move";
    document.l10n.setAttributes(move, move.id);
    this.movePopup = document.createXULElement("menupopup");
    move.append(this.movePopup);
    popup.append(move);
    popup.append(document.createXULElement("menuseparator"));
    item("remove", (tab) => gBrowser.removeTab(tab, { animate: false }));
    item("delete", (tab) =>
      manager.confirmDelete(tab.getAttribute("zen-easel-id")),
    );
    popup.addEventListener("popupshowing", (event) => {
      if (event.target !== popup) {
        return;
      }
      const tab = popup.triggerNode?.closest(".tabbrowser-tab");
      if (!tab?.hasAttribute("zen-easel-id") || tab.closing) {
        event.preventDefault();
        return;
      }
      this.tab = Cu.getWeakReference(tab);
      this.id = tab.getAttribute("zen-easel-id");
      this.items.get("rename").disabled =
        !Services.prefs.getBoolPref("zen.tabs.rename-tabs") ||
        !gZenVerticalTabsManager._prefsSidebarExpanded;
      this.items.get("split").disabled = !!tab.splitView;
      this.populateSpaces();
    });
    document.getElementById("mainPopupSet").append(popup);
  }

  target() {
    const tab = this.tab?.get();
    return tab?.isConnected &&
      tab.ownerDocument === document &&
      !tab.closing &&
      tab.getAttribute("zen-easel-id") === this.id
      ? tab
      : null;
  }

  copyLink(tab) {
    // A profile-local document URL. Hosted links/collaboration require the
    // separate sharing service; never fabricate an arc.net publication URL.
    Cc["@mozilla.org/widget/clipboardhelper;1"]
      .getService(Ci.nsIClipboardHelper)
      .copyString(this.manager.link(tab.getAttribute("zen-easel-id")));
  }

  populateSpaces() {
    const tab = this.target();
    const spaces = gZenWorkspaces.getWorkspaces();
    const signature = JSON.stringify([
      tab.getAttribute("zen-workspace-id"),
      spaces.map(({ uuid, name }) => [uuid, name]),
    ]);
    if (signature === this.spaceSignature) {
      return;
    }
    const nodes = [];
    for (const space of spaces) {
      const item = document.createXULElement("menuitem");
      item.label = gZenWorkspaces.getWorkspaceDisplayName(space);
      item.setAttribute("type", "checkbox");
      item.setAttribute("autocheck", "false");
      item.setAttribute(
        "checked",
        String(space.uuid === tab.getAttribute("zen-workspace-id")),
      );
      item.dataset.workspaceId = space.uuid;
      item.addEventListener("command", async () => {
        const current = this.target();
        if (current && gZenWorkspaces.getWorkspaceFromId(space.uuid)) {
          gZenWorkspaces.moveTabToWorkspace(current, space.uuid);
          await gZenWorkspaces.changeWorkspaceWithID(space.uuid);
          if (current.isConnected && !current.closing) {
            gBrowser.selectedTab = current;
          }
        }
      });
      nodes.push(item);
    }
    nodes.push(document.createXULElement("menuseparator"));
    const create = document.createXULElement("menuitem");
    document.l10n.setAttributes(create, "zen-easel-tab-new-space");
    create.addEventListener("command", () => {
      const target = this.target();
      const id = this.id;
      if (target) {
        gZenWorkspaces
          .openWorkspaceCreation({
            onCreated: (space) => {
              if (
                target.isConnected &&
                target.ownerDocument === document &&
                !target.closing &&
                target.getAttribute("zen-easel-id") === id
              ) {
                gZenWorkspaces.moveTabToWorkspace(target, space.uuid);
                gBrowser.selectedTab = target;
              }
            },
          })
          .catch(console.error);
      }
    });
    nodes.push(create);
    this.movePopup.replaceChildren(...nodes);
    this.spaceSignature = signature;
  }
}
