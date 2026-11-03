/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import test from "node:test";
import assert from "node:assert/strict";
import { SiteSearchColors, SiteSearchLabel, siteSearchEngine, siteSearchHistoryIcon, siteSearchHistoryMatcher, siteSearchAlternatives, siteSearchPresentation } from "../../src/zen/urlbar/ZenUrlbarSiteSearch.mjs";

const github = { name: "GitHub", aliases: ["github.com"] };
const gitlab = { name: "GitLab", aliases: ["gitlab.com"] };
const engines = [github, gitlab, { name: "Docs", aliases: ["docs.example", "docs", "@docs"] }];

function colorFixture(selection = async color => `selection:${color}`) {
  const properties = new Map();
  const window = { closed: false, CSS: { supports: (_, color) => color !== "invalid" },
    getComputedStyle: () => ({ getPropertyValue: () => properties.get("--zen-site-search-color") }) };
  const bar = { style: { removeProperty: name => properties.delete(name),
    setProperty: (name, value) => properties.set(name, value) } };
  return { window, properties, colors: new SiteSearchColors(window, bar, selection) };
}
const colorTick = async () => { await Promise.resolve(); await Promise.resolve(); };

test("history scope colors respect word boundaries, title matches, and short-word limits", () => {
  for (const [host, url, title, expected] of [
    ["google.com", "https://google.com/search", "", true],
    ["google.com", "https://notgoogle.com/search", "", false],
    ["google.com", "https://www.google.com/search", "", false],
    ["google.com", "https://google.com.au/search", "", true],
    ["google.com", "https://elsewhere.test/", "Open GOOGLE.COM", true],
    ["google.com", "https://elsewhere.test/", "Open notgoogle.com", false],
    ["search-example.test", "https://example.test/", "Search help", true],
    ["ab", "https://abc.test/", "", false],
    ["abc", "https://abcdef.test/", "", true],
    ["ab", "https://example.test/ab", "", true],
    ["scope.test", "https://example.test/", "École SCOPE.TEST", true],
    ["scope.test", "https://example.test/", "sCOPE.TESTING", true],
    ["foo_bar.test", "https://example.test/", "foo bar.test", false],
    ["foo_bar.test", "https://foo_bar.test/", "", true],
    ["::1", "http://[::1]/", "", true],
    ["::1", "http://[::12]/", "", false],
    ["bücher.test", "https://xn--bcher-kva.test/", "", true],
  ]) {
    assert.equal(siteSearchHistoryMatcher(host, value => value.replace("xn--bcher-kva", "bücher"))(url, title),
      expected, JSON.stringify({ host, url, title }));
  }
});

test("scope fallback uses the submission host and the matching history page's favicon", async () => {
  const engine = { aliases: ["example.test"], getSubmission: () => ({ uri: {
    spec: "https://www.search.example.test/find?q=",
  } }), getIconURL() { assert.fail("bundled engine icon is not a scope color source"); } };
  const page = "https://www.search.example.test/previous-result";
  const icon = await siteSearchHistoryIcon(engine, {
    findPage: async host => { assert.equal(host, "www.search.example.test"); return page; },
    pageIcon: async uri => { assert.equal(uri, page); return "data:image/png;base64,cached"; },
  });
  assert.equal(icon, "data:image/png;base64,cached");
});

test("missing history retains the scope color and is looked up again after a later visit", async () => {
  const f = colorFixture();
  const engine = { getSubmission: () => ({ uri: { spec: "https://new.example.test/?q=" } }),
    getIconURL() { assert.fail("missing history must not use the bundled icon"); } };
  let page = null;
  const lookup = { findPage: async () => page, pageIcon: async () => "new color" };
  await f.colors.update(async () => "old color");
  await f.colors.update(() => siteSearchHistoryIcon(engine, lookup));
  assert.equal(f.properties.get("--zen-site-search-color"), "old color");
  page = "https://new.example.test/visited";
  await f.colors.update(() => siteSearchHistoryIcon(engine, lookup));
  assert.equal(f.properties.get("--zen-site-search-color"), "new color");
});

test("history without an icon and non-web submissions produce no replacement color", async () => {
  const engine = spec => ({ getSubmission: () => ({ uri: { spec } }) });
  assert.equal(await siteSearchHistoryIcon(engine("https://example.test/"), {
    findPage: async () => "https://example.test/visited", pageIcon: async () => null,
  }), null);
  for (const entry of [engine("file:///tmp/search"), { getSubmission: () => null }]) {
    assert.equal(await siteSearchHistoryIcon(entry, {
      findPage() { assert.fail("non-web submission must not query history"); },
      pageIcon() { assert.fail("missing page must not request a favicon"); },
    }), null);
  }
});

test("scope icon lookups cannot repaint a newer scope, including A-B-A transitions", async () => {
  const f = colorFixture(), pending = [];
  const oldA = f.colors.update(() => new Promise(resolve => pending.push(resolve)));
  const b = f.colors.update(() => new Promise(resolve => pending.push(resolve)));
  const newA = f.colors.update(() => new Promise(resolve => pending.push(resolve)));
  pending[2]("current A"); await newA;
  pending[0]("obsolete A"); pending[1]("obsolete B"); await Promise.all([oldA, b]);
  assert.equal(f.properties.get("--zen-site-search-color"), "current A");
  assert.equal(f.properties.get("--zen-site-search-text-selection"), "selection:current A");
});

test("an extracted theme uses its own text selection without recoloring the focus blend", async () => {
  const f = colorFixture(() => assert.fail("focus is already a derived translucent color"));
  await f.colors.update(async () => ({ color: "derived focus", selection: "derived selection" }));
  assert.equal(f.properties.get("--zen-site-search-color"), "derived focus");
  assert.equal(f.properties.get("--zen-site-search-text-selection"), "derived selection");
  await f.colors.update(async () => null);
  assert.equal(f.properties.get("--zen-site-search-text-selection"), "derived selection");
  await f.colors.update(null);
  assert.equal(f.properties.size, 0);
});

test("a delayed extracted theme cannot overwrite a newer preset", async () => {
  const f = colorFixture();
  let finish;
  const pending = f.colors.update(() => new Promise(resolve => finish = resolve));
  await f.colors.update(async () => "preset");
  finish({ color: "old focus", selection: "old selection" }); await pending;
  assert.equal(f.properties.get("--zen-site-search-color"), "preset");
  assert.equal(f.properties.get("--zen-site-search-text-selection"), "selection:preset");
});

test("switching scope keeps its loaded color and ignores late palette work", async () => {
  const pending = [], f = colorFixture(color => new Promise(resolve => pending.push({ color, resolve })));
  const a = f.colors.update(async () => "red"); await colorTick();
  assert.equal(f.properties.get("--zen-site-search-color"), "red");
  const b = f.colors.update(async () => "purple");
  assert.equal(f.properties.get("--zen-site-search-color"), "red");
  await colorTick();
  pending[1].resolve("purple selection"); await b;
  pending[0].resolve("red selection"); await a;
  assert.equal(f.properties.get("--zen-site-search-text-selection"), "purple selection");
});

test("pending and unavailable provider colors retain the last loaded pair until scope exit", async () => {
  const f = colorFixture();
  await f.colors.update(async () => "red");
  let finish;
  const pending = f.colors.update(() => new Promise(resolve => finish = resolve));
  const retained = [...f.properties];
  assert.deepEqual(retained, [["--zen-site-search-color", "red"],
    ["--zen-site-search-text-selection", "selection:red"]]);
  finish(null); await pending;
  for (const resolve of [async () => null, async () => "invalid", async () => { throw Error("icon unavailable"); }]) {
    await f.colors.update(resolve);
    assert.deepEqual([...f.properties], retained);
  }
  await f.colors.update(null);
  assert.equal(f.properties.size, 0);
  await f.colors.update(async () => null);
  assert.equal(f.properties.size, 0);
});

test("a newly loaded provider color never inherits the previous text selection palette", async () => {
  for (const selection of [async () => null, async () => { throw Error("native unavailable"); }]) {
    const f = colorFixture(color => color === "red" ? "red selection" : selection());
    await f.colors.update(async () => "red");
    assert.equal(f.properties.get("--zen-site-search-text-selection"), "red selection");
    await f.colors.update(async () => "purple");
    assert.equal(f.properties.get("--zen-site-search-color"), "purple");
    assert.equal(f.properties.has("--zen-site-search-text-selection"), false);
  }
});

test("leaving a scope cancels both pending icon and pending palette completion", async () => {
  let finishIcon, finishPalette;
  const f = colorFixture(() => new Promise(resolve => finishPalette = resolve));
  const icon = f.colors.update(() => new Promise(resolve => finishIcon = resolve));
  await f.colors.update(null); finishIcon("red"); await icon;
  assert.equal(f.properties.size, 0);
  const palette = f.colors.update(async () => "purple"); await colorTick();
  await f.colors.update(null); finishPalette("purple selection"); await palette;
  assert.equal(f.properties.size, 0);
});

test("failed or invalid scope providers preserve the window's selection fallback", async () => {
  for (const resolve of [async () => null, async () => "invalid", async () => { throw Error("icon unavailable"); }]) {
    const f = colorFixture(); await f.colors.update(resolve); assert.equal(f.properties.size, 0);
  }
  for (const selection of [async () => null, async () => { throw Error("native unavailable"); }]) {
    const f = colorFixture(selection); await f.colors.update(async () => "red");
    assert.equal(f.properties.get("--zen-site-search-color"), "red");
    assert.equal(f.properties.has("--zen-site-search-text-selection"), false);
  }
});

test("a closed window cannot receive a delayed scope palette", async () => {
  let finish;
  const f = colorFixture(() => new Promise(resolve => finish = resolve));
  const work = f.colors.update(async () => "red"); await colorTick();
  f.window.closed = true; finish("selection"); await work;
  assert.equal(f.properties.has("--zen-site-search-text-selection"), false);
});

function labelFixture(measure) {
  const events = {}, properties = new Map();
  const window = { devicePixelRatio: 2, closed: false,
    addEventListener: (name, fn) => events[name] = fn };
  const title = { textContent: "", style: {
    removeProperty: name => properties.delete(name),
    setProperty: (name, value) => properties.set(name, String(value)),
  } };
  return { window, title, events, properties, label: new SiteSearchLabel(window, title, measure) };
}

test("scope metrics cannot overwrite a newer scope or a cleared search mode", async () => {
  const pending = [], f = labelFixture(() => new Promise(resolve => pending.push(resolve)));
  const old = f.label.update("Google Drive"), current = f.label.update("X");
  pending[1]({ width: 9, weight: 510 }); await current;
  pending[0]({ width: 80, weight: 510 }); await old;
  assert.equal(f.title.textContent, "X");
  assert.equal(f.properties.get("--zen-site-search-title-width"), "9px");
  const clearing = f.label.update("YouTube");
  await f.label.update(null);
  pending[2]({ width: 53, weight: 510 }); await clearing;
  assert.equal(f.properties.size, 0);
});

test("ordinary typing and resizing do not remeasure a scope; display scale changes do", async () => {
  const calls = [], f = labelFixture(async (text, scale) => {
    calls.push([text, scale]); return { width: scale === 2 ? 43.5 : 44, weight: 510 };
  });
  await f.label.update("GitHub");
  f.title.textContent = "Unique engine identity";
  await f.label.update("GitHub"); f.events.resize();
  assert.equal(f.title.textContent, "GitHub");
  assert.equal(calls.length, 1);
  f.window.devicePixelRatio = 1; f.events.resize(); await Promise.resolve();
  assert.deepEqual(calls, [["GitHub", 2], ["GitHub", 1]]);
  assert.equal(f.properties.get("--zen-site-search-title-width"), "44px");
  await f.label.update(null); f.window.devicePixelRatio = 2; f.events.resize();
  assert.equal(calls.length, 2);
});

test("failed, absent and late closed-window measurements retain intrinsic CSS sizing", async () => {
  for (const measure of [async () => null, async () => { throw new Error("unavailable"); }]) {
    const f = labelFixture(measure); await f.label.update("Custom label");
    assert.equal(f.title.textContent, "Custom label"); assert.equal(f.properties.size, 0);
  }
  const f = labelFixture(async () => { f.window.closed = true; return { width: 53, weight: 510 }; });
  await f.label.update("YouTube"); assert.equal(f.properties.size, 0);
});

test("menu groups shortcuts before general engines without merging duplicate display names", () => {
  const x = { name: "X", aliases: ["x.com"] };
  const twitter = { name: "X (twitter.com)", aliases: ["twitter.com"] };
  const google = { name: "Google", aliases: [], isGeneralPurposeEngine: true };
  const entries = [{ key: "twitter.com", label: "X" }, { key: "x.com", label: "X" }];
  const result = siteSearchAlternatives([google, github, x, gitlab, twitter], "GitLab", entries);
  assert.deepEqual(result.map(item => item.engine), [twitter, x, github, google]);
  assert.deepEqual(result.map(item => item.label), ["X", "X", "GitHub", "Google"]);
  assert.deepEqual(result.map(item => item.general), [false, false, false, true]);
});
test("removed engines stay out; unconfigured engines keep their own names and stable order", () => {
  const hidden = { ...github, hidden: true };
  assert.deepEqual(siteSearchAlternatives([gitlab, hidden, engines[2]], "absent").map(x => x.engine), [gitlab, engines[2]]);
  assert.equal(siteSearchPresentation(gitlab).label, "GitLab");
  assert.equal(siteSearchPresentation(gitlab, [{ key: "GitLab", general: true }]).general, true);
});

test("bare aliases match without a saved completion, including custom aliases", () => {
  assert.equal(siteSearchEngine("GitHub.COM", engines), github);
  assert.equal(siteSearchEngine("docs", engines), engines[2]);
  assert.equal(siteSearchEngine("@docs", engines), engines[2]);
  assert.equal(siteSearchEngine("git", engines), null);
});
test("the actual completion resolves ambiguous domain prefixes", () => {
  assert.equal(siteSearchEngine("git", engines, "https://github.com/org/repo"), github);
  assert.equal(siteSearchEngine("git", engines, "https://www.gitlab.com/project"), gitlab);
  assert.equal(siteSearchEngine("git", engines, "https://unrelated.example/git"), null);
  assert.equal(siteSearchEngine("project", engines, "https://gitlab.com/project"), null);
});
test("hidden engines are never offered for exact aliases or completed domains", () => {
  const hidden = [{ ...github, hidden: true }, gitlab];
  assert.equal(siteSearchEngine("github.com", hidden), null);
  assert.equal(siteSearchEngine("git", hidden, "https://github.com/org"), null);
  assert.equal(siteSearchEngine("git", hidden, "https://gitlab.com/org"), gitlab);
});
test("explicit URL syntax and ordinary queries never become site-search prompts", () => {
  for (const query of ["", "https://github.com", "github.com/", "github.com/repo", "www.github.com", "github.com ", " github.com", "git hub", "github.com?x", "github.com#x", "user@github.com"]) {
    assert.equal(siteSearchEngine(query, engines, "https://github.com/repo"), null, query);
  }
});
test("invalid and credential-bearing completions cannot supply a domain alias", () => {
  for (const url of [null, "not a URL", "file://github.com/path", "https://user@github.com/"]) {
    assert.equal(siteSearchEngine("git", engines, url), null, String(url));
  }
  assert.equal(siteSearchEngine("git", [], "https://github.com/"), null);
});

test("catalog triggers work without saved history and never guess ambiguous prefixes", () => {
  const chat = { name: "ChatGPT", aliases: ["chatgpt.com"] };
  const entries = [{ key: "chatgpt.com", triggers: ["chatgpt"], kind: "message" },
    { key: "github.com", triggers: ["github"] }];
  assert.equal(siteSearchEngine("ChatGPT", [chat, ...engines], null, entries), chat);
  assert.equal(siteSearchEngine("github", engines, null, entries), github);
  for (const query of ["git", "chat", "chatgpt ", "chatgpt/foo", "https://chatgpt.com"])
    assert.equal(siteSearchEngine(query, [chat, ...engines], null, entries), null);
  assert.equal(siteSearchEngine("chatgpt", [{ ...chat, hidden: true }], null, entries), null);
  assert.equal(siteSearchEngine("chatgpt", [], null, entries), null);
  assert.equal(siteSearchEngine("github", engines, null, [{ key: "github.com", triggers: "github" }]), null);
  assert.equal(siteSearchPresentation(chat, entries).message, true);
  assert.equal(siteSearchPresentation(github, entries).message, false);
});
