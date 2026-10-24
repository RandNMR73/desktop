import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../../src/zen/common/emojis/ZenEmojiPicker.mjs", import.meta.url),
  "utf8",
).replace(/^import .*;\n/m, "");
const dataContext = vm.createContext({});
vm.runInContext(
  readFileSync(
    new URL(
      "../../src/zen/common/emojis/ZenEmojisData.min.mjs",
      import.meta.url,
    ),
    "utf8",
  ),
  dataContext,
);
const data = dataContext.ZenEmojisData;

function fixture(emojis = data) {
  let writes = 0;
  const buttons = emojis.map((emoji) => {
    let hidden = false;
    let order = "";
    return {
      getAttribute: () => emoji.emoji,
      get hidden() {
        return hidden;
      },
      set hidden(value) {
        hidden = value;
        writes++;
      },
      style: {
        get order() {
          return order;
        },
        set order(value) {
          order = String(value);
          writes++;
        },
      },
    };
  });
  const window = {};
  vm.runInContext(
    source,
    vm.createContext({
      window,
      nsZenDOMOperatedFeature: class {},
      document: { getElementById: () => ({ children: buttons }) },
    }),
  );
  window.gZenEmojiPicker._emojis = emojis;
  return {
    buttons,
    search(value) {
      writes = 0;
      window.gZenEmojiPicker.handleEvent({ type: "input", target: { value } });
      return writes;
    },
    state: () =>
      buttons.map((b) => ({ hidden: b.hidden, order: b.style.order })),
  };
}

// Independent compatibility oracle: preserve the previous filter/sort/find
// semantics, including duplicate glyphs and hidden items' retained CSS order.
function oldSearch(emojis, state, query) {
  const value = query.trim().toLowerCase();
  const filtered = emojis
    .filter((e) => e.tags.some((t) => t.toLowerCase().includes(value)))
    .sort((a, b) => a.order - b.order);
  return emojis.map((e, i) => {
    const found = filtered.find((match) => match.emoji === e.emoji);
    return {
      hidden: !found,
      order: found ? String(found.order) : state[i].order,
    };
  });
}

test("emoji searches retain all bundled-data results and CSS ordering", () => {
  const f = fixture();
  let expected = f.state();
  const queries = [
    "",
    "   ",
    "a",
    "heart",
    "  FACE  ",
    "flag",
    "red",
    "cat",
    "smile",
    "not-a-real-tag",
    "😀",
    "é",
    "family",
    "hand",
    "black",
  ];
  // Spread sampled real tags across the complete data, not only face emojis.
  for (let i = 0; i < data.length; i += 53) queries.push(data[i].tags[0]);
  for (const query of queries) {
    expected = oldSearch(data, expected, query);
    f.search(query);
    assert.deepEqual(f.state(), expected, query);
  }
});

test("duplicate glyphs keep the earliest matching order", () => {
  const emojis = [
    { emoji: "a", tags: ["cat"], order: 8 },
    { emoji: "a", tags: ["dog"], order: 1 },
    { emoji: "a", tags: ["cat"], order: 3 },
    { emoji: "b", tags: ["bird"], order: 0 },
  ];
  const f = fixture(emojis);
  let expected = f.state();
  for (const query of ["cat", "dog", "", "none", "bird", "cat"]) {
    expected = oldSearch(emojis, expected, query);
    f.search(query);
    assert.deepEqual(f.state(), expected);
  }
});

test("repeating the same normalized query does not mutate buttons", () => {
  const f = fixture();
  f.search("face");
  assert.equal(f.search("  FACE  "), 0);
  f.search("not-a-real-tag");
  assert.equal(f.search("not-a-real-tag"), 0);
});

test("clearing a search restores the complete ordered list", () => {
  const f = fixture();
  f.search("not-a-real-tag");
  assert(f.buttons.every((b) => b.hidden));
  f.search("");
  assert(f.buttons.every((b) => !b.hidden));
  assert.deepEqual(f.state(), oldSearch(data, f.state(), ""));
});
