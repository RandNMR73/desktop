/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import test from "node:test";
import assert from "node:assert/strict";
import { SiteSearchLabel, siteSearchEngine, siteSearchAlternatives, siteSearchPresentation } from "../../src/zen/urlbar/ZenUrlbarSiteSearch.mjs";

const github = { name: "GitHub", aliases: ["github.com"] };
const gitlab = { name: "GitLab", aliases: ["gitlab.com"] };
const engines = [github, gitlab, { name: "Docs", aliases: ["docs.example", "docs", "@docs"] }];

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
