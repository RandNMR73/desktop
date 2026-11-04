/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
import test from "node:test";
import assert from "node:assert/strict";
import { tidySiteSearchTitle, siteTitleCleaner } from "../../src/zen/urlbar/ZenSiteSearchTitles.mjs";
import { recentSiteSearches } from "../../src/zen/urlbar/ZenSiteSearchHistory.sys.mjs";

test("recent labels follow saved titles, including repeated site suffixes", () => {
  assert.equal(tidySiteSearchTitle("https://www.youtube.com/results?search_query=raw",
    "(2) Displayed - YouTube - YouTube"), "(2) Displayed");
  assert.equal(tidySiteSearchTitle("https://www.google.com/search?q=raw",
    "Corrected spelling - Google Search"), "Corrected spelling");
  assert.equal(tidySiteSearchTitle("https://www.amazon.com/s?k=raw",
    "Amazon.com: Displayed results"), "Displayed results");
  assert.equal(tidySiteSearchTitle("https://www.reddit.com/search/?q=raw",
    "(42) Search results"), "Search results");
  assert.equal(tidySiteSearchTitle("https://twitter.com/search?q=raw",
    "(3) Topic / Twitter"), "Topic");
});

test("site rules use the first matching path or fragment, without broad subdomain matching", () => {
  assert.equal(tidySiteSearchTitle("https://www.linkedin.com/feed/", "Notifications"), "LinkedIn");
  assert.equal(tidySiteSearchTitle("https://mail.google.com/#inbox", "Inbox (2) - Mail"), "Gmail");
  assert.equal(tidySiteSearchTitle("https://mail.google.com/#label/Work", "Work - Account"), "Work");
  assert.equal(tidySiteSearchTitle("https://mail.google.com/#label%2FWork", "Work - Account"), null);
  assert.equal(tidySiteSearchTitle("https://google.com/mail", "Mail - Google Search"), null);
  assert.equal(tidySiteSearchTitle("https://music.youtube.com/results?q=raw", "Music - YouTube"), null);
  assert.equal(tidySiteSearchTitle("https://www.www.youtube.com/results?q=raw", "Music - YouTube"), null);
});

test("cleanup preserves spacing, uses Unicode whitespace, and falls back from a blank rewrite", () => {
  assert.equal(tidySiteSearchTitle("https://youtube.com/results?q=x", "  A - YouTube "), "  A ");
  assert.equal(tidySiteSearchTitle("https://youtube.com/results?q=x", " - YouTube"), null);
  assert.equal(tidySiteSearchTitle("https://youtube.com/results?q=x", "\u0085\u200b - YouTube"), null);
  assert.equal(tidySiteSearchTitle("https://twitter.com/search?q=x", "(1)\u0085Topic / Twitter"), "Topic");
  assert.equal(tidySiteSearchTitle("https://youtube.com/results?q=x", "\ufeff - YouTube"), "\ufeff");
  assert.equal(tidySiteSearchTitle("invalid", "Title"), null);
  assert.equal(tidySiteSearchTitle("https://youtube.com/", null), null);
});

test("ordered modifiers and first-match empty results do not fall through to later rules", () => {
  const clean = siteTitleCleaner({ "example.test": [
    { match: { pathEquals: "/A B" }, title: { removingPatterns: ["prefix ", " suffix"] } },
    { title: { always: "Fallback rule" } },
  ] });
  assert.equal(clean("https://example.test/A%20B/", "prefix middle suffix"), "middle");
  assert.equal(clean("https://example.test/A%20B/", "prefix  suffix"), null);
  assert.equal(clean("https://example.test/elsewhere", "Original"), "Fallback rule");
});

test("title cleanup cannot change the saved destination, and unknown sites retain their titles", async () => {
  const engine = { id: "fixture", getSubmission: q => ({ uri: {
    spec: "https://www.youtube.com/results?search_query=" + encodeURIComponent(q),
  } }) };
  const url = "https://www.youtube.com/results?search_query=original+terms&sp=filter#section";
  const row = { url, title: "Different displayed title - YouTube", date: 1 };
  const db = { executeCached: async (_sql, _params, callback) => callback({
    getResultByName: key => row[key],
  }, () => {}) };
  assert.deepEqual(await recentSiteSearches(db, engine), [{
    title: "Different displayed title", url, date: 1,
  }]);
  row.title = " - YouTube";
  assert.equal((await recentSiteSearches(db, engine))[0].title, " - YouTube");
});
