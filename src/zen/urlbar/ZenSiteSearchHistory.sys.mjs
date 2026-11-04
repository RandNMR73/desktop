/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { siteSearchHistoryMatcher } from "./ZenUrlbarSiteSearch.mjs";
import { collectSiteSearchTerms, scoreSiteSearchTerms } from "./ZenSiteSearchTerms.sys.mjs";
import { prepareSiteSearchNavigation, rankSiteSearchNavigation, siteSearchNavigationWords } from "./ZenSiteSearchNavigation.sys.mjs";

export const SITE_SEARCH_HISTORY_DAYS = 14;
// Explicit engine scopes request five history pages before converting them to
// search terms. Duplicate/empty terms consume this budget, not extra old pages.
export const SITE_SEARCH_RECENT_CANDIDATES = 5;
const MARKER = "zen_scope_history_probe";

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
 * Limit matching pages before parsing and deduplicating their search terms. */
export async function recentSiteSearches(db, engine, parseSubmission, {
  now = Date.now(), limit = 10, current = () => true,
} = {}) {
  const prefix = siteSearchHistoryPrefix(engine);
  if (!prefix || limit <= 0 || !current()) return [];
  const begin = (now - SITE_SEARCH_HISTORY_DAYS * 86400000) * 1000;
  const end = now * 1000;
  const results = [], seen = new Set(), matches = siteSearchHistoryMatcher(prefix);
  let candidates = 0;
  await db.executeCached(`
    SELECT p.url, p.title, MAX(v.visit_date) AS date
    FROM moz_historyvisits v JOIN moz_places p ON p.id = v.place_id
    WHERE v.visit_date >= :begin AND v.visit_date <= :end
      AND p.hidden = 0 AND v.visit_type IN (1, 2, 3, 5, 6, 9)
      AND NOT EXISTS (SELECT 1 FROM moz_historyvisits next
        WHERE next.from_visit = v.id AND next.visit_type IN (5, 6))
    GROUP BY p.id ORDER BY date DESC, p.id DESC`,
  { begin, end }, (row, cancel) => {
    if (!current()) { cancel(); return; }
    const url = row.getResultByName("url");
    const title = row.getResultByName("title");
    if (!matches(url, title)) return;
    if (++candidates >= SITE_SEARCH_RECENT_CANDIDATES) cancel();
    // The reference converts history page titles into recent-search labels.
    // A visit without a title consumes a candidate but produces no label;
    // decoding its URL would invent a visible recent search.
    if (!title?.trim()) return;
    const parsed = parseSubmission(url);
    if (parsed?.engine?.id !== engine.id || !parsed.terms?.trim()) return;
    const key = parsed.terms.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ query: parsed.terms, url, date: row.getResultByName("date") });
    if (results.length >= limit) cancel();
  });
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
  const words = siteSearchNavigationWords(locale)(keyword.toLocaleLowerCase(locale));
  // ASCII keyword fragments allow a cheap SQL prefilter. Non-ASCII keyword
  // matching stays in the locale-aware matcher, rather than SQLite's ASCII
  // lowercase operation. Escaped URL fragments must also remain eligible.
  const anchor = words.map(w => w.text).filter(w => /^[a-z0-9]+$/.test(w))
    .sort((a, b) => b.length - a.length)[0] ?? "";
  const rows = [];
  await db.executeCached(`
    SELECT p.id, p.url, p.title, p.visit_count AS visitCount,
      p.last_visit_date / 1000.0 AS lastVisit,
      (SELECT COUNT(*) FROM moz_historyvisits v
        WHERE v.place_id = p.id AND v.visit_type = 2) AS typedCount,
      EXISTS (SELECT 1 FROM moz_bookmarks b WHERE b.fk = p.id AND b.type = 1) AS bookmarked
    FROM moz_places p WHERE p.hidden = 0 AND p.last_visit_date > 0
      AND p.last_visit_date <= :end
      AND (p.url LIKE :needle OR p.title LIKE :needle OR instr(p.url, '%') > 0)
      AND EXISTS (SELECT 1 FROM moz_historyvisits v WHERE v.place_id = p.id
        AND v.visit_type IN (1, 2, 3, 5, 6, 9))`,
  { needle: `%${anchor}%`, end: now * 1000 }, (value, cancel) => {
    if (!current()) { cancel(); return; }
    const row = Object.fromEntries(["id", "url", "title", "visitCount", "lastVisit", "typedCount", "bookmarked"]
      .map(key => [key, value.getResultByName(key)]));
    if (!exclude(row.url)) rows.push(row);
  });
  if (!current()) return [];
  const prepared = prepareSiteSearchNavigation(rows, `${keyword} ${query}`, {
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
