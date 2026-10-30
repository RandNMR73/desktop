/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import test from "node:test";
import assert from "node:assert/strict";
import { siteSearchEngine } from "../../src/zen/urlbar/ZenUrlbarSiteSearch.mjs";

const github = { name: "GitHub", aliases: ["github.com"] };
const gitlab = { name: "GitLab", aliases: ["gitlab.com"] };
const engines = [github, gitlab, { name: "Docs", aliases: ["docs.example", "docs", "@docs"] }];

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
