/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { siteSearchHistoryMatcher, siteSearchHistoryPrefilter } from "./ZenUrlbarSiteSearch.mjs";
import { tidySiteSearchTitle } from "./ZenSiteSearchTitles.mjs";
import { collectSiteSearchTerms, scoreSiteSearchTerms } from "./ZenSiteSearchTerms.sys.mjs";
import { prepareSiteSearchNavigation, rankSiteSearchNavigation, siteSearchNavigationPrefilter } from "./ZenSiteSearchNavigation.sys.mjs";

export const SITE_SEARCH_HISTORY_DAYS = 14;
// Explicit engine scopes request five history pages before converting them to
// display labels. Duplicate/empty labels consume this budget, not extra old pages.
export const SITE_SEARCH_RECENT_CANDIDATES = 5;
const MARKER = "zen_scope_history_probe";
const RECENT_PAGE_WINDOW = 256;

/** Try the indexed recent end of history before aggregating all matching pages.
 * Read page bounds and eligible visits in one SQLite snapshot. A future, frame,
 * or redirect-source visit can raise last_visit_date above the visible visit;
 * that date is only an upper bound, never the displayed date or final rank.
 * Null means this window cannot prove the exhaustive query's first five pages.
 */
async function boundedRecentPages(db, { begin, end, filter, matches, current }) {
  const pages = [];
  await db.executeCached(`
    WITH recent AS MATERIALIZED (
      SELECT id, url, title, last_visit_date FROM moz_places
      WHERE hidden = 0 AND last_visit_date >= :begin
      ORDER BY last_visit_date DESC, id DESC LIMIT :window
    )
    SELECT p.*, CASE WHEN (${filter.condition}) THEN (
      SELECT v.visit_date FROM moz_historyvisits v
      WHERE v.place_id = p.id AND v.visit_date >= :begin AND v.visit_date <= :end
        AND v.visit_type IN (1, 2, 3, 5, 6, 9)
        AND NOT EXISTS (SELECT 1 FROM moz_historyvisits next
          WHERE next.from_visit = v.id AND next.visit_type IN (5, 6))
      ORDER BY v.visit_date DESC LIMIT 1
    ) END AS date
    FROM recent p ORDER BY p.last_visit_date DESC, p.id DESC`,
  { begin, end, window: RECENT_PAGE_WINDOW, ...filter.params }, (row, cancel) => {
    if (!current()) { cancel(); return; }
    pages.push(row);
  });
  if (!current()) return [];
  const eligible = pages.filter(row => row.getResultByName("date") !== null &&
    matches(row.getResultByName("url"), row.getResultByName("title")));
  eligible.sort((a, b) => b.getResultByName("date") - a.getResultByName("date") ||
    b.getResultByName("id") - a.getResultByName("id"));
  const boundary = eligible[SITE_SEARCH_RECENT_CANDIDATES - 1];
  const oldest = pages.at(-1);
  // Unread pages cannot have a visible visit above their last_visit_date.
  // Include the place-id tie break: SQLite can store many visits at one time.
  const complete = pages.length < RECENT_PAGE_WINDOW || (boundary && (
    boundary.getResultByName("date") > oldest.getResultByName("last_visit_date") ||
    (boundary.getResultByName("date") === oldest.getResultByName("last_visit_date") &&
      boundary.getResultByName("id") >= oldest.getResultByName("id"))));
  return complete ? eligible.slice(0, SITE_SEARCH_RECENT_CANDIDATES) : null;
}

/** The reference searches history using the template before its terms slot. */
export function siteSearchHistoryPrefix(engine) {
  const submission = engine?.getSubmission(MARKER, null, "searchbar");
  if (submission?.postData) return null;
  const spec = submission?.uri?.spec;
  if (!spec || !/^https?:\/\//.test(spec)) return null;
  const at = spec.indexOf(MARKER);
  return at > 0 ? spec.slice(0, at) : null;
}

/** Read visible document visits, not download/frame or redirect-source visits.
 * No second history file: clearing Places immediately clears these results.
 * Limit matching pages before cleaning and deduplicating their saved titles. */
export async function recentSiteSearches(db, engine, {
  now = Date.now(), limit = 10, current = () => true,
} = {}) {
  const prefix = siteSearchHistoryPrefix(engine);
  if (!prefix || limit <= 0 || !current()) return [];
  const begin = (now - SITE_SEARCH_HISTORY_DAYS * 86400000) * 1000;
  const end = now * 1000;
  const filter = siteSearchHistoryPrefilter(prefix);
  const results = [], seen = new Set(), matches = siteSearchHistoryMatcher(prefix);
  let candidates = 0;
  const accept = (row, cancel) => {
    if (!current()) { cancel(); return; }
    const url = row.getResultByName("url");
    const title = row.getResultByName("title");
    if (!matches(url, title)) return;
    if (++candidates >= SITE_SEARCH_RECENT_CANDIDATES) cancel();
    // The reference converts history page titles into recent-search labels.
    // A visit without a title consumes a candidate but produces no label;
    // decoding its URL would invent a visible recent search.
    if (!title?.trim()) return;
    // Empty scopes use the history text matcher, including title-only matches.
    // Requiring SearchService to decode a current engine submission drops
    // redirects, old URL templates, and other matching saved pages.
    const label = tidySiteSearchTitle(url, title) ?? title;
    // Search-result identities use the full lowercased display title. NFC also
    // preserves Swift String's canonical equivalence when comparing labels.
    const key = label.toLowerCase().normalize("NFC");
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ title: label, url, date: row.getResultByName("date") });
    if (results.length >= limit) cancel();
  };
  const bounded = await boundedRecentPages(db, { begin, end, filter, matches, current });
  if (!current()) return [];
  if (bounded !== null) {
    let stopped = false;
    for (const row of bounded) {
      accept(row, () => { stopped = true; });
      if (stopped) break;
    }
  } else {
    // Sparse/older scopes need the exhaustive query. Keep its page-first join
    // and conservative text filter; the full word matcher is authoritative.
    await db.executeCached(`
      SELECT p.url, p.title, MAX(v.visit_date) AS date
      FROM moz_places p CROSS JOIN moz_historyvisits v ON p.id = v.place_id
      WHERE p.hidden = 0 AND p.last_visit_date >= :begin AND (${filter.condition})
        AND v.visit_date >= :begin AND v.visit_date <= :end
        AND v.visit_type IN (1, 2, 3, 5, 6, 9)
        AND NOT EXISTS (SELECT 1 FROM moz_historyvisits next
          WHERE next.from_visit = v.id AND next.visit_type IN (5, 6))
      GROUP BY p.id ORDER BY date DESC, p.id DESC`,
    { begin, end, ...filter.params }, accept);
  }
  return current() ? results : [];
}

/** Typed scope history is a prefix lookup across retained history, unlike the
 * empty scope's recent list. Use the indexed reversed host to avoid scanning
 * every visit on every keypress. Parse each URL through SearchService before
 * admitting it: another engine on the same host is not part of this scope.
 * Read Places for every query so deletion never leaves a second history cache. */
export async function typedSiteSearches(db, engine, parseSubmission, query, {
  now = Date.now(), limit = 50, current = () => true, locale,
  preventInline = false, inputIsURL = false, isNavigation,
} = {}) {
  const prefix = siteSearchHistoryPrefix(engine);
  if (!prefix || !query.trim() || limit <= 0 || !current()) return [];
  let host;
  try { host = new URL(prefix).hostname; } catch { return []; }
  const revHost = host.split("").reverse().join("") + ".";
  const rows = [];
  await db.executeCached(`
    SELECT p.url, p.last_visit_date AS date, p.visit_count AS visitCount
    FROM moz_places p
    WHERE p.rev_host = :revHost AND p.hidden = 0
      AND p.last_visit_date > 0 AND p.last_visit_date <= :end
      AND EXISTS (SELECT 1 FROM moz_historyvisits v
        WHERE v.place_id = p.id AND v.visit_type IN (1, 2, 3, 5, 6, 9)
          AND NOT EXISTS (SELECT 1 FROM moz_historyvisits next
            WHERE next.from_visit = v.id AND next.visit_type IN (5, 6)))`,
  { revHost, end: now * 1000 }, (row, cancel) => {
    if (!current()) { cancel(); return; }
    const url = row.getResultByName("url");
    const parsed = parseSubmission(url);
    if (parsed?.engine?.id !== engine.id || !parsed.terms?.trim()) return;
    rows.push({ query: parsed.terms, url,
      date: row.getResultByName("date") / 1000,
      visitCount: row.getResultByName("visitCount") });
  });
  if (!current()) return [];
  return scoreSiteSearchTerms(collectSiteSearchTerms(rows, query, { limit, locale }), query,
    { now, locale, preventInline, inputIsURL, isNavigation });
}

/** Match the combined browser history before the scope discards navigation
 * rows. The keyword is part of the input, so title/redirect matches on other
 * hosts can affect specificity even when they never appear as search rows.
 */
export async function siteSearchNavigationHistory(db, keyword, query, {
  now = Date.now(), locale, current = () => true, exclude = () => false,
  displayHost = host => host,
} = {}) {
  if (!keyword || !query.trim() || !current()) return [];
  const input = `${keyword} ${query}`;
  const filter = siteSearchNavigationPrefilter(input, { locale, cursorPosition: query.length });
  const rows = [];
  await db.executeCached(`
    SELECT p.id, p.url, p.title, p.visit_count AS visitCount,
      p.last_visit_date / 1000.0 AS lastVisit,
      (SELECT COUNT(*) FROM moz_historyvisits v
        WHERE v.place_id = p.id AND v.visit_type = 2) AS typedCount,
      EXISTS (SELECT 1 FROM moz_bookmarks b WHERE b.fk = p.id AND b.type = 1) AS bookmarked
    FROM moz_places p WHERE p.hidden = 0 AND p.last_visit_date > 0
      AND p.last_visit_date <= :end
      AND (${filter.condition})
      AND EXISTS (SELECT 1 FROM moz_historyvisits v WHERE v.place_id = p.id
        AND v.visit_type IN (1, 2, 3, 5, 6, 9))`,
  { ...filter.params, end: now * 1000 }, (value, cancel) => {
    if (!current()) { cancel(); return; }
    const row = Object.fromEntries(["id", "url", "title", "visitCount", "lastVisit", "typedCount", "bookmarked"]
      .map(key => [key, value.getResultByName(key)]));
    if (!exclude(row.url)) rows.push(row);
  });
  if (!current()) return [];
  const prepared = prepareSiteSearchNavigation(rows, input, {
    locale, cursorPosition: query.length, displayHost,
  });
  const selected = new Map(prepared.map(item => [item.row.id, item.row]));
  if (!selected.size) return [];
  for (const row of selected.values()) row.visits = [];
  await db.executeCached(`
    SELECT place_id, visit_date / 1000.0 AS date, visit_type FROM (
      SELECT place_id, visit_date, visit_type,
        ROW_NUMBER() OVER (PARTITION BY place_id ORDER BY visit_date DESC, id DESC) AS position
      FROM moz_historyvisits WHERE place_id IN (SELECT value FROM json_each(:ids))
        AND visit_date <= :end AND visit_type IN (1, 2, 3, 5, 6, 9)
    ) WHERE position <= 10 ORDER BY place_id, visit_date DESC`,
  { ids: JSON.stringify([...selected.keys()]), end: now * 1000 }, (value, cancel) => {
    if (!current()) { cancel(); return; }
    selected.get(value.getResultByName("place_id"))?.visits.push({
      date: value.getResultByName("date"), typed: value.getResultByName("visit_type") === 2,
    });
  });
  return current() ? rankSiteSearchNavigation(prepared, { now }) : [];
}
