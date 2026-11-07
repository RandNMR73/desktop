// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/** Resolve a bare alias, or the alias of a domain being completed. */
export function siteSearchEngine(query, engines, completionURL = null, entries = []) {
  // An explicit scheme, path or space is address/query input, not an alias.
  // In particular, do not trim a space typed after dismissing a scope.
  if (!query || /\s/u.test(query)) return null;
  const typed = query.toLowerCase();
  // Message providers enter through their configured command trigger. Their
  // domain aliases identify the provider for colors/history; typing a domain
  // (or completing part of one) must remain ordinary address input.
  const acceptsDomain = engine => !engine.hidden && !entries.some(entry =>
    entry.kind === "message" && (entry.key === engine.name || engine.aliases.includes(entry.key)));
  const exact = engines.find(engine => acceptsDomain(engine) &&
    engine.aliases.some(alias => alias.toLowerCase() === typed));
  if (exact) return exact;
  if (/[/:?#@]/u.test(query)) return null;
  // Imported providers can advertise a short trigger independently of browsing
  // history. Do not infer prefixes: e.g. "git" must still follow the actual
  // completion rather than arbitrarily choosing GitHub over GitLab.
  const configured = entries.find(entry => Array.isArray(entry.triggers) && entry.triggers.some(trigger =>
    typeof trigger === "string" && trigger.toLowerCase() === typed));
  if (configured) {
    const engine = engines.find(engine => !engine.hidden &&
      (engine.name === configured.key || engine.aliases.includes(configured.key)));
    if (engine) return engine;
  }
  let host;
  try {
    const uri = new URL(completionURL);
    if (!/^https?:$/.test(uri.protocol) || uri.username || uri.password) return null;
    host = uri.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
  if (!host.startsWith(typed)) return null;
  return engines.find(engine => acceptsDomain(engine) && engine.aliases.some(alias =>
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
    message: entry?.kind === "message",
    order: index < 0 ? Infinity : index,
  };
}

export function siteSearchAlternatives(engines, currentName, entries = []) {
  return engines.filter(engine => !engine.hidden && engine.name !== currentName)
    .map(engine => siteSearchPresentation(engine, entries))
    .sort((a, b) => Number(a.general) - Number(b.general) || a.order - b.order);
}

let historyWordSegments;
function historyWords(text) {
  historyWordSegments ??= new Intl.Segmenter("en", { granularity: "word" });
  return Array.from(historyWordSegments.segment(text.toLowerCase()))
    .filter(part => part.isWordLike).map(part => part.segment);
}

/** A conservative SQL prefilter for the word matcher below (places alias p).
 * SQLite lower() only folds ASCII. Keep Unicode text and IDN URLs eligible
 * for the full matcher instead of silently losing their case/host matches.
 */
export function siteSearchHistoryPrefilter(query) {
  const words = historyWords(query);
  if (!words.length) return { condition: "0", params: {} };
  return {
    condition: `(${words.map((_, i) =>
      `(instr(lower(p.url), :word${i}) > 0 OR instr(lower(p.title), :word${i}) > 0)`)
      .join(" AND ")}) OR p.url GLOB '*[^ -~]*' OR p.title GLOB '*[^ -~]*' OR instr(p.url, 'xn--') > 0`,
    params: Object.fromEntries(words.map((word, i) => [`word${i}`, word])),
  };
}

/** History text matching uses whole words, with prefixes of at least 3 characters. */
export function siteSearchHistoryMatcher(host, displayHost = value => value) {
  const query = historyWords(host);
  return (url, title) => {
    const text = [url.toLowerCase(), (title ?? "").toLowerCase()];
    if (url.includes("xn--")) {
      try { text.push(displayHost(new URL(url).hostname).toLowerCase()); } catch {}
    }
    if (!query.every(word => text.some(value => value.includes(word)))) return false;
    const words = text.flatMap(historyWords);
    return query.length > 0 && query.every(word => {
      const minimum = /^[\uac00-\ud7a3]/u.test(word) ? 2 : 3;
      return words.some(candidate => word.length >= minimum
        ? candidate.startsWith(word) : candidate === word);
    });
  };
}

export async function siteSearchHistoryPage(db, host, displayHost) {
  const words = historyWords(host);
  if (!words.length) return null;
  const params = Object.fromEntries(words.map((word, i) => [`word${i}`, word]));
  const candidates = words.map((_, i) =>
    `(instr(lower(p.url), :word${i}) > 0 OR instr(lower(p.title), :word${i}) > 0)`)
    .join(" AND ");
  const matches = siteSearchHistoryMatcher(host, displayHost);
  let before = null;
  let best = null;
  while (true) {
    const pages = [];
    const limit = before ? 32 : 1;
    await db.executeCached(`
      SELECT p.id, p.url, p.title, p.last_visit_date FROM moz_places p
      WHERE p.hidden = 0 AND p.last_visit_date IS NOT NULL
        AND ((${candidates}) OR p.title GLOB '*[^ -~]*' OR instr(p.url, 'xn--') > 0)
        ${before ? `AND p.last_visit_date <= :beforeDate
          AND (p.last_visit_date < :beforeDate OR p.id < :beforeId)` : ""}
        ${best ? "AND p.last_visit_date >= :bestDate" : ""}
      ORDER BY p.last_visit_date DESC, p.id DESC`,
    { ...params, ...(before ? { beforeDate: before.date, beforeId: before.id } : {}),
      ...(best ? { bestDate: best.date } : {}) }, (row, cancel) => {
      const url = row.getResultByName("url");
      if (matches(url, row.getResultByName("title"))) {
        pages.push({ id: row.getResultByName("id"), url, date: row.getResultByName("last_visit_date") });
        if (pages.length === limit) cancel();
      }
    });
    if (!pages.length) return best?.url ?? null;
    const ids = Object.fromEntries(pages.map((page, i) => [`id${i}`, page.id]));
    const visits = await db.executeCached(`
      SELECT v.place_id, v.visit_date, v.id FROM moz_historyvisits v
      WHERE v.place_id IN (${Object.keys(ids).map(key => `:${key}`).join(",")})
        AND v.visit_type IN (1, 2, 3, 5, 6, 9)
        AND NOT EXISTS (SELECT 1 FROM moz_historyvisits next
          WHERE next.from_visit = v.id AND next.visit_type IN (5, 6))
      ORDER BY v.visit_date DESC, v.id DESC LIMIT 1`, ids);
    if (visits.length) {
      const row = visits[0], date = row.getResultByName("visit_date"), id = row.getResultByName("id");
      if (!best || date > best.date || (date === best.date && id > best.id)) {
        best = { date, id, url: pages.find(page => page.id === row.getResultByName("place_id")).url };
      }
    }
    before = pages.at(-1);
    // Remaining pages cannot have a visible visit newer than their last visit.
    if (pages.length < limit || (best && best.date > before.date)) return best?.url ?? null;
  }
}

/** Find a scope's fallback icon through history, using its search URL's host. */
export async function siteSearchHistoryIcon(engine, { findPage, pageIcon }) {
  const submission = engine.getSubmission("", null, "searchbar");
  if (!submission?.uri?.spec) return null;
  const url = new URL(submission.uri.spec);
  if (!/^https?:$/.test(url.protocol) || !url.hostname) return null;
  // The alias can differ from the search host (e.g. a service's search
  // subdomain). Missing history or a missing favicon must not invent a color
  // from the installed engine icon, nor cache a miss across later visits.
  const page = await findPage(url.hostname);
  return page ? pageIcon(page) : null;
}

/** Keep the last loaded scope color until another loads or site search ends. */
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
    if (!resolveColor) {
      for (const name of ["--zen-site-search-color", "--zen-site-search-text-selection"])
        style.removeProperty(name);
      return false;
    }
    let applied = false;
    try {
      const resolved = await resolveColor();
      const color = typeof resolved === "string" ? resolved : resolved?.color;
      if (!current() || !color || !this.#window.CSS.supports("color", color)) return false;
      style.setProperty("--zen-site-search-color", color);
      applied = true;
      // A missing icon retains the previous pair. A newly loaded color uses the
      // window selection fallback until its own native palette is available.
      style.removeProperty("--zen-site-search-text-selection");
      if (resolved?.selection && this.#window.CSS.supports("color", resolved.selection)) {
        style.setProperty("--zen-site-search-text-selection", resolved.selection);
        return true;
      }
      // The registered property resolves calc() channels without clipping P3.
      // This runs on a scope change, never on ordinary typing or animation.
      const computed = this.#window.getComputedStyle(this.#bar)
        .getPropertyValue("--zen-native-command-fill");
      const selection = await this.#selection(computed);
      if (current() && selection) style.setProperty("--zen-site-search-text-selection", selection);
    } catch { /* Keep the current color and available selection fallback. */ }
    // A retained color is still useful for painting the pill, but is not a
    // newly available color that should trigger another entry splash.
    return applied;
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
    // Retain the view when accessibility navigation focuses the scope menu.
    bar.addEventListener("blur", event => {
      if (event.relatedTarget === pill) event.stopImmediatePropagation();
    }, { capture: true });
  }

  #engine() {
    const mode = this.#bar.searchMode;
    const engine = !mode?.isPreview && mode?.engineName &&
      this.#bar.controller.engineStore.getEngineByName(mode.engineName);
    // Arc's direct ChatGPT scope has no remove/change menu of its own.
    return engine && !siteSearchPresentation(engine, this.#options.entries()).message && engine;
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
