/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {
  EaselEditor,
  EASEL_COLORS,
  selectionBounds,
  resizeSelection,
  strokeItem,
} from "./ZenEaselModel.mjs";
const { ZenEaselStore } = ChromeUtils.importESModule(
  "resource:///modules/zen/ZenEaselStore.sys.mjs",
);

const HTML = "http://www.w3.org/1999/xhtml";
const SVG = "http://www.w3.org/2000/svg";
const BASE = "chrome://browser/content/zen-easels/";
const FONTS = {
  sans: "-apple-system, sans-serif",
  serif: "Georgia, serif",
  rounded: "ui-rounded, sans-serif",
  mono: "monospace",
};
const TOOLS = [
  "pointer",
  "image",
  "text",
  "ellipse",
  "rectangle",
  "arrow",
  "freehand",
];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** A browser-chrome canvas: page content never executes in this document. */
export class ZenEaselView {
  static async mount(host, document, options = {}) {
    options.signal?.throwIfAborted();
    const frame = host.ownerDocument.createElementNS(HTML, "iframe");
    frame.className = "zen-easel-frame";
    frame.setAttribute("title", document.title);
    Object.assign(frame.style, {
      position: "absolute",
      inset: "0",
      border: "0",
      width: "100%",
      height: "100%",
      background: "transparent",
    });
    const owner = host.ownerDocument.defaultView;
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        owner.clearTimeout(timeout);
        frame.removeEventListener("load", loaded, true);
        frame.removeEventListener("error", failed);
        options.signal?.removeEventListener("abort", aborted);
        owner.removeEventListener("unload", aborted);
        if (error) {
          frame.remove();
          reject(error);
        } else {
          resolve();
        }
      };
      const loaded = () => {
        if (frame.contentDocument?.documentURI === BASE + "easel.html") {
          finish();
        }
      };
      const failed = () => finish(new Error("Easel editor failed to load"));
      const aborted = () =>
        finish(new DOMException("Easel closed", "AbortError"));
      const timeout = owner.setTimeout(failed, 15000);
      frame.addEventListener("load", loaded, { capture: true });
      frame.addEventListener("error", failed);
      options.signal?.addEventListener("abort", aborted, { once: true });
      owner.addEventListener("unload", aborted, { once: true });
      frame.src = BASE + "easel.html";
      host.append(frame);
    });
    if (options.signal?.aborted) {
      frame.remove();
      options.signal.throwIfAborted();
    }
    const view = new ZenEaselView(
      frame.contentDocument.body,
      document,
      options,
    );
    view.frame = frame;
    return view;
  }

  constructor(host, document, { onChange, preview = false } = {}) {
    this.window = host.ownerDocument.defaultView;
    this.document = host.ownerDocument;
    this.onChange = onChange;
    this.editor = new EaselEditor(document, (changed) => {
      this.data = changed;
      onChange?.(changed);
      if (!this.editing) {
        this.render();
      }
    });
    this.data = this.editor.document;
    this.persisted = structuredClone(document);
    this.selected = new Set();
    this.assets = new Map();
    this.pendingAssets = new Map();
    this.nodes = new Map();
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.tool = "pointer";
    this.color = "#36db9e";
    this.abort = new this.window.AbortController();
    this.root = this.el("section", "zen-easel");
    this.root.classList.toggle("is-preview", preview);
    this.root.tabIndex = 0;
    this.root.setAttribute("aria-label", document.title);
    this.root.setAttribute("role", "region");
    const style = this.el("link");
    style.rel = "stylesheet";
    style.href = BASE + "easel.css";
    this.root.append(style);
    this.world = this.el("div", "zen-easel-world");
    this.selection = this.el("div", "zen-easel-selection");
    this.selection.hidden = true;
    for (const corner of ["nw", "ne", "sw", "se"]) {
      const handle = this.el("span", "zen-easel-handle");
      handle.dataset.corner = corner;
      this.selection.append(handle);
    }
    this.world.append(this.selection);
    this.root.append(this.world);
    this.controls = this.el("div", "zen-easel-controls");
    this.root.append(this.controls);
    const toolbar = this.el("div", "zen-easel-toolbar");
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Easel tools");
    this.buttons = new Map();
    for (const tool of TOOLS) {
      const button = this.button(
        tool[0].toUpperCase() + tool.slice(1),
        () => {
          if (tool === "image") {
            this.importImage().catch((error) => this.error(error));
          } else {
            this.tool = tool;
            this.updateTools();
          }
        },
        tool,
      );
      this.buttons.set(tool, button);
      toolbar.append(button);
    }
    toolbar.append(
      this.button("Duplicate", () => this.duplicate(), "duplicate"),
    );
    this.root.append(toolbar);
    const exportButton = this.button(
      "Export as PNG",
      () => this.exportPNG().catch((error) => this.error(error)),
      "export",
    );
    exportButton.classList.add("zen-easel-export");
    this.root.append(exportButton);
    this.notice = this.el("div", "zen-easel-notice");
    this.notice.setAttribute("role", "status");
    this.root.append(this.notice);
    host.append(this.root);
    this.listen(this.root, "click", () => {
      if (this.pendingTextEdit) {
        const id = this.pendingTextEdit;
        this.pendingTextEdit = null;
        this.editText(id, true);
      }
    });
    this.listen(this.root, "pointerdown", (event) => this.pointerDown(event));
    this.listen(this.root, "pointermove", (event) => this.pointerMove(event));
    this.listen(this.root, "pointerup", (event) => this.pointerUp(event));
    this.listen(this.root, "pointercancel", () => this.cancelGesture());
    this.listen(this.root, "keydown", (event) => this.keyDown(event));
    this.listen(this.root, "keyup", (event) => {
      if (event.code === "Space") {
        this.spaceDown = false;
      }
    });
    this.listen(this.root, "dblclick", (event) => {
      if (event.target.closest("button")) {
        return;
      }
      const id =
        event.target.closest("[data-item-id]")?.dataset.itemId ||
        this.lastClickItem;
      const item = this.data.items.find((entry) => entry.id === id);
      if (item?.type === "text") {
        this.editText(item.id);
      }
    });
    this.listen(this.root, "wheel", (event) => this.wheel(event), {
      passive: false,
    });
    this.listen(this.root, "contextmenu", (event) => this.contextMenu(event));
    this.listen(this.root, "dragover", (event) => {
      if (event.dataTransfer.types.includes("Files")) {
        event.preventDefault();
      }
    });
    this.listen(this.root, "drop", (event) => {
      event.preventDefault();
      const point = this.point(event);
      for (const file of event.dataTransfer.files) {
        this.addFile(file, point).catch((error) => this.error(error));
      }
    });
    this.listen(this.root, "copy", (event) => this.copy(event));
    this.listen(this.root, "cut", (event) => {
      if (this.copy(event)) {
        this.remove();
      }
    });
    this.listen(this.root, "paste", (event) => this.paste(event));
    this.render();
    this.updateTools();
    if (preview) {
      let previousWidth = this.data.viewportWidth;
      this.resizeObserver = new this.window.ResizeObserver(() => {
        const width = this.root.clientWidth;
        if (width && width !== previousWidth) {
          const ratio = width / previousWidth;
          this.zoom *= ratio;
          this.pan.x *= ratio;
          this.pan.y *= ratio;
          previousWidth = width;
          this.transform();
        }
      });
      this.resizeObserver.observe(this.root);
    }
  }
  el(tag, className = "") {
    const node = this.document.createElementNS(HTML, tag);
    node.className = className;
    return node;
  }
  listen(node, type, handler, options = {}) {
    node.addEventListener(type, handler, {
      ...options,
      signal: this.abort.signal,
    });
  }
  button(label, action, icon) {
    const button = this.el("button");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    if (icon) {
      button.dataset.icon = icon;
    } else {
      button.textContent = label;
    }
    button.addEventListener("pointerdown", (event) => event.preventDefault(), {
      signal: this.abort.signal,
    });
    button.addEventListener("click", action, { signal: this.abort.signal });
    return button;
  }
  error(error) {
    console.error(error);
    this.notice.textContent = error.message || "Unable to update Easel";
  }
  point(event) {
    const rect = this.root.getBoundingClientRect();
    return {
      x: (event.clientX - rect.x - this.pan.x) / this.zoom,
      y: (event.clientY - rect.y - this.pan.y) / this.zoom,
    };
  }
  center() {
    return {
      x: (this.root.clientWidth / 2 - this.pan.x) / this.zoom,
      y: (this.root.clientHeight / 2 - this.pan.y) / this.zoom,
    };
  }
  transform() {
    this.world.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
    this.updateSelection();
  }
  updateTools() {
    for (const [tool, button] of this.buttons) {
      button.setAttribute("aria-pressed", tool === this.tool);
    }
    this.root.dataset.tool = this.tool;
  }
  async asset(id) {
    if (this.assets.has(id)) {
      return this.assets.get(id);
    }
    if (!this.pendingAssets.has(id)) {
      this.pendingAssets.set(
        id,
        (async () => {
          const bytes = await ZenEaselStore.readAsset(id);
          if (this.destroyed) {
            return null;
          }
          const url = this.window.URL.createObjectURL(
            new this.window.Blob([bytes]),
          );
          const image = new this.window.Image();
          image.src = url;
          try {
            await image.decode();
          } catch (error) {
            this.window.URL.revokeObjectURL(url);
            throw error;
          }
          if (this.destroyed) {
            this.window.URL.revokeObjectURL(url);
            return null;
          }
          const asset = { url, image };
          this.assets.set(id, asset);
          return asset;
        })(),
      );
    }
    return this.pendingAssets.get(id);
  }
  layout(node, item) {
    const geometry = {
      left: `${item.x}px`,
      top: `${item.y}px`,
      width: `${item.width}px`,
      height: `${item.height}px`,
      transform: "",
    };
    for (const [property, value] of Object.entries(geometry)) {
      if (node.style[property] !== value) {
        node.style[property] = value;
      }
    }
  }
  render() {
    if (this.destroyed) {
      return;
    }
    this.data = this.editor.document;
    if (this.root.getAttribute("aria-label") !== this.data.title) {
      this.root.setAttribute("aria-label", this.data.title);
    }
    const ids = new Set(this.data.items.map((item) => item.id));
    for (const [id, node] of this.nodes) {
      if (!ids.has(id)) {
        node.remove();
        this.nodes.delete(id);
      }
    }
    let next = this.selection;
    // Keep unaffected DOM and decoded images alive. Iterating backwards lets
    // us reconcile z-order without moving nodes whose order did not change.
    for (let i = this.data.items.length - 1; i >= 0; i--) {
      const item = this.data.items[i];
      let node = this.nodes.get(item.id);
      if (node && node._easelItem?.type !== item.type) {
        node.remove();
        node = null;
      }
      if (!node) {
        node = this.el("div", `zen-easel-item zen-easel-${item.type}`);
        node.dataset.itemId = item.id;
        this.nodes.set(item.id, node);
      }
      this.layout(node, item);
      const previous = node._easelItem;
      const changed =
        !previous ||
        Object.keys(item).some((key) =>
          typeof item[key] === "object"
            ? JSON.stringify(item[key]) !== JSON.stringify(previous[key])
            : item[key] !== previous[key],
        );
      if (changed) {
        this.renderItem(node, item);
      }
      node._easelItem = item;
      if (node.nextSibling !== next) {
        this.world.insertBefore(node, next);
      }
      next = node;
    }
    this.selected = new Set(
      [...this.selected].filter((id) => this.nodes.has(id)),
    );
    this.updateSelection();
  }
  renderItem(node, item) {
    node.setAttribute("aria-label", item.text || item.alt || item.type);
    if (item.type === "text") {
      if (node.textContent !== item.text) {
        node.textContent = item.text;
      }
      Object.assign(node.style, {
        fontFamily: FONTS[item.font],
        fontSize: `${item.fontSize}px`,
        fontWeight: item.bold ? "700" : "400",
        fontStyle: item.italic ? "italic" : "normal",
        textAlign: item.align,
        color: item.color,
      });
    } else if (["rectangle", "ellipse"].includes(item.type)) {
      node.style.background = item.color;
    } else if (["arrow", "freehand"].includes(item.type)) {
      node.replaceChildren(this.strokeSVG(item));
    } else {
      if (node._easelItem?.assetId === item.assetId) {
        node.firstChild.alt = item.alt;
        return;
      }
      const img = this.el("img");
      img.alt = item.alt;
      img.draggable = false;
      node.replaceChildren(img);
      this.asset(item.assetId)
        .then((asset) => {
          if (
            asset &&
            node.isConnected &&
            node._easelItem?.assetId === item.assetId
          ) {
            img.src = asset.url;
          }
        })
        .catch((error) => this.error(error));
    }
  }
  strokeSVG(item) {
    const svg = this.document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", `0 0 ${item.width} ${item.height}`);
    svg.setAttribute("preserveAspectRatio", "none");
    const path = this.document.createElementNS(SVG, "path");
    path.setAttribute("d", this.path(item));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", item.color);
    path.setAttribute("stroke-width", item.strokeWidth);
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
    return svg;
  }
  path(item) {
    const points = item.points.map(([x, y]) => [
      x * item.width,
      y * item.height,
    ]);
    if (points.length === 1) {
      points.push([points[0][0] + 0.01, points[0][1]]);
    }
    let d = points
      .map((point, index) => `${index ? "L" : "M"}${point.join(" ")}`)
      .join(" ");
    if (item.type === "arrow" && points.length > 1) {
      const last = points.at(-1),
        first = points.at(-2);
      const angle = Math.atan2(last[1] - first[1], last[0] - first[0]);
      for (const offset of [-0.5, 0.5]) {
        d += ` M${last.join(" ")} L${last[0] - 14 * Math.cos(angle + offset)} ${last[1] - 14 * Math.sin(angle + offset)}`;
      }
    }
    return d;
  }
  selectedItems() {
    return this.data.items.filter((item) => this.selected.has(item.id));
  }
  updateSelection() {
    const items = this.selectedItems();
    const bounds = selectionBounds(items);
    this.selection.hidden = !bounds;
    const kind =
      items.length === 1 && items[0].type === "text"
        ? "text"
        : items.length &&
            items.every((item) => !["image", "capture"].includes(item.type))
          ? "color"
          : "none";
    const rebuild = this.controlKind !== kind;
    if (rebuild) {
      this.controls.replaceChildren();
      this.controls.className = "zen-easel-controls";
      this.controlKind = kind;
    }
    for (const [id, node] of this.nodes) {
      node.classList.toggle("selected", this.selected.has(id));
    }
    if (!bounds) {
      return;
    }
    this.layout(this.selection, bounds);
    const point = {
      x: bounds.x * this.zoom + this.pan.x,
      y: bounds.y * this.zoom + this.pan.y,
    };
    this.controls.style.left = `${Math.max(6, point.x)}px`;
    this.controls.style.top = `${Math.max(8, point.y - 84)}px`;
    if (kind === "text") {
      this.controls.classList.add("text-controls");
      this.controls.style.left = `${Math.max(6, point.x - 48)}px`;
      this.controls.style.top = `${Math.max(8, point.y + (bounds.height * this.zoom) / 2 - 40)}px`;
      if (!rebuild) {
        return;
      }
      this.controls.append(
        this.button(
          "Increase text size",
          () => {
            const item = this.selectedItems()[0];
            this.changeText(item, {
              fontSize: Math.min(256, item.fontSize + 2),
            });
          },
          "plus",
        ),
        this.button(
          "Change font",
          () => {
            const item = this.selectedItems()[0];
            this.changeText(item, {
              font: ["sans", "serif", "rounded", "mono"][
                (["sans", "serif", "rounded", "mono"].indexOf(item.font) + 1) %
                  4
              ],
            });
          },
          "font",
        ),
        this.button(
          "Decrease text size",
          () => {
            const item = this.selectedItems()[0];
            this.changeText(item, { fontSize: Math.max(8, item.fontSize - 2) });
          },
          "minus",
        ),
      );
    } else if (kind === "color") {
      this.controls.classList.add("color-controls");
      this.controls.style.left = `${Math.max(6, point.x + (bounds.width * this.zoom - 182) / 2)}px`;
      if (rebuild) {
        for (const color of EASEL_COLORS) {
          const button = this.button(`Color ${color}`, () => {
            this.color = color;
            this.editor.edit((doc) =>
              doc.items.forEach((item) => {
                if (this.selected.has(item.id)) {
                  item.color = color;
                }
              }),
            );
          });
          button.style.background = color;
          button.className = "zen-easel-color";
          button.textContent = "";
          button.dataset.color = color;
          this.controls.append(button);
        }
      }
      for (const button of this.controls.children) {
        const pressed = String(
          items.every((item) => item.color === button.dataset.color),
        );
        if (button.getAttribute("aria-pressed") !== pressed) {
          button.setAttribute("aria-pressed", pressed);
        }
      }
    }
  }
  changeText(item, changes) {
    this.finishText();
    this.editor.update(item.id, {
      ...changes,
      height: Math.max(item.height, (changes.fontSize || item.fontSize) * 1.5),
    });
  }
  pointerDown(event) {
    if (
      event.target.closest("button, .zen-easel-menu, [contenteditable=true]")
    ) {
      return;
    }
    if (event.button !== 0 && event.button !== 1) {
      return;
    }
    this.lastClickItem =
      event.target.closest("[data-item-id]")?.dataset.itemId || null;
    this.finishText();
    this.menu?.remove();
    this.root.focus();
    event.preventDefault();
    const start = this.point(event);
    if (this.spaceDown || event.button === 1) {
      this.gesture = {
        kind: "pan",
        start,
        client: [event.clientX, event.clientY],
        pan: { ...this.pan },
      };
    } else if (event.target.dataset.corner) {
      this.gesture = {
        kind: "resize",
        start,
        corner: event.target.dataset.corner,
        bounds: selectionBounds(this.selectedItems()),
        items: this.selectedItems(),
      };
    } else if (this.tool === "freehand" || this.tool === "arrow") {
      this.gesture = {
        kind: "stroke",
        start,
        type: this.tool,
        points: [[start.x, start.y]],
      };
      this.preview = this.el("div", "zen-easel-item zen-easel-freehand");
      this.world.append(this.preview);
    } else if (["rectangle", "ellipse", "text"].includes(this.tool)) {
      const type = this.tool,
        id = ZenEaselStore.id();
      this.selected = new Set([id]);
      this.editor.add({
        id,
        type,
        x: start.x - (type === "text" ? 140 : 100),
        y: start.y - (type === "text" ? 16.5 : 100),
        width: type === "text" ? 280 : 200,
        height: type === "text" ? 33 : 200,
        color: type === "text" ? "#ffffff" : this.color,
        text: "Start typing to enter text",
        fontSize: 22,
      });
      this.tool = "pointer";
      this.updateTools();
      if (type === "text") {
        this.pendingTextEdit = id;
      }
      return;
    } else {
      const id = event.target.closest("[data-item-id]")?.dataset.itemId;
      if (id) {
        if (event.shiftKey) {
          this.selected.has(id)
            ? this.selected.delete(id)
            : this.selected.add(id);
        } else if (!this.selected.has(id)) {
          this.selected = new Set([id]);
        }
        this.gesture = { kind: "move", start, items: this.selectedItems() };
      } else {
        this.selected.clear();
        this.gesture = { kind: "marquee", start };
        this.preview = this.el("div", "zen-easel-marquee");
        this.world.append(this.preview);
      }
    }
    this.updateSelection();
    this.root.setPointerCapture(event.pointerId);
  }
  pointerMove(event) {
    if (!this.gesture) {
      return;
    }
    this.gesture.last = this.point(event);
    this.gesture.clientLast = [event.clientX, event.clientY];
    if (this.gesture.kind === "stroke") {
      const point = this.gesture.last;
      if (this.gesture.type === "arrow") {
        this.gesture.points[1] = [point.x, point.y];
      } else {
        this.gesture.points.push([point.x, point.y]);
      }
    }
    this.animationFrame ??= this.window.requestAnimationFrame(() => {
      this.animationFrame = null;
      this.previewGesture();
    });
  }
  previewGesture() {
    const gesture = this.gesture;
    if (!gesture?.last) {
      return;
    }
    const dx = gesture.last.x - gesture.start.x,
      dy = gesture.last.y - gesture.start.y;
    this.controls.hidden = true;
    if (gesture.kind === "move") {
      for (const item of gesture.items) {
        this.nodes.get(item.id).style.transform = `translate(${dx}px, ${dy}px)`;
      }
    } else if (gesture.kind === "resize") {
      const bounds = { ...gesture.bounds };
      if (gesture.corner.includes("w")) {
        bounds.x += dx;
        bounds.width -= dx;
      } else {
        bounds.width += dx;
      }
      if (gesture.corner.includes("n")) {
        bounds.y += dy;
        bounds.height -= dy;
      } else {
        bounds.height += dy;
      }
      bounds.width = Math.max(4, bounds.width);
      bounds.height = Math.max(4, bounds.height);
      gesture.result = bounds;
      for (const item of resizeSelection(
        gesture.items,
        gesture.bounds,
        bounds,
      )) {
        this.layout(this.nodes.get(item.id), item);
      }
      this.layout(this.selection, bounds);
    } else if (gesture.kind === "stroke") {
      const item = strokeItem("preview", gesture.points, this.color);
      item.type = gesture.type;
      this.layout(this.preview, item);
      this.preview.replaceChildren(this.strokeSVG(item));
    } else if (gesture.kind === "pan") {
      this.pan = {
        x: gesture.pan.x + gesture.clientLast[0] - gesture.client[0],
        y: gesture.pan.y + gesture.clientLast[1] - gesture.client[1],
      };
      this.transform();
    } else {
      gesture.result = {
        x: Math.min(gesture.start.x, gesture.last.x),
        y: Math.min(gesture.start.y, gesture.last.y),
        width: Math.abs(dx),
        height: Math.abs(dy),
      };
      this.layout(this.preview, gesture.result);
    }
  }
  pointerUp(event) {
    if (!this.gesture) {
      return;
    }
    this.pointerMove(event);
    this.previewGesture();
    const gesture = this.gesture;
    this.cancelFrame();
    this.gesture = null;
    this.preview?.remove();
    this.preview = null;
    if (this.root.hasPointerCapture(event.pointerId)) {
      this.root.releasePointerCapture(event.pointerId);
    }
    this.controls.hidden = false;
    if (
      gesture.kind === "move" &&
      Math.hypot(
        gesture.last.x - gesture.start.x,
        gesture.last.y - gesture.start.y,
      ) < 1
    ) {
      // Keep the target node alive across both clicks of a double-click.
      for (const item of gesture.items) {
        this.nodes.get(item.id).style.transform = "";
      }
      this.updateSelection();
      return;
    }
    if (gesture.kind === "move") {
      this.editor.move(
        [...this.selected],
        gesture.last.x - gesture.start.x,
        gesture.last.y - gesture.start.y,
      );
    } else if (gesture.kind === "resize" && gesture.result) {
      this.editor.resize([...this.selected], gesture.result);
    } else if (gesture.kind === "stroke") {
      const item = strokeItem(ZenEaselStore.id(), gesture.points, this.color);
      item.type = gesture.type;
      this.selected = new Set([item.id]);
      this.editor.add(item);
      this.tool = "pointer";
      this.updateTools();
    } else if (gesture.kind === "marquee" && gesture.result) {
      const rect = gesture.result;
      this.selected = new Set(
        this.data.items
          .filter(
            (item) =>
              item.x < rect.x + rect.width &&
              item.x + item.width > rect.x &&
              item.y < rect.y + rect.height &&
              item.y + item.height > rect.y,
          )
          .map((item) => item.id),
      );
    }
    this.render();
  }
  cancelFrame() {
    if (this.animationFrame != null) {
      this.window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }
  cancelGesture() {
    this.cancelFrame();
    this.gesture = null;
    this.preview?.remove();
    this.preview = null;
    this.controls.hidden = false;
    this.render();
  }
  editText(id, selectAll = false) {
    this.finishText();
    const node = this.nodes.get(id);
    if (!node) {
      return;
    }
    this.editing = id;
    this.selected = new Set([id]);
    this.updateSelection();
    node.contentEditable = "true";
    node.spellcheck = false;
    node.focus();
    if (selectAll) {
      const range = this.document.createRange();
      range.selectNodeContents(node);
      const selection = this.window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    node.addEventListener("blur", () => this.finishText(), { once: true });
  }
  finishText() {
    if (!this.editing) {
      return;
    }
    const id = this.editing,
      node = this.nodes.get(id);
    this.editing = null;
    node.removeAttribute("contenteditable");
    this.editor.update(id, {
      text: node.innerText,
      height: Math.max(node.scrollHeight, node.offsetHeight),
    });
  }
  remove() {
    this.finishText();
    this.editor.remove([...this.selected]);
  }
  duplicate() {
    this.finishText();
    this.selected = new Set(
      this.editor.duplicate([...this.selected], () => ZenEaselStore.id()),
    );
    this.render();
  }
  keyDown(event) {
    if (this.editing) {
      if (event.key === "Escape") {
        this.finishText();
        this.root.focus();
        event.preventDefault();
      }
      return;
    }
    const key = event.key.toLowerCase(),
      command = event.metaKey || event.ctrlKey;
    let handled = true;
    if (key === "escape") {
      this.cancelGesture();
      this.selected.clear();
      this.menu?.remove();
      this.tool = "pointer";
      this.updateTools();
      this.updateSelection();
    } else if (command && key === "z") {
      event.shiftKey ? this.editor.redo() : this.editor.undo();
    } else if (command && key === "a") {
      this.selected = new Set(this.data.items.map((item) => item.id));
      this.updateSelection();
    } else if (command && key === "d") {
      this.duplicate();
    } else if (key === "delete" || key === "backspace") {
      this.remove();
    } else if (event.code === "Space") {
      this.spaceDown = true;
    } else if (key.startsWith("arrow")) {
      const step = event.shiftKey ? 10 : 1;
      this.editor.move(
        [...this.selected],
        key === "arrowleft" ? -step : key === "arrowright" ? step : 0,
        key === "arrowup" ? -step : key === "arrowdown" ? step : 0,
      );
    } else if (command && key === "0") {
      this.zoom = 1;
      this.pan = { x: 0, y: 0 };
      this.transform();
    } else {
      handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  wheel(event) {
    if (this.editing || event.target.closest(".zen-easel-menu")) {
      return;
    }
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const before = this.point(event),
        rect = this.root.getBoundingClientRect();
      this.zoom = clamp(this.zoom * Math.exp(-event.deltaY * 0.005), 0.1, 4);
      this.pan = {
        x: event.clientX - rect.x - before.x * this.zoom,
        y: event.clientY - rect.y - before.y * this.zoom,
      };
    } else {
      this.pan.x -= event.deltaX;
      this.pan.y -= event.deltaY;
    }
    this.transform();
  }
  contextMenu(event) {
    if (this.editing) {
      return;
    }
    event.preventDefault();
    const id = event.target.closest("[data-item-id]")?.dataset.itemId;
    if (id && !this.selected.has(id)) {
      this.selected = new Set([id]);
      this.updateSelection();
    }
    this.menu?.remove();
    this.menu = this.el("div", "zen-easel-menu");
    this.menu.setAttribute("role", "menu");
    const rect = this.root.getBoundingClientRect();
    this.menu.style.left = `${Math.max(0, Math.min(event.clientX - rect.x, rect.width - 200))}px`;
    this.menu.style.top = `${Math.max(0, Math.min(event.clientY - rect.y, rect.height - 220))}px`;
    const actions = this.selected.size
      ? [
          [
            "Bring to Front",
            () => this.editor.reorder([...this.selected], true),
          ],
          [
            "Send to Back",
            () => this.editor.reorder([...this.selected], false),
          ],
          ["Delete", () => this.remove()],
          ["Duplicate", () => this.duplicate()],
        ]
      : [
          ["Undo", () => this.editor.undo()],
          ["Redo", () => this.editor.redo()],
          [
            "Export as PNG",
            () => this.exportPNG().catch((error) => this.error(error)),
          ],
        ];
    for (const [label, action] of actions) {
      const button = this.button(label, () => {
        action();
        this.menu?.remove();
      });
      button.setAttribute("role", "menuitem");
      this.menu.append(button);
    }
    this.root.append(this.menu);
    this.menu.firstChild.focus();
  }
  copy(event) {
    if (this.editing || !this.selected.size) {
      return false;
    }
    event.preventDefault();
    const items = this.selectedItems();
    event.clipboardData.setData(
      "application/x-zen-easel+json",
      JSON.stringify(items),
    );
    event.clipboardData.setData(
      "text/plain",
      items
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n"),
    );
    return true;
  }
  paste(event) {
    if (this.editing) {
      event.preventDefault();
      // Plain text only: pasted HTML must never create chrome DOM elements.
      const selection = this.window.getSelection();
      if (selection.rangeCount) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const text = this.document.createTextNode(
          event.clipboardData.getData("text/plain"),
        );
        range.insertNode(text);
        range.setStartAfter(text);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      return;
    }
    const serialized = event.clipboardData.getData(
      "application/x-zen-easel+json",
    );
    if (serialized) {
      event.preventDefault();
      try {
        const items = JSON.parse(serialized);
        if (!Array.isArray(items) || items.length > 10000) {
          throw new TypeError("Invalid Easel clipboard");
        }
        const added = items.map((item) => ({
          ...item,
          id: ZenEaselStore.id(),
          isTitle: false,
          x: item.x + 24,
          y: item.y + 24,
        }));
        this.editor.edit((doc) => doc.items.push(...added));
        this.selected = new Set(added.map((item) => item.id));
        this.updateSelection();
      } catch (error) {
        this.error(error);
      }
    } else if (event.clipboardData.files.length) {
      event.preventDefault();
      for (const file of event.clipboardData.files) {
        this.addFile(file).catch((error) => this.error(error));
      }
    } else {
      const text = event.clipboardData.getData("text/plain");
      if (text) {
        event.preventDefault();
        const center = this.center(),
          id = ZenEaselStore.id();
        this.selected = new Set([id]);
        this.editor.add({
          id,
          type: "text",
          x: center.x - 140,
          y: center.y - 16.5,
          width: 280,
          height: 33,
          text,
          color: "#ffffff",
          fontSize: 22,
        });
      }
    }
  }
  async importImage() {
    const picker = Cc["@mozilla.org/filepicker;1"].createInstance(
      Ci.nsIFilePicker,
    );
    picker.init(
      this.window.browsingContext,
      "Add Image to Easel",
      Ci.nsIFilePicker.modeOpenMultiple,
    );
    picker.appendFilter("Images", "*.png;*.jpg;*.jpeg;*.gif;*.webp");
    if (
      (await new Promise((resolve) => picker.open(resolve))) !==
      Ci.nsIFilePicker.returnOK
    ) {
      return;
    }
    for (const file of picker.files) {
      const path = file.QueryInterface(Ci.nsIFile).path;
      const bytes = await IOUtils.read(path, {
        maxBytes: 32 * 1024 * 1024 + 1,
      });
      await this.addFile(
        new this.window.File([bytes], PathUtils.filename(path), {
          type: this.imageType(bytes),
        }),
      );
    }
  }
  imageType(bytes) {
    if (
      bytes[0] === 137 &&
      bytes[1] === 80 &&
      bytes[2] === 78 &&
      bytes[3] === 71
    ) {
      return "image/png";
    }
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
      return "image/jpeg";
    }
    if (String.fromCharCode(...bytes.slice(0, 6)).startsWith("GIF8")) {
      return "image/gif";
    }
    if (String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
      return "image/webp";
    }
    throw new TypeError("Use a PNG, JPEG, GIF, or WebP image");
  }
  async addFile(file, center = this.center()) {
    if (file.size > 32 * 1024 * 1024) {
      throw new TypeError("Easel images must be smaller than 32 MB");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const url = this.window.URL.createObjectURL(
      new this.window.Blob([bytes], { type: this.imageType(bytes) }),
    );
    const image = new this.window.Image();
    try {
      image.src = url;
      await image.decode();
    } finally {
      this.window.URL.revokeObjectURL(url);
    }
    if (this.destroyed) {
      return;
    }
    const assetId = await ZenEaselStore.putAsset(bytes),
      id = ZenEaselStore.id();
    const scale = Math.min(
      1,
      500 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const width = image.naturalWidth * scale,
      height = image.naturalHeight * scale;
    this.selected = new Set([id]);
    this.editor.add({
      id,
      type: "image",
      assetId,
      alt: file.name || "Image",
      x: center.x - width / 2,
      y: center.y - height / 2,
      width,
      height,
    });
  }
  async exportPNG() {
    this.finishText();
    const bounds = selectionBounds(this.data.items);
    if (!bounds) {
      return;
    }
    const scale = Math.min(
      2,
      8192 / Math.max(bounds.width + 80, bounds.height + 80),
    );
    const canvas = this.el("canvas");
    canvas.width = Math.ceil((bounds.width + 80) * scale);
    canvas.height = Math.ceil((bounds.height + 80) * scale);
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.translate(40 - bounds.x, 40 - bounds.y);
    for (const item of this.data.items) {
      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.fillStyle = item.color;
      ctx.strokeStyle = item.color;
      if (item.type === "rectangle") {
        ctx.fillRect(0, 0, item.width, item.height);
      } else if (item.type === "ellipse") {
        ctx.beginPath();
        ctx.ellipse(
          item.width / 2,
          item.height / 2,
          item.width / 2,
          item.height / 2,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      } else if (["freehand", "arrow"].includes(item.type)) {
        ctx.lineWidth = item.strokeWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke(new this.window.Path2D(this.path(item)));
      } else if (item.type === "text") {
        ctx.font = `${item.italic ? "italic " : ""}${item.bold ? "700 " : ""}${item.fontSize}px ${FONTS[item.font]}`;
        ctx.textBaseline = "top";
        ctx.textAlign = item.align;
        const x =
          item.align === "center"
            ? item.width / 2
            : item.align === "right"
              ? item.width
              : 0;
        let y = 0;
        for (const paragraph of item.text.split("\n")) {
          let line = "";
          for (const word of paragraph.split(" ")) {
            const next = line ? line + " " + word : word;
            if (line && ctx.measureText(next).width > item.width) {
              ctx.fillText(line, x, y);
              y += item.fontSize * 1.5;
              line = word;
            } else {
              line = next;
            }
          }
          ctx.fillText(line, x, y);
          y += item.fontSize * 1.5;
        }
      } else {
        const asset = await this.asset(item.assetId);
        if (asset) {
          ctx.drawImage(asset.image, 0, 0, item.width, item.height);
        }
      }
      ctx.restore();
    }
    const picker = Cc["@mozilla.org/filepicker;1"].createInstance(
      Ci.nsIFilePicker,
    );
    picker.init(
      this.window.browsingContext,
      "Export Easel",
      Ci.nsIFilePicker.modeSave,
    );
    picker.defaultString = this.data.title.replace(/[/:\\]/g, "-") + ".png";
    picker.appendFilter("PNG Image", "*.png");
    picker.defaultExtension = "png";
    const result = await new Promise((resolve) => picker.open(resolve));
    if (
      ![Ci.nsIFilePicker.returnOK, Ci.nsIFilePicker.returnReplace].includes(
        result,
      )
    ) {
      return;
    }
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    await IOUtils.write(
      picker.file.path,
      new Uint8Array(await blob.arrayBuffer()),
      { tmpPath: picker.file.path + ".tmp" },
    );
  }
  destroy() {
    this.resizeObserver?.disconnect();
    this.finishText();
    this.destroyed = true;
    this.cancelFrame();
    this.abort.abort();
    for (const asset of this.assets.values()) {
      this.window.URL.revokeObjectURL(asset.url);
    }
    this.assets.clear();
    this.root.remove();
    this.frame?.remove();
  }
}
