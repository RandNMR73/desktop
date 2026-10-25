import assert from "node:assert/strict";
import test from "node:test";
import { expandSplitLayout } from "../../src/zen/split-view/ZenSplitExpansion.mjs";

const layout = (count, direction = "row") => ({ direction,
  children: Array.from({ length: count }, (_, i) => ({ tab: `page-${i}`, sizeInParent: 100 / count })) });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test("two, three and four panes retain a 220px visible minimum in either orientation", () => {
  for (const direction of ["row", "column"]) for (const count of [2, 3, 4]) {
    const root = layout(count, direction), span = direction === "row" ? 1500 : 1000;
    const gap = direction === "row" ? 8 : 9;
    assert.equal(expandSplitLayout(root, "page-1", 1500, 1000, 8, 9), true);
    for (const child of root.children) {
      const visible = child.sizeInParent / 100 * span - gap;
      near(visible, child.tab === "page-1" ? span - (count - 1) * (220 + gap) - gap : 220);
    }
    near(root.children.reduce((sum, child) => sum + child.sizeInParent, 0), 100);
    assert.deepEqual(root.children.map(child => child.tab), Array.from({ length: count }, (_, i) => `page-${i}`));
  }
});

test("repeated expansion does no layout work and switching target keeps the pages", () => {
  const root = layout(3);
  expandSplitLayout(root, "page-1", 1500, 1000, 8, 9);
  assert.equal(expandSplitLayout(root, "page-1", 1500, 1000, 8, 9), false);
  assert.equal(expandSplitLayout(root, "page-0", 1500, 1000, 8, 9), true);
  near(root.children[1].sizeInParent / 100 * 1500 - 8, 220);
});

test("window resizing preserves pixel minima, not the old percentages", () => {
  const root = layout(3);
  expandSplitLayout(root, "page-1", 1500, 1000, 8, 9);
  expandSplitLayout(root, "page-1", 1000, 1000, 8, 9);
  near(root.children[0].sizeInParent / 100 * 1000 - 8, 220);
  near(root.children[1].sizeInParent / 100 * 1000 - 8, 536);
});

test("a window too small for every minimum keeps every pane visible", () => {
  const root = layout(4);
  expandSplitLayout(root, "page-1", 600, 700, 8, 9);
  assert.deepEqual(root.children.map(child => child.sizeInParent), [25, 25, 25, 25]);
});

test("missing pages and unmeasurable containers cannot corrupt the tree", () => {
  const root = layout(2), before = JSON.stringify(root);
  for (const [tab, width, height] of [["missing", 1000, 700], ["page-0", 0, 700], ["page-0", 1000, NaN]]) {
    assert.equal(expandSplitLayout(root, tab, width, height, 8, 9), false);
    assert.equal(JSON.stringify(root), before);
  }
});

test("nested Zen layouts retain topology and expand only the target ancestry", () => {
  const root = layout(2); root.children[0] = { ...layout(2, "column"), sizeInParent: 50 };
  root.children[1].tab = "outside";
  const nested = root.children[0], sibling = root.children[1];
  expandSplitLayout(root, "page-1", 1500, 1000, 8, 9);
  assert.equal(root.children[0], nested); assert.equal(root.children[1], sibling);
  near(sibling.sizeInParent / 100 * 1500 - 8, 220);
  near(nested.children[0].sizeInParent / 100 * 1000 - 9, 220);
});
