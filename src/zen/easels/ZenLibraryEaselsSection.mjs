/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  html,
  repeat,
  nothing,
} from "chrome://global/content/vendor/lit.all.mjs";
import { ZenLibrarySearchSection } from "moz-src:///zen/library/sections/ZenLibrarySearchSection.mjs";
const { ZenEaselStore, EASEL_CHANGED } = ChromeUtils.importESModule(
  "resource:///modules/zen/ZenEaselStore.sys.mjs",
);
import { ZenEasels } from "./ZenEasels.mjs";

export class ZenLibraryEaselsSection extends ZenLibrarySearchSection {
  static id = "easels";
  static label = "library-easels-section-title";
  static render(library) {
    return html`<zen-library-easels-section
      class="zen-library-section"
      data-section="easels"
      .library=${library}
    ></zen-library-easels-section>`;
  }
  static properties = {
    documents: { state: true },
    archived: { state: true },
    menu: { state: true },
  };
  constructor() {
    super();
    this.documents = [];
    this.archived = false;
    this.menu = null;
  }
  get searchPlaceholderL10nId() {
    return "library-easels-search-placeholder";
  }
  #observer = { observe: () => this.reload() };
  connectedCallback() {
    super.connectedCallback();
    Services.obs.addObserver(this.#observer, EASEL_CHANGED);
    this.reload();
  }
  disconnectedCallback() {
    Services.obs.removeObserver(this.#observer, EASEL_CHANGED);
    ZenEasels.closePreview();
    this.closeMenu();
    super.disconnectedCallback();
  }
  onHidden() {
    this.closeMenu();
    ZenEasels.closePreview();
  }
  onLibraryClosing() {
    this.closeMenu();
    ZenEasels.closePreview();
  }
  async reload() {
    this.documents = await ZenEaselStore.list();
  }
  onSearchChanged() {
    this.requestUpdate();
  }
  #dismissMenu = (event) => {
    if (event.type === "keydown" && event.key !== "Escape") return;
    if (
      event.type === "pointerdown" &&
      event.target.closest(".zen-library-easel-menu")
    )
      return;
    const anchor = this.menu?.anchor;
    this.closeMenu();
    if (event.type === "keydown" && anchor?.isConnected) anchor.focus();
  };
  closeMenu() {
    this.menu = null;
    window.removeEventListener("pointerdown", this.#dismissMenu, true);
    window.removeEventListener("keydown", this.#dismissMenu, true);
    window.removeEventListener("scroll", this.#dismissMenu, true);
  }
  showMenu(event, doc) {
    event.preventDefault();
    this.closeMenu();
    const results = this.querySelector(".zen-library-search-results");
    const rect = results.getBoundingClientRect();
    this.menu = {
      doc,
      anchor: event.currentTarget,
      x:
        Math.max(0, Math.min(event.clientX - rect.x, rect.width - 150)) +
        results.scrollLeft,
      y:
        Math.max(0, Math.min(event.clientY - rect.y, rect.height - 50)) +
        results.scrollTop,
    };
    window.addEventListener("pointerdown", this.#dismissMenu, true);
    window.addEventListener("keydown", this.#dismissMenu, true);
    window.addEventListener("scroll", this.#dismissMenu, true);
    this.updateComplete.then(() =>
      this.querySelector(".zen-library-easel-menu button")?.focus(),
    );
  }
  renderItems() {
    const documents = this.documents.filter(
      (doc) =>
        doc.archived === this.archived &&
        doc.title.toLowerCase().includes(this.searchQuery.toLowerCase()),
    );
    return html` <div class="zen-library-easel-grid">
        ${repeat(
          documents,
          (doc) => doc.id,
          (doc) =>
            html` <button
              class="zen-library-easel-card"
              title=${doc.title}
              @click=${() => ZenEasels.preview(doc.id, this.library)}
              @contextmenu=${(event) => this.showMenu(event, doc)}
            >
              <span
                class="zen-library-easel-card-icon"
                aria-hidden="true"
              ></span>
              <span class="zen-library-easel-card-title">${doc.title}</span>
            </button>`,
        )}
      </div>
      <div class="zen-library-easel-actions">
        <button
          @click=${() => ZenEasels.create()}
          data-l10n-id="library-easels-new"
        ></button>
        <button
          @click=${() => {
            this.closeMenu();
            this.archived = !this.archived;
          }}
          data-l10n-id=${this.archived ? "library-easels-show-active" : "library-easels-show-archive"}
        ></button>
      </div>
      ${
        this.menu
          ? html`<div
              class="zen-library-easel-menu"
              role="menu"
              style=${`left:${Math.max(0, this.menu.x)}px;top:${Math.max(0, this.menu.y)}px`}
            >
              <button
                role="menuitem"
                @click=${() => {
                  const doc = this.menu.doc;
                  this.closeMenu();
                  ZenEaselStore.archive(doc.id, !doc.archived);
                }}
                data-l10n-id=${this.menu.doc.archived ? "library-easels-restore" : "library-easels-archive"}
              ></button>
            </div>`
          : nothing
      }`;
  }
}
customElements.define("zen-library-easels-section", ZenLibraryEaselsSection);
