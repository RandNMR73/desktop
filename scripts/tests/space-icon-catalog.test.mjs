import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Independent observation of Arc's Icon tab, in displayed order (2026-11-01).
const arcNames = `star bookmark heart flag flash triangle medical notifications
bulb shapes grid apps layers server albums copy folder fileTrayFull calendar mail
checkbox document book chatBubbleEllipses people terminal construction square egg
ellipse moon sunny planet leaf cloud paw bag gift bed restaurant barbell airplane
musicalNote colorPallete video bandage code baseball cloudOutline map bonfire pizza
skull receipt thumbsUp train`.split(/\s+/);
const root = new URL("../../", import.meta.url);
const source = readFileSync(new URL("src/zen/common/emojis/ZenEmojiPicker.mjs", root), "utf8")
  .replace(/^import .*;\n/m, "");

function fixture() {
  class Element {
    attributes = new Map();
    children = [];
    style = {};
    className = "";
    classList = {
      contains: name => this.className.split(" ").includes(name),
      add: name => { this.className += ` ${name}`; },
      remove: name => { this.className = this.className.replace(name, ""); },
    };
    addEventListener() {}
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name); }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    appendChild(child) { this.children.push(child); }
    replaceChildren(fragment) { this.children = fragment?.children ?? []; }
    focus() {}
    querySelector() { return new Element(); }
    scrollIntoView() {}
  }
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const window = {};
  vm.runInNewContext(source, {
    window, nsZenDOMOperatedFeature: class {},
    document: {
      getElementById: get,
      createXULElement: () => new Element(),
      createDocumentFragment: () => new Element(),
    },
  });
  const picker = window.gZenEmojiPicker;
  const panel = get("PanelUI-zen-emojis-picker");
  panel.openPopup = () => {
    picker.handleEvent({ type: "popupshowing", target: panel });
    picker.handleEvent({ type: "popupshown", target: panel });
  };
  panel.hidePopup = () => picker.handleEvent({ type: "popuphidden", target: panel });
  const anchor = new Element();
  anchor.parentElement = new Element();
  picker.init();
  picker._emojis = [{ emoji: "🌴" }];
  return { picker, panel, anchor, get };
}

test("every observed Arc Space icon is selectable and resolves to a packaged outline", async () => {
  const { picker, panel, anchor } = fixture();
  const selections = [];
  const promise = picker.open(anchor, { spaceIcons: true, closeOnSelect: false,
    onSelect: icon => selections.push(icon) });
  const buttons = picker.svgList.children;
  assert.deepEqual(buttons.map(b => b.getAttribute("icon")), arcNames.map(n => `arc-${n}.svg`));
  const jar = readFileSync(new URL("src/browser/themes/shared/zen-icons/jar.inc.mn", root), "utf8");
  for (const button of buttons) {
    const name = button.getAttribute("icon");
    const asset = readFileSync(new URL(`src/browser/themes/shared/zen-icons/common/selectable/${name}`, root), "utf8");
    assert.match(asset, /viewBox="0 0 512 512"/);
    assert.match(asset, /fill="context-fill" fill-opacity="context-fill-opacity"/);
    assert.match(asset, /<path[^>]+d="M/);
    assert(jar.includes(`skin/classic/browser/zen-icons/selectable/${name}`));
    picker.handleEvent({ type: "command", target: button });
    assert.equal(selections.at(-1), `chrome://browser/skin/zen-icons/selectable/${name}`);
  }
  panel.hidePopup();
  assert.equal(await promise, selections.at(-1));
});

test("Space creation, editing, and Library editing all request the Arc catalog", () => {
  for (const file of ["spaces/ZenSpaceCreation.mjs", "spaces/ZenSpaceManager.mjs",
    "library/sections/ZenLibrarySpacesSection.mjs"]) {
    const text = readFileSync(new URL(`src/zen/${file}`, root), "utf8");
    assert.match(text, /gZenEmojiPicker\.open\([^,]+,\s*\{\s*spaceIcons: true/);
  }
});

test("folder icon-only pickers retain their existing catalog and open the visible Icon page", async () => {
  const { picker, panel, anchor, get } = fixture();
  const promise = picker.open(anchor, { onlySvgIcons: true });
  assert(picker.svgList.children.some(b => b.getAttribute("icon") === "rocket.svg"));
  assert(!picker.svgList.children.some(b => b.getAttribute("icon").startsWith("arc-")));
  assert(get("PanelUI-zen-emojis-picker-change-svg").classList.contains("selected"));
  picker.handleEvent({ type: "command", target: picker.svgList.children[0] });
  assert.equal(await promise, "chrome://browser/skin/zen-icons/selectable/airplane.svg");
  assert.equal(panel.children.length, 0);
});
