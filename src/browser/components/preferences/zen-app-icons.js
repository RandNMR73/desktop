/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

var gZenAppIconPicker = {
  async init() {
    const group = document.getElementById("zenAppIconGroup");
    if (!group || this.initialized || Services.appinfo.OS !== "Darwin") return;
    this.initialized = true;
    this.api = ChromeUtils.importESModule("resource:///modules/ZenAppIcons.sys.mjs").ZenAppIcons;
    this.status = document.getElementById("zenAppIconStatus");
    this.grid = document.getElementById("zenAppIconChoices");
    this.reset = document.getElementById("zenAppIconReset");
    this.buttons = [];
    this.onChange = () => this.refresh();
    this.onUnload = () => {
      this.closed = true;
      Services.obs.removeObserver(this.onChange, "zen-app-icon-changed");
    };
    Services.obs.addObserver(this.onChange, "zen-app-icon-changed");
    window.addEventListener("unload", this.onUnload, { once: true });
    try {
      const rows = await this.api.list();
      if (this.closed) return;
      for (const row of rows) {
        const button = document.createElementNS("http://www.w3.org/1999/xhtml", "button");
        button.type = "button";
        button.className = "zen-app-icon-choice";
        button.dataset.slug = row.slug;
        button.setAttribute("aria-pressed", "false");
        const image = document.createElementNS("http://www.w3.org/1999/xhtml", "img");
        image.src = row.preview;
        image.alt = "";
        image.width = 88;
        image.height = 88;
        const label = document.createElementNS("http://www.w3.org/1999/xhtml", "span");
        label.textContent = row.label;
        button.append(image, label);
        button.addEventListener("click", () => this.choose(row.slug, row.label));
        this.buttons.push(button);
        this.grid.append(button);
      }
      this.reset.addEventListener("command", () => this.choose("", "Default icon"));
      this.refresh();
      if (!this.api.available) this.status.textContent = "App icon selection is unavailable in this build.";
    } catch {
      this.status.textContent = "App icons could not be loaded.";
      this.reset.disabled = true;
    }
  },

  refresh() {
    if (this.closed) return;
    const selected = this.api.selected;
    for (const button of this.buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.slug === selected));
      button.disabled = this.busy || !this.api.available;
    }
    this.reset.disabled = this.busy || !this.api.available || selected === "";
  },

  async choose(slug, label) {
    if (this.busy || this.closed) return;
    this.busy = true;
    this.status.textContent = "";
    this.refresh();
    try {
      await this.api.choose(slug);
      if (!this.closed) this.status.textContent = `${label} selected.`;
    } catch (error) {
      if (!this.closed) this.status.textContent = error.message;
    } finally {
      this.busy = false;
      this.refresh();
    }
  },
};
