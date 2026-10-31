// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/** Resolve a bare alias, or the alias of a domain being completed. */
export function siteSearchEngine(query, engines, completionURL = null) {
  // An explicit scheme, path or space is address/query input, not an alias.
  // In particular, do not trim a space typed after dismissing a scope.
  if (!query || /\s/u.test(query)) return null;
  const typed = query.toLowerCase();
  const exact = engines.find(engine =>
    engine.aliases.some(alias => alias.toLowerCase() === typed));
  if (exact) return exact;
  if (/[/:?#@]/u.test(query)) return null;
  let host;
  try {
    const uri = new URL(completionURL);
    if (!/^https?:$/.test(uri.protocol) || uri.username || uri.password) return null;
    host = uri.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
  if (!host.startsWith(typed)) return null;
  return engines.find(engine => engine.aliases.some(alias =>
    alias.toLowerCase() === host)) ?? null;
}

/** Keep imported display names/order separate from unique engine identities. */
export function siteSearchPresentation(engine, entries = []) {
  const index = entries.findIndex(entry => entry.key === engine.name ||
    engine.aliases?.includes(entry.key));
  const entry = entries[index];
  return {
    engine,
    label: typeof entry?.label === "string" ? entry.label : engine.name,
    general: entry?.general ?? engine.isGeneralPurposeEngine ?? false,
    order: index < 0 ? Infinity : index,
  };
}

export function siteSearchAlternatives(engines, currentName, entries = []) {
  return engines.filter(engine => !engine.hidden && engine.name !== currentName)
    .map(engine => siteSearchPresentation(engine, entries))
    .sort((a, b) => Number(a.general) - Number(b.general) || a.order - b.order);
}

/** Scope colors change together; obsolete icon/palette work cannot repaint them. */
export class SiteSearchColors {
  #window;
  #bar;
  #selection;
  #generation = 0;

  constructor(window, bar, selection) {
    this.#window = window;
    this.#bar = bar;
    this.#selection = selection;
  }

  async update(resolveColor) {
    const generation = ++this.#generation;
    const current = () => !this.#window.closed && generation === this.#generation;
    const style = this.#bar.style;
    for (const name of ["--zen-site-search-color", "--zen-site-search-text-selection"])
      style.removeProperty(name);
    if (!resolveColor) return;
    try {
      const color = await resolveColor();
      if (!current() || !color || !this.#window.CSS.supports("color", color)) return;
      style.setProperty("--zen-site-search-color", color);
      // The registered property resolves calc() channels without clipping P3.
      // This runs on a scope change, never on ordinary typing or animation.
      const computed = this.#window.getComputedStyle(this.#bar)
        .getPropertyValue("--zen-native-command-fill");
      const selection = await this.#selection(computed);
      if (current() && selection) style.setProperty("--zen-site-search-text-selection", selection);
    } catch { /* Retain the window's selection palette when a provider fails. */ }
  }
}

/** Native label bounds without measuring layout on every query or frame. */
export class SiteSearchLabel {
  #window;
  #title;
  #measure;
  #label = null;
  #scale;
  #generation = 0;

  constructor(window, title, measure) {
    this.#window = window;
    this.#title = title;
    this.#measure = measure;
    window.addEventListener("resize", () => {
      if (this.#label !== null && window.devicePixelRatio !== this.#scale) this.update(this.#label);
    });
  }

  async update(label) {
    const scale = this.#window.devicePixelRatio;
    // Distinct engines can share a display label. UrlbarInput may just have
    // restored the unique engine name even when the measured label is cached.
    if (label !== null) this.#title.textContent = label;
    if (label === this.#label && scale === this.#scale) return;
    this.#label = label;
    this.#scale = scale;
    const generation = ++this.#generation;
    for (const name of ["--zen-site-search-title-width", "--zen-site-search-title-weight"])
      this.#title.style.removeProperty(name);
    if (label === null) return;
    try {
      const metrics = await this.#measure(label, scale);
      if (!metrics || this.#window.closed || generation !== this.#generation) return;
      this.#title.style.setProperty("--zen-site-search-title-width", `${metrics.width}px`);
      this.#title.style.setProperty("--zen-site-search-title-weight", metrics.weight);
    } catch { /* Intrinsic CSS layout remains available if native measurement fails. */ }
  }
}

/** A native context menu, shared by mouse and keyboard scope activation. */
export class SiteSearchMenu {
  #window;
  #bar;
  #options;
  #popup;
  #generation = 0;

  constructor(window, bar, options) {
    this.#window = window;
    this.#bar = bar;
    this.#options = options;
    const pill = window.document.getElementById("urlbar-search-mode-indicator");
    bar.addEventListener("searchmodechanged", () => {
      const active = !!this.#engine();
      for (const [name, value] of [["role", "button"], ["tabindex", "0"], ["aria-haspopup", "menu"]]) {
        if (active) pill.setAttribute(name, value);
        else pill.removeAttribute(name);
      }
      if (!active) pill.removeAttribute("aria-expanded");
    });
    pill.addEventListener("mousedown", event => {
      if (this.#engine()) event.preventDefault();
    });
    pill.addEventListener("click", event => {
      if (event.button === 0) this.#open(event).catch(console.error);
    });
    pill.addEventListener("contextmenu", event => this.#open(event).catch(console.error));
    pill.addEventListener("keydown", event => {
      if (["Enter", " ", "ArrowDown"].includes(event.key)) {
        this.#open(event, true).catch(console.error);
      } else if (event.key === "Escape" || (event.key === "Tab" && !event.shiftKey)) {
        event.preventDefault();
        event.stopPropagation();
        bar.inputField.focus();
      }
    });
    bar.addEventListener("keydown", event => {
      if (event.target === bar.inputField && event.key === "Tab" && event.shiftKey &&
          !event.ctrlKey && !event.altKey && !event.metaKey && this.#engine()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        pill.focus();
      }
    }, { capture: true });
    // Retain the view when Tab moves focus from the input to its scope.
    bar.addEventListener("blur", event => {
      if (event.relatedTarget === pill) event.stopImmediatePropagation();
    }, { capture: true });
  }

  #engine() {
    const mode = this.#bar.searchMode;
    return !mode?.isPreview && mode?.engineName &&
      this.#bar.controller.engineStore.getEngineByName(mode.engineName);
  }

  close() {
    this.#generation++;
    this.#popup?.hidePopup();
  }

  async #open(event, keyboard = false) {
    const engine = this.#engine();
    if (!engine) return;
    event.preventDefault();
    event.stopPropagation();
    if (this.#popup?.state === "open" || this.#popup?.state === "showing") return;
    const document = this.#window.document;
    const pill = document.getElementById("urlbar-search-mode-indicator");
    const make = tag => document.createXULElement(tag);
    if (!this.#popup) {
      this.#popup = make("menupopup");
      this.#popup.id = "zen-site-search-menu";
      this.#popup.addEventListener("popupshown", event => {
        if (event.target === this.#popup) pill.setAttribute("aria-expanded", "true");
      });
      this.#popup.addEventListener("popuphidden", event => {
        if (event.target === this.#popup) pill.setAttribute("aria-expanded", "false");
      });
      document.getElementById("mainPopupSet").append(this.#popup);
    }
    const menu = this.#popup;
    menu.replaceChildren();
    const generation = ++this.#generation;
    const snapshot = {
      engineName: engine.name,
      value: this.#bar.value,
      isCurrent: (allowRemovedMode = false) => !this.#window.closed &&
        generation === this.#generation && this.#bar.value === snapshot.value &&
        (this.#bar.searchMode?.engineName === engine.name ||
          (allowRemovedMode && !this.#bar.searchMode)),
    };
    const entries = this.#options.entries();
    const add = (parent, label, action, target = null, id = null, args = null) => {
      const item = make("menuitem");
      item.setAttribute("label", label);
      if (id) document.l10n.setAttributes(item, id, args);
      item.addEventListener("command", () => {
        if (snapshot.isCurrent()) {
          Promise.resolve(this.#options.command(action, target, snapshot)).catch(console.error);
        }
      });
      parent.append(item);
    };
    const name = siteSearchPresentation(engine, entries).label;
    add(menu, `Remove “${name}” Site Search`, "remove", engine.name,
      "zen-urlbar-site-search-remove", { engine: name });
    const change = make("menu");
    change.setAttribute("label", "Change Site Search");
    document.l10n.setAttributes(change, "zen-urlbar-site-search-change");
    const choices = make("menupopup");
    change.append(choices);
    menu.append(change);
    const alternatives = siteSearchAlternatives(
      this.#bar.controller.engineStore.getEngines(), engine.name, entries);
    let previous = null;
    for (const choice of alternatives) {
      if (previous && choice.general !== previous.general) choices.append(make("menuseparator"));
      add(choices, choice.label, "change", choice.engine.name);
      previous = choice;
    }
    change.disabled = !alternatives.length;
    menu.append(make("menuseparator"));
    add(menu, "Manage…", "manage", null, "zen-urlbar-site-search-manage");
    menu.append(make("menuseparator"));
    add(menu, "Learn More", "learn", null, "zen-urlbar-site-search-learn");
    // Flush Fluent before the native menu takes its snapshot of the labels.
    await document.l10n.translateElements([...menu.querySelectorAll("[data-l10n-id]")]);
    if (!snapshot.isCurrent()) return;
    if (keyboard) {
      const rect = pill.getBoundingClientRect();
      menu.openPopupAtScreen(this.#window.mozInnerScreenX + rect.left,
        this.#window.mozInnerScreenY + rect.bottom, true, event);
    } else {
      menu.openPopupAtScreen(event.screenX, event.screenY, true, event);
    }
  }
}
