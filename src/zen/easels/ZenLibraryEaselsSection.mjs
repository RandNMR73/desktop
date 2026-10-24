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
  static properties = { documents: { state: true }, archived: { state: true } };
  constructor() {
    super();
    this.documents = [];
    this.archived = false;
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
    super.disconnectedCallback();
  }
  onHidden() {
    ZenEasels.closePreview();
  }
  onLibraryClosing() {
    ZenEasels.closePreview();
  }
  async reload() {
    this.documents = await ZenEaselStore.list();
  }
  onSearchChanged() {
    this.requestUpdate();
  }
  renderItems() {
    const documents = this.documents.filter(
      (doc) =>
        doc.archived === this.archived &&
        doc.title.toLowerCase().includes(this.searchQuery.toLowerCase()),
    );
    return html` <link
        rel="stylesheet"
        href="chrome://browser/content/zen-easels/easel.css"
      />
      <div class="zen-library-easel-grid">
        <button
          class="zen-library-easel-card"
          @click=${() => ZenEasels.create()}
          data-l10n-id="library-easels-new"
        ></button>
        <button
          class="zen-library-easel-card"
          @click=${() => {
            this.archived = !this.archived;
          }}
          data-l10n-id=${this.archived ? "library-easels-show-active" : "library-easels-show-archive"}
        ></button>
        ${repeat(
          documents,
          (doc) => doc.id,
          (doc) =>
            html` <div class="zen-library-easel-card">
              <button @click=${() => ZenEasels.preview(doc.id, this.library)}>
                ${doc.title}
              </button>
              <button
                @click=${() => ZenEaselStore.archive(doc.id, !doc.archived)}
                data-l10n-id=${doc.archived ? "library-easels-restore" : "library-easels-archive"}
              ></button>
            </div>`,
        )}
      </div>`;
  }
}
customElements.define("zen-library-easels-section", ZenLibraryEaselsSection);
