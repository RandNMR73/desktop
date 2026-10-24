/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Pure document/editing model. The view previews pointer moves without copying
// the document; persistence and undo checkpoints happen once per gesture.
export const EASEL_TYPES = new Set([
  "text",
  "rectangle",
  "ellipse",
  "arrow",
  "freehand",
  "image",
  "capture",
]);
export const EASEL_COLORS = [
  "#000000",
  "#ffdc52",
  "#ffad69",
  "#ff634b",
  "#36db9e",
  "#38871e",
  "#ffffff",
  "#bfbfbf",
  "#da36aa",
  "#22c4ed",
  "#4b39ef",
];
const copy = (value) => structuredClone(value);
const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const coordinate = (value) => clamp(finite(value, 0), -1e6, 1e6);
const extent = (value) => clamp(finite(value, 200), 1, 1e6);
const identifier = (value) =>
  typeof value === "string" && /^[\w-]{1,100}$/.test(value);

export function safeSourceURL(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function normalizeItem(raw) {
  if (!raw || !identifier(raw.id) || !EASEL_TYPES.has(raw.type)) {
    throw new TypeError("Invalid Easel item");
  }
  const item = {
    id: raw.id,
    type: raw.type,
    x: coordinate(raw.x),
    y: coordinate(raw.y),
    width: extent(raw.width),
    height: extent(raw.height),
    color: /^#[\da-f]{6}$/i.test(raw.color) ? raw.color : "#ffffff",
  };
  if (raw.type === "text") {
    Object.assign(item, {
      text: String(raw.text ?? "").slice(0, 100000),
      fontSize: clamp(finite(raw.fontSize, 22), 8, 256),
      font: ["sans", "serif", "rounded", "mono"].includes(raw.font)
        ? raw.font
        : "sans",
      bold: !!raw.bold,
      italic: !!raw.italic,
      align: ["left", "center", "right"].includes(raw.align)
        ? raw.align
        : "left",
      isTitle: !!raw.isTitle,
    });
  }
  if (["arrow", "freehand"].includes(raw.type)) {
    const points = Array.isArray(raw.points)
      ? raw.points
      : [
          [0, 1],
          [1, 0],
        ];
    item.points = points
      .filter(
        (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite),
      )
      .slice(0, 100000)
      .map(([x, y]) => [clamp(x, 0, 1), clamp(y, 0, 1)]);
    item.strokeWidth = clamp(finite(raw.strokeWidth, 3), 1, 40);
  }
  if (["image", "capture"].includes(raw.type)) {
    if (!identifier(raw.assetId)) {
      throw new TypeError("Invalid Easel image asset");
    }
    item.assetId = raw.assetId;
    item.alt = String(raw.alt ?? "").slice(0, 10000);
  }
  if (raw.type === "capture") {
    item.sourceURL = safeSourceURL(raw.sourceURL);
    item.capture = {
      x: Math.max(0, coordinate(raw.capture?.x)),
      y: Math.max(0, coordinate(raw.capture?.y)),
      width: extent(raw.capture?.width),
      height: extent(raw.capture?.height),
      viewportWidth: extent(raw.capture?.viewportWidth),
      viewportHeight: extent(raw.capture?.viewportHeight),
    };
  }
  return item;
}

export function normalizeDocument(raw) {
  if (
    !raw ||
    raw.version !== 1 ||
    !identifier(raw.id) ||
    !Array.isArray(raw.items)
  ) {
    throw new TypeError("Unsupported Easel document");
  }
  const items = raw.items.map(normalizeItem);
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new TypeError("Duplicate Easel item identifier");
  }
  const title = items.find((item) => item.isTitle);
  return {
    version: 1,
    id: raw.id,
    title: String(raw.title || "Untitled Easel").slice(0, 1000),
    createdAt: finite(raw.createdAt, Date.now()),
    updatedAt: finite(raw.updatedAt, Date.now()),
    archived: !!raw.archived,
    viewportWidth: extent(
      raw.viewportWidth ?? (title ? title.x * 2 + title.width : 1482),
    ),
    items,
  };
}

// Merge edits from two browser windows against the last version both saw.
// Independent fields combine; conflicting edits retain both objects instead
// of silently overwriting either user's work. Deletion loses to a newer edit.
export function mergeDocuments(
  base,
  local,
  remote,
  makeId = () => crypto.randomUUID(),
) {
  if (base.id !== local.id || base.id !== remote.id) {
    throw new TypeError("Cannot merge different Easels");
  }
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const index = (doc) => new Map(doc.items.map((item) => [item.id, item]));
  const before = index(base),
    ours = index(local),
    theirs = index(remote);
  const orderChanged = !equal(
    base.items.map((item) => item.id),
    local.items.map((item) => item.id),
  );
  const ids = new Set([
    ...(orderChanged ? ours : theirs).keys(),
    ...ours.keys(),
    ...theirs.keys(),
  ]);
  const items = [];
  for (const id of ids) {
    const old = before.get(id),
      a = ours.get(id),
      b = theirs.get(id);
    if (!a || !b) {
      const surviving = a || b;
      if (surviving && !equal(surviving, old)) {
        items.push(surviving);
      }
      continue;
    }
    let conflict = false;
    const merged = {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const changedHere = !equal(a[key], old?.[key]);
      const changedThere = !equal(b[key], old?.[key]);
      merged[key] = changedHere ? a[key] : b[key];
      conflict ||= changedHere && changedThere && !equal(a[key], b[key]);
    }
    items.push(merged);
    if (conflict) {
      items.push({
        ...b,
        id: makeId(),
        isTitle: false,
        x: b.x + 24,
        y: b.y + 24,
      });
    }
  }
  return normalizeDocument({
    ...remote,
    ...local,
    items,
    title: local.title === base.title ? remote.title : local.title,
    archived:
      local.archived === base.archived ? remote.archived : local.archived,
  });
}

export function createDocument(
  id,
  titleId,
  viewportWidth = 1482,
  now = Date.now(),
) {
  return normalizeDocument({
    version: 1,
    id,
    title: "Untitled Easel",
    viewportWidth,
    createdAt: now,
    updatedAt: now,
    items: [
      {
        id: titleId,
        type: "text",
        text: "Untitled Easel",
        isTitle: true,
        x: (viewportWidth - 900) / 2,
        y: 50,
        width: 900,
        height: 54,
        fontSize: 36,
        bold: true,
        align: "center",
        color: "#ffffff",
      },
    ],
  });
}

export function selectionBounds(items) {
  if (!items.length) {
    return null;
  }
  const x = Math.min(...items.map((item) => item.x));
  const y = Math.min(...items.map((item) => item.y));
  return {
    x,
    y,
    width: Math.max(...items.map((item) => item.x + item.width)) - x,
    height: Math.max(...items.map((item) => item.y + item.height)) - y,
  };
}

export function resizeSelection(items, from, to) {
  const scaleX = extent(to.width) / Math.max(1, from.width);
  const scaleY = extent(to.height) / Math.max(1, from.height);
  return items.map((item) =>
    normalizeItem({
      ...item,
      x: to.x + (item.x - from.x) * scaleX,
      y: to.y + (item.y - from.y) * scaleY,
      width: item.width * scaleX,
      height: item.height * scaleY,
    }),
  );
}

export function strokeItem(id, points, color, strokeWidth = 3) {
  const usable = points.filter(
    (p) => p.length === 2 && p.every(Number.isFinite),
  );
  if (!usable.length) {
    throw new TypeError("A stroke needs at least one point");
  }
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const point of usable) {
    x = Math.min(x, point[0]);
    y = Math.min(y, point[1]);
    right = Math.max(right, point[0]);
    bottom = Math.max(bottom, point[1]);
  }
  const width = Math.max(1, right - x),
    height = Math.max(1, bottom - y);
  return normalizeItem({
    id,
    type: "freehand",
    x,
    y,
    width,
    height,
    color,
    strokeWidth,
    points: usable.map((p) => [(p[0] - x) / width, (p[1] - y) / height]),
  });
}

export class EaselEditor {
  #document;
  #before = null;
  #undo = [];
  #redo = [];
  #changed;
  constructor(document, onChange = () => {}) {
    this.#document = normalizeDocument(document);
    this.#changed = onChange;
  }
  get document() {
    return copy(this.#document);
  }
  get canUndo() {
    return this.#undo.length > 0;
  }
  get canRedo() {
    return this.#redo.length > 0;
  }
  get inTransaction() {
    return this.#before !== null;
  }

  integrateRemote(document, makeId = () => crypto.randomUUID()) {
    const current = this.#document;
    const remote = normalizeDocument(document);
    this.#undo = this.#undo.map((snapshot) =>
      mergeDocuments(current, snapshot, remote, makeId),
    );
    this.#redo = this.#redo.map((snapshot) =>
      mergeDocuments(current, snapshot, remote, makeId),
    );
    if (this.#before) {
      this.#before = mergeDocuments(current, this.#before, remote, makeId);
    }
    this.#document = remote;
  }

  begin() {
    this.#before ??= copy(this.#document);
  }
  commit() {
    if (!this.#before) {
      return false;
    }
    const before = this.#before;
    this.#before = null;
    if (JSON.stringify(before) === JSON.stringify(this.#document)) {
      return false;
    }
    this.#undo.push(before);
    if (this.#undo.length > 100) {
      this.#undo.shift();
    }
    this.#redo = [];
    this.#document.updatedAt = Date.now();
    this.#changed(this.document);
    return true;
  }
  cancel() {
    if (this.#before) {
      this.#document = this.#before;
      this.#before = null;
    }
  }
  edit(change) {
    const ownTransaction = !this.inTransaction;
    if (ownTransaction) {
      this.begin();
    }
    // Validate before assigning so a malformed drop/import cannot corrupt the
    // document or leave an incomplete history entry behind.
    try {
      const next = this.document;
      change(next);
      this.#document = normalizeDocument(next);
      if (ownTransaction) {
        this.commit();
      }
    } catch (error) {
      if (ownTransaction) {
        this.cancel();
      }
      throw error;
    }
  }
  add(item) {
    this.edit((doc) => doc.items.push(normalizeItem(item)));
  }
  update(id, changes) {
    this.edit((doc) => {
      const item = doc.items.find((entry) => entry.id === id);
      if (!item) {
        return;
      }
      Object.assign(item, changes, { id });
      if (item.isTitle && "text" in changes) {
        doc.title = String(item.text).split("\n")[0].trim() || "Untitled Easel";
      }
    });
  }
  remove(ids) {
    this.edit((doc) => {
      doc.items = doc.items.filter((item) => !ids.includes(item.id));
    });
  }
  move(ids, dx, dy) {
    this.edit((doc) => {
      for (const item of doc.items) {
        if (ids.includes(item.id)) {
          item.x += dx;
          item.y += dy;
        }
      }
    });
  }
  resize(ids, bounds) {
    this.edit((doc) => {
      const selected = doc.items.filter((item) => ids.includes(item.id));
      const from = selectionBounds(selected);
      if (!from) {
        return;
      }
      const replaced = new Map(
        resizeSelection(selected, from, bounds).map((item) => [item.id, item]),
      );
      doc.items = doc.items.map((item) => replaced.get(item.id) || item);
    });
  }
  duplicate(ids, makeId = () => crypto.randomUUID()) {
    const added = [];
    this.edit((doc) => {
      const items = doc.items
        .filter((item) => ids.includes(item.id))
        .map((item) => {
          const duplicate = {
            ...copy(item),
            id: makeId(),
            x: item.x + 24,
            y: item.y + 24,
          };
          if (duplicate.isTitle) {
            duplicate.isTitle = false;
          }
          added.push(duplicate.id);
          return duplicate;
        });
      doc.items.push(...items);
    });
    return added;
  }
  reorder(ids, front) {
    this.edit((doc) => {
      const selected = doc.items.filter((item) => ids.includes(item.id));
      const others = doc.items.filter((item) => !ids.includes(item.id));
      doc.items = front ? [...others, ...selected] : [...selected, ...others];
    });
  }
  undo() {
    this.cancel();
    if (!this.canUndo) {
      return false;
    }
    this.#redo.push(this.#document);
    this.#document = this.#undo.pop();
    this.#document.updatedAt = Date.now();
    this.#changed(this.document);
    return true;
  }
  redo() {
    this.cancel();
    if (!this.canRedo) {
      return false;
    }
    this.#undo.push(this.#document);
    this.#document = this.#redo.pop();
    this.#document.updatedAt = Date.now();
    this.#changed(this.document);
    return true;
  }
}
