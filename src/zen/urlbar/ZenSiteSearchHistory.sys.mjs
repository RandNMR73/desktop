/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { siteSearchHistoryMatcher } from "./ZenUrlbarSiteSearch.mjs";
import { collectSiteSearchTerms, scoreSiteSearchTerms } from "./ZenSiteSearchTerms.sys.mjs";

export const SITE_SEARCH_HISTORY_DAYS = 14;
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
 * Matching and deduplication happen before limiting the displayed rows. */
export async function recentSiteSearches(db, engine, parseSubmission, {
  now = Date.now(), limit = 10, current = () => true,
} = {}) {
  const prefix = siteSearchHistoryPrefix(engine);
  if (!prefix || limit <= 0 || !current()) return [];
  const begin = (now - SITE_SEARCH_HISTORY_DAYS * 86400000) * 1000;
  const end = now * 1000;
  const results = [], seen = new Set(), matches = siteSearchHistoryMatcher(prefix);
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
    if (!matches(url, row.getResultByName("title"))) return;
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
