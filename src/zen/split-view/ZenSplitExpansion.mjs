/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Arc leaves the other panes at 220 CSS px, in either orientation. Include
// Zen's outside pane margins in each allocation so the visible pane is 220 px.
export function expandSplitLayout(root, tab, width, height, gapX, gapY) {
  const find = node => {
    if (!node.children) return node.tab === tab ? [node] : null;
    for (const child of node.children) {
      const path = find(child);
      if (path) return [node, ...path];
    }
    return null;
  };
  const path = find(root);
  if (!path || !Number.isFinite(width) || !Number.isFinite(height) ||
      width <= 0 || height <= 0) return false;
  let changed = false;
  for (let i = 0; i < path.length - 1; i++) {
    const parent = path[i], selected = path[i + 1];
    const horizontal = parent.direction === "row";
    const span = horizontal ? width : height;
    const gap = Math.max(0, horizontal ? gapX : gapY);
    // If the window cannot fit every minimum, retain all pages at equal sizes.
    const minimum = Math.min(100 / parent.children.length, (220 + gap) / span * 100);
    for (const child of parent.children) {
      const size = child === selected ? 100 - minimum * (parent.children.length - 1) : minimum;
      if (Math.abs(child.sizeInParent - size) > 1e-7) {
        child.sizeInParent = size;
        changed = true;
      }
    }
    if (horizontal) width *= selected.sizeInParent / 100;
    else height *= selected.sizeInParent / 100;
  }
  return changed;
}
