/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html, when } from "chrome://global/content/vendor/lit.all.mjs";
import { MozLitElement } from "chrome://global/content/lit-utils.mjs";

const SEARCH_DEBOUNCE_MS = 250;

export const PAGE_SIZE = 100;
export const MS_PER_DAY = 86400000;
const WHEN_DAYS = { today: 1, week: 7, month: 30 };

/**
 * Builds the exclusive "when" filter group shared by time-based sections.
 *
 * @param {string} titleL10nId - Fluent id of the group title
 */
export function whenFilterGroup(titleL10nId) {
  return {
    id: "when",
    titleL10nId,
    exclusive: true,
    options: Object.keys(WHEN_DAYS).map(id => ({
      id,
      l10nId: `library-filter-${id}`,
    })),
  };
}

export class ZenLibrarySearchSection extends MozLitElement {
  static properties = {
    searchQuery: { type: String, state: true },
    filtersOpen: { type: Boolean, state: true },
  };

  #searchDebounce = null;
  #sentinelObserver = null;
  #filterBefore = null;
  #filterMotion = null;
  #filterResizeObserver = null;
  #filterReducedMotion = null;
  #outgoingSelectedFilters = [];
  #skipFilterAnimation = false;

  constructor() {
    super();
    this.searchQuery = "";
    this.filtersOpen = false;
    this.activeFilters = new Set();
  }

  createRenderRoot() {
    return this;
  }

  get searchPlaceholderL10nId() {
    return "";
  }

  get filterTitleL10nId() {
    return "";
  }

  get showSelectedFilters() {
    return false;
  }

  get animateFilterChanges() {
    return false;
  }

  get searchIcon() {
    return "chrome://browser/skin/zen-icons/search-glass.svg";
  }

  get filterIcon() {
    return "chrome://browser/skin/zen-icons/circle-bars-filter.svg";
  }

  /**
   * Filter groups shown in the filter panel. Sections without filters keep
   * this empty, which also hides the filter button. An `exclusive` group
   * behaves like a radio group where the active option can also be toggled
   * back off.
   *
   * @returns {{id: string, titleL10nId: string, exclusive?: boolean,
   *            options: {id: string, l10nId?: string, label?: string,
   *                      icon?: string, disabled?: boolean}[]}[]}
   */
  get filterGroups() {
    return [];
  }

  renderItems() {
    return null;
  }

  onSearchChanged() {}
  onFiltersChanged() {}
  onListScrolledToEnd() {}

  normalizeSearchQuery(value) {
    return value.trim();
  }

  isFilterActive(groupId, optionId) {
    return this.activeFilters.has(`${groupId}:${optionId}`);
  }

  /**
   * Number of days selected in the "when" filter group, or null when no
   * option is active.
   */
  get activeWhenDays() {
    for (const [id, days] of Object.entries(WHEN_DAYS)) {
      if (this.isFilterActive("when", id)) {
        return days;
      }
    }
    return null;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.#searchDebounce) {
      clearTimeout(this.#searchDebounce);
      this.#searchDebounce = null;
    }
    this.#sentinelObserver?.disconnect();
    this.#sentinelObserver = null;
    this.#cancelFilterMotion();
    this.#filterResizeObserver?.disconnect();
    this.#filterResizeObserver = null;
    this.#filterReducedMotion?.removeEventListener("change", this.#onReducedMotion);
    this.#filterReducedMotion = null;
  }

  firstUpdated() {
    if (super.firstUpdated) {
      super.firstUpdated();
    }

    const results = this.querySelector(".zen-library-search-results");
    this.#sentinelObserver = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          this.onListScrolledToEnd();
        }
      },
      { root: results, rootMargin: "200px" }
    );
    this.#sentinelObserver.observe(
      this.querySelector(".zen-library-search-sentinel")
    );

    results.addEventListener(
      "scroll",
      () => results.toggleAttribute("scrolled", results.scrollTop > 0),
      { passive: true }
    );

    if (this.animateFilterChanges) {
      this.#filterReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.#filterReducedMotion.addEventListener("change", this.#onReducedMotion);
      this.#filterResizeObserver = new ResizeObserver(() => {
        const motion = this.#filterMotion;
        if (!motion) return;
        const rect = motion.target.getBoundingClientRect();
        // Width/profile changes are ordinary reflows, outside the filter
        // transaction. Release its old height rather than clipping new rows.
        if (rect.width !== motion.width || rect.height !== motion.height) {
          this.#cancelFilterMotion();
        }
      });
      for (const mode of this.querySelectorAll(".zen-library-search-mode, .zen-library-filter-mode")) {
        this.#filterResizeObserver.observe(mode);
      }
    }
  }

  willUpdate(changedProperties) {
    super.willUpdate?.(changedProperties);
    if (!this.animateFilterChanges || !changedProperties.has("filtersOpen")) return;
    const top = this.querySelector(".zen-library-search-top");
    if (!top) return;
    if (this.filtersOpen) this.#outgoingSelectedFilters = this.#selectedFilters();
    const search = this.querySelector(".zen-library-search-mode");
    const filter = this.querySelector(".zen-library-filter-mode");
    // Read the current presentation before Lit changes the active branch.
    // Reversing a running transaction starts here, not at its old endpoint.
    this.#filterBefore = {
      height: top.getBoundingClientRect().height,
      searchOpacity: getComputedStyle(search).opacity,
      filterOpacity: getComputedStyle(filter).opacity,
    };
  }

  updated(changedProperties) {
    if (super.updated) {
      super.updated(changedProperties);
    }
    if (this.animateFilterChanges && changedProperties.has("filtersOpen")) {
      this.#animateFilterMode();
    } else if (changedProperties.has("filtersOpen") && this.filtersOpen) {
      const inner = this.querySelector(".zen-library-filter-panel-inner");
      this.style.setProperty(
        "--zen-library-filter-height",
        `${inner.scrollHeight + 8}px`
      );
    }
  }

  #onReducedMotion = () => {
    if (this.#filterReducedMotion.matches) this.#cancelFilterMotion();
  };

  #cancelFilterMotion() {
    const motion = this.#filterMotion;
    this.#filterMotion = null;
    for (const animation of motion?.animations ?? []) animation.cancel();
  }

  #animateFilterMode() {
    const before = this.#filterBefore;
    this.#filterBefore = null;
    this.#cancelFilterMotion();
    const skip = this.#skipFilterAnimation;
    this.#skipFilterAnimation = false;
    if (!before || skip || this.#filterReducedMotion?.matches ||
        !this.closest("zen-library[open]") || !this.getClientRects().length) return;
    const top = this.querySelector(".zen-library-search-top");
    const search = this.querySelector(".zen-library-search-mode");
    const filter = this.querySelector(".zen-library-filter-mode");
    const target = this.filtersOpen ? filter : search;
    const rect = target.getBoundingClientRect();
    const height = top.getBoundingClientRect().height;
    // PageHeaderView uses timingCurve(.25, .1, .25, 1, duration: .3).
    // Each branch retains its natural geometry while the results move below it.
    const options = { duration: 300, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)" };
    const motion = this.#filterMotion = {
      target, width: rect.width, height: rect.height,
      animations: [
        top.animate([{ height: `${before.height}px` }, { height: `${height}px` }], options),
        search.animate([{ opacity: before.searchOpacity }, { opacity: this.filtersOpen ? 0 : 1 }], options),
        filter.animate([{ opacity: before.filterOpacity }, { opacity: this.filtersOpen ? 1 : 0 }], options),
      ],
    };
    Promise.all(motion.animations.map(animation => animation.finished)).then(() => {
      if (this.#filterMotion === motion) this.#cancelFilterMotion();
    }, () => {});
  }

  #resetFilterMode() {
    if (!this.animateFilterChanges) return;
    this.#cancelFilterMotion();
    this.#filterBefore = null;
    if (this.filtersOpen) {
      this.#skipFilterAnimation = true;
      this.filtersOpen = false;
    }
  }

  onHidden() { this.#resetFilterMode(); }
  onLibraryClosing() { this.#resetFilterMode(); }

  #onSearchInput(event) {
    const { value } = event.target;
    if (this.#searchDebounce) {
      clearTimeout(this.#searchDebounce);
    }
    this.#searchDebounce = setTimeout(() => {
      this.#searchDebounce = null;
      const query = this.normalizeSearchQuery(value);
      if (query !== this.searchQuery) {
        this.searchQuery = query;
        this.onSearchChanged();
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  #toggleFilter(group, optionId) {
    const key = `${group.id}:${optionId}`;
    const wasActive = this.activeFilters.has(key);
    if (group.exclusive) {
      for (const option of group.options) {
        this.activeFilters.delete(`${group.id}:${option.id}`);
      }
    }
    if (wasActive) {
      this.activeFilters.delete(key);
    } else {
      this.activeFilters.add(key);
    }
    this.requestUpdate();
    this.onFiltersChanged();
  }

  #renderFilterOption(group, option) {
    return html`
      <button
        class="zen-library-filter-chip"
        ?active=${this.isFilterActive(group.id, option.id)}
        aria-pressed=${this.isFilterActive(group.id, option.id)}
        data-filter-group=${group.id}
        data-filter-option=${option.id}
        ?disabled=${option.disabled}
        @click=${() => this.#toggleFilter(group, option.id)}
      >
        ${when(option.icon, () => html`<img src=${option.icon} alt="" />`)}
        ${
          option.l10nId
            ? html`<span data-l10n-id=${option.l10nId}></span>`
            : html`<span>${option.label}</span>`
        }
      </button>
    `;
  }

  #selectedFilters() {
    return this.filterGroups.flatMap(group => group.options
      .filter(option => this.isFilterActive(group.id, option.id))
      .map(option => ({ group, option })));
  }

  #renderSelectedFilters() {
    const selected = this.animateFilterChanges && this.filtersOpen
      ? this.#outgoingSelectedFilters : this.#selectedFilters();
    return when(selected.length, () => html`
      <div class="zen-library-selected-filters">
        ${selected.map(({ group, option }) => html`
          <button class="zen-library-selected-filter"
            data-filter-group=${group.id} data-filter-option=${option.id}
            @click=${() => this.#toggleFilter(group, option.id)}>
            <img src="chrome://browser/skin/zen-icons/library/search-remove.svg"
              data-l10n-id="library-filter-remove" />
            ${option.l10nId
              ? html`<span data-l10n-id=${option.l10nId}></span>`
              : html`<span>${option.label}</span>`}
          </button>`)}
      </div>`);
  }

  #renderFilterPanel() {
    return html`
      <div class="zen-library-filter-header" ?inert=${!this.filtersOpen}>
        <h2 data-l10n-id=${this.filterTitleL10nId}></h2>
        <button
          class="zen-library-filter-done"
          data-l10n-id="library-filter-done"
          @click=${() => {
            this.filtersOpen = false;
          }}
        ></button>
      </div>
      <div class="zen-library-filter-panel">
        <div class="zen-library-filter-panel-inner" ?inert=${!this.filtersOpen}>
          ${this.filterGroups.map(
            group => html`
              <div class="zen-library-filter-group">
                <h3 data-l10n-id=${group.titleL10nId}></h3>
                <div class="zen-library-filter-options">
                  ${group.options.map(option =>
                    this.#renderFilterOption(group, option)
                  )}
                </div>
              </div>
            `
          )}
        </div>
      </div>
    `;
  }

  #faded = false;

  async onShown() {
    if (this.#faded) {
      this.removeAttribute("fade-in");
    } else {
      this.#faded = true;
      this.setAttribute("fade-in", "true");
    }
    await this.updateComplete;
    this.focusSearch();
  }

  /** Called when the library opens on this section, already shown. */
  async onLibraryOpened() {
    await this.updateComplete;
    this.focusSearch();
  }

  /** Puts the keyboard in the search field, which is what it is here for. */
  focusSearch() {
    this.querySelector(".zen-library-search-box input")?.focus();
  }

  render() {
    const hasFilters = !!this.filterGroups.length;
    return html`
      <div class="zen-library-search-top" ?open=${this.filtersOpen}>
        <div class="zen-library-search-mode" ?inert=${this.filtersOpen}
          aria-hidden=${this.filtersOpen}>
        <div class="zen-library-search-header" ?inert=${this.filtersOpen}>
          <div class="zen-library-search-box">
            <img
              src=${this.searchIcon}
              alt=""
            />
            <input
              type="search"
              data-l10n-id=${this.showSelectedFilters && this.activeFilters.size
                ? "library-filtered-search-placeholder" : this.searchPlaceholderL10nId}
              @input=${this.#onSearchInput}
            />
          </div>
          ${when(
            hasFilters,
            () => html`
              <button
                class="zen-library-filter-button"
                aria-expanded=${this.filtersOpen}
                @click=${() => {
                  this.filtersOpen = true;
                }}
              >
                <img
                  src=${this.filterIcon}
                  draggable="false"
                  alt=""
                />
                <span data-l10n-id="library-filter-button"></span>
              </button>
            `
          )}
        </div>
        ${when(this.showSelectedFilters && (!this.filtersOpen || this.animateFilterChanges),
          () => this.#renderSelectedFilters())}
        </div>
        <div class="zen-library-filter-mode" ?inert=${!this.filtersOpen}
          aria-hidden=${!this.filtersOpen}>
          ${when(hasFilters, () => this.#renderFilterPanel())}
        </div>
      </div>
      <div class="zen-library-search-results">
        ${this.renderItems()}
        <div class="zen-library-search-sentinel"></div>
      </div>
    `;
  }
}
