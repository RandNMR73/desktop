/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { spaceIconPalette, spaceIconPaletteCSS, spaceIconSource } from "resource:///modules/zen/ZenSpaceIconPalette.mjs";
import { nativeSpaceIconPalette } from "resource:///modules/zen/ZenNativeTheme.sys.mjs";
import { themeKey } from "resource:///modules/zen/ZenNativeThemeState.mjs";

class nsZenWorkspaceIcons extends MozXULElement {
  #hasConnected = false;
  #paletteKeys = new WeakMap();

  connectedCallback() {
    if (this.delayConnectedCallback() || this.#hasConnected) {
      return;
    }

    this.#hasConnected = true;
    window.addEventListener("ZenWorkspacesUIUpdate", this, true);
    window.addEventListener("ZenWorkspaceDataChanged", this, true);

    this.initDragAndDrop();
    this.addEventListener("mouseover", e => {
      if (e.shiftKey || this.isReorderMode) {
        return;
      }
      const target = e.target.closest("toolbarbutton[zen-workspace-id]");
      if (target) {
        this.#updateWorkspaceTooltip(target);
        target.scrollIntoView({ behavior: "smooth", inline: "nearest" });
      }
    });
    this.addEventListener("focusin", e => {
      const target = e.target.closest("toolbarbutton[zen-workspace-id]");
      if (target) {
        this.#updateWorkspaceTooltip(target);
      }
    });
  }

  initDragAndDrop() {
    let dragStart = 0;
    let draggedTab = null;

    this.addEventListener("mousedown", e => {
      const target = e.target.closest("toolbarbutton[zen-workspace-id]");
      if (!target || e.button != 0 || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }

      const isVertical =
        document.documentElement.getAttribute("zen-sidebar-expanded") != "true";
      const clientPos = isVertical ? "clientY" : "clientX";

      this.isReorderMode = false;
      dragStart = e[clientPos];
      draggedTab = target;
      draggedTab.setAttribute("dragged", "true");

      e.stopPropagation();

      const mouseMoveHandler = moveEvent => {
        if (Math.abs(moveEvent[clientPos] - dragStart) > 5) {
          this.isReorderMode = true;
        }

        if (this.isReorderMode) {
          const tabs = [...this.children];
          const mouse = moveEvent[clientPos];

          for (const tab of tabs) {
            if (tab === draggedTab) {
              continue;
            }
            const rect = tab.getBoundingClientRect();
            if (
              mouse > rect[isVertical ? "top" : "left"] &&
              mouse < rect[isVertical ? "bottom" : "right"]
            ) {
              const nextSibling = draggedTab.nextSibling;
              if (
                mouse <
                rect[isVertical ? "top" : "left"] +
                  rect[isVertical ? "height" : "width"] / 2
              ) {
                this.insertBefore(draggedTab, tab);
              } else {
                this.insertBefore(draggedTab, tab.nextSibling);
              }
              if (nextSibling !== draggedTab.nextSibling) {
                /* eslint-disable mozilla/valid-services */
                Services.zen.playHapticFeedback();
              }
            }
          }
        }
      };

      const mouseUpHandler = () => {
        document.removeEventListener("mousemove", mouseMoveHandler);
        document.removeEventListener("mouseup", mouseUpHandler);

        draggedTab.removeAttribute("dragged");

        this.reorderWorkspaceToIndex(
          draggedTab,
          Array.from(this.children).indexOf(draggedTab)
        );

        draggedTab = null;
        this.isReorderMode = false;
      };

      document.addEventListener("mousemove", mouseMoveHandler);
      document.addEventListener("mouseup", mouseUpHandler);
    });
  }

  #createWorkspaceIcon(workspace) {
    const button = document.createXULElement("toolbarbutton");
    button.setAttribute("class", "subviewbutton toolbarbutton-1");
    button.setAttribute("zen-workspace-id", workspace.uuid);
    button.setAttribute("context", "zenWorkspaceMoreActions");
    button.addEventListener("command", this);
    this.#updateWorkspaceIcon(button, workspace);
    return button;
  }

  /**
   * Syncs the parts of a workspace button that can change between updates, so
   * an existing button can be reused instead of rebuilt.
   *
   * @param {Element} button - The button standing in for the workspace
   * @param {object} workspace - The workspace it represents
   */
  #updateWorkspaceIcon(button, workspace) {
    button.setAttribute("data-zen-workspace-name", gZenWorkspaces.getWorkspaceDisplayName(workspace));
    this.#updateWorkspaceTooltip(button);

    const isSvgIcon = !!workspace.icon?.endsWith(".svg");
    const hasIcon = gZenWorkspaces.workspaceHasIcon(workspace);

    const selector = ".zen-workspace-icon:not(.zen-space-colored-icon)";
    let icon = button.querySelector(selector);
    const tag = isSvgIcon && hasIcon ? "img" : "label";
    if (icon?.localName !== tag) {
      icon?.remove();
      button.querySelector(".zen-space-colored-icon")?.remove();
      icon = tag === "img" ? document.createElement(tag) : document.createXULElement(tag);
      icon.setAttribute("class", "zen-workspace-icon");
      icon.setAttribute("aria-hidden", "true");
      button.appendChild(icon);
    }
    if (tag === "img") {
      const source = spaceIconSource(workspace.icon);
      if (icon.getAttribute("src") !== source) icon.setAttribute("src", source);
    } else {
      icon.toggleAttribute("no-icon", !hasIcon);
      icon.classList.add("no-squircles");
      icon.textContent = hasIcon ? workspace.icon : "";
    }
    let colored = button.querySelector(".zen-space-colored-icon");
    if (!colored || colored.getAttribute("src") !== icon.getAttribute("src") ||
        colored.textContent !== icon.textContent || colored.hasAttribute("no-icon") !== icon.hasAttribute("no-icon")) {
      colored?.remove();
      colored = icon.cloneNode(true);
      colored.classList.add("zen-space-colored-icon");
      button.appendChild(colored);
    }
    this.#updateWorkspacePalette(button, workspace);
  }

  async #updateWorkspacePalette(button, workspace) {
    const key = themeKey(workspace.theme);
    if (this.#paletteKeys.get(button) === key) return;
    this.#paletteKeys.set(button, key);
    // Resolve on data changes, never during pointer movement. An edited theme
    // must immediately lose its previous imported color, even while loading.
    button.style.removeProperty("--zen-space-icon-color");
    const primary = window.gZenThemePicker?.getPrimaryColor(workspace.theme?.gradientColors ?? []);
    let values = primary;
    if (typeof values === "string") {
      const parsed = InspectorUtils.colorToRGBA(values);
      values = parsed && [parsed.r, parsed.g, parsed.b];
    }
    const fallback = Array.isArray(values) ? spaceIconPalette(values.map(v => v / 255)) : null;
    const css = spaceIconPaletteCSS(fallback);
    if (css) button.style.setProperty("--zen-space-icon-color", css);
    const imported = spaceIconPaletteCSS(await nativeSpaceIconPalette(workspace));
    if (imported && button.isConnected && this.#paletteKeys.get(button) === key) {
      button.style.setProperty("--zen-space-icon-color", imported);
    }
  }

  #updateWorkspaceTooltip(button) {
    // Resolve by the current Space order and live binding. A reordered Space,
    // remapped shortcut, or disabled binding must never advertise a stale key.
    const index = gZenWorkspaces.getWorkspaces().findIndex(
      workspace => workspace.uuid === button.getAttribute("zen-workspace-id")
    );
    const manager = window.gZenKeyboardShortcutsManager;
    const shortcut = index >= 0 && index < 10 && manager?._currentShortcutList
      ? manager.getShortcutFromCommand(`cmd_zenWorkspaceSwitch${index + 1}`)
      : null;
    const key = shortcut && !shortcut.isDisabled() ? shortcut.toDisplayString() : "";
    const name = button.getAttribute("data-zen-workspace-name");
    button.setAttribute("tooltiptext", key ? `${name} (${key})` : name);
  }

  async #updateIcons() {
    const workspaces = gZenWorkspaces.getWorkspaces();
    const reusable = new Map();
    for (const button of this.children) {
      const uuid = button.getAttribute("zen-workspace-id");
      if (uuid) {
        reusable.set(uuid, button);
      }
    }

    let slot = this.firstElementChild;
    for (const workspace of workspaces) {
      const existing = reusable.get(workspace.uuid);
      if (existing) {
        reusable.delete(workspace.uuid);
        this.#updateWorkspaceIcon(existing, workspace);
      }
      const button = existing ?? this.#createWorkspaceIcon(workspace);
      if (button === slot) {
        slot = slot.nextElementSibling;
      } else if (existing) {
        this.moveBefore(button, slot);
      } else {
        this.insertBefore(button, slot);
      }
    }
    for (const button of reusable.values()) {
      button.remove();
    }

    if (workspaces.length <= 1) {
      this.setAttribute("dont-show", "true");
    } else {
      this.removeAttribute("dont-show");
    }
    gZenWorkspaces.onWindowResize();
  }

  on_command(event) {
    const button = event.target;
    const uuid = button.getAttribute("zen-workspace-id");
    if (uuid) {
      gZenWorkspaces.changeWorkspaceWithID(uuid);
    }
  }

  async on_ZenWorkspaceDataChanged() {
    await this.#updateIcons();
    this.activeIndex = gZenWorkspaces.getActiveWorkspace()?.uuid;
  }

  async on_ZenWorkspacesUIUpdate(event) {
    await this.#updateIcons();
    this.activeIndex = event.detail.activeIndex;
  }

  set activeIndex(uuid) {
    const buttons = this.querySelectorAll("toolbarbutton");
    if (!buttons.length) {
      return;
    }
    let i = 0;
    let selected = -1;
    for (const button of buttons) {
      if (button.getAttribute("zen-workspace-id") == uuid) {
        selected = i;
      } else if (button.hasAttribute("active")) {
        button.removeAttribute("active");
      }
      i++;
    }
    if (selected == -1) {
      return;
    }
    buttons[selected].setAttribute("active", true);
    window.promiseDocumentFlushed(() => {
      buttons[selected].scrollIntoView({
        behavior: "smooth",
        inline: "nearest",
      });
    });
    this.setAttribute("selected", selected);
  }

  get activeIndex() {
    const selected = this.getAttribute("selected");
    const buttons = this.querySelectorAll("toolbarbutton");
    let i = 0;
    for (const button of buttons) {
      if (i == selected) {
        return button.getAttribute("zen-workspace-id");
      }
      i++;
    }
    return null;
  }

  get isReorderMode() {
    return this.hasAttribute("reorder-mode");
  }

  set isReorderMode(value) {
    if (value) {
      this.setAttribute("reorder-mode", "true");
    } else {
      this.removeAttribute("reorder-mode");
      this.style.removeProperty("--zen-workspace-icon-width");
      this.style.removeProperty("--zen-workspace-icon-height");
    }
  }

  reorderWorkspaceToIndex(draggedTab, index) {
    const workspaceId = draggedTab.getAttribute("zen-workspace-id");
    gZenWorkspaces.reorderWorkspace(workspaceId, index);
  }
}

customElements.define("zen-workspace-icons", nsZenWorkspaceIcons);
