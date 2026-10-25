/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { html, repeat } from "chrome://global/content/vendor/lit.all.mjs";
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
  };
  constructor() {
    super();
    this.documents = [];
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
    this.contextPopup?.remove();
    this.contextPopup = null;
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
  closeMenu() {
    this.contextPopup?.hidePopup();
    this.menuDocument = null;
  }
  showMenu(event, doc) {
    event.preventDefault();
    this.closeMenu();
    this.menuDocument = doc.id;
    if (!this.contextPopup) {
      this.contextPopup = document.createXULElement("menupopup");
      this.contextPopup.id = "zen-library-easel-context-menu";
      const remove = document.createXULElement("menuitem");
      document.l10n.setAttributes(remove, "library-easels-delete");
      remove.addEventListener("command", () => {
        if (this.menuDocument) {
          ZenEasels.confirmDelete(this.menuDocument).catch(console.error);
        }
      });
      this.contextPopup.append(remove);
      document.getElementById("mainPopupSet").append(this.contextPopup);
    }
    if (event.screenX || event.screenY) {
      this.contextPopup.openPopupAtScreen(event.screenX, event.screenY, true);
    } else {
      this.contextPopup.openPopup(
        event.currentTarget,
        "after_start",
        0,
        0,
        true,
      );
    }
  }
  renderItems() {
    const documents = this.documents.filter((doc) =>
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
    </div>`;
  }
}
customElements.define("zen-library-easels-section", ZenLibraryEaselsSection);
