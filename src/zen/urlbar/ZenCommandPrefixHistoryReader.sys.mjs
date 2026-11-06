/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { COMMAND_URL_PREFIXES, commandPrefixHistory,
  commandPrefixHistoryLookups } from "./ZenCommandPrefixHistory.sys.mjs";

const FIELDS = ["id", "url", "typedCount", "visitCount", "lastVisit"];
const RECORD = `p.id, p.url, p.visit_count AS visitCount,
  p.last_visit_date / 1000.0 AS lastVisit,
  (SELECT COUNT(*) FROM moz_historyvisits v WHERE v.place_id = p.id
    AND v.visit_type = 2 AND v.visit_date <= :end) AS typedCount`;
const VISIBLE = "p.hidden = 0 AND p.last_visit_date > 0 AND p.last_visit_date <= :end";

/** Narrow ordinary URL prefixes through Places' host/origin indexes. Other
 * prefixes scan origins, not every page and visit. Keep the final URL range
 * predicate authoritative (ports, credentials and paths are not host matches).
 */
function originFilter(prefix) {
  const match = /^([a-z][a-z0-9+.-]*:\/\/)([a-z0-9.-]+(?::[0-9]*)?)([/?#].*)?$/.exec(prefix);
  if (match) {
    const [, scheme, host, tail] = match;
    return { condition: `o.prefix = :scheme AND ${tail ? "o.host = :host" :
      "o.host >= :host AND o.host < :hostEnd"}`,
    params: { scheme, host, ...(tail ? {} : { hostEnd: host + "\uffff" }) } };
  }
  return { condition: `(substr(o.prefix || o.host, 1, length(:prefix)) = :prefix
    OR substr(:prefix, 1, length(o.prefix || o.host)) = o.prefix || o.host)`, params: {} };
}

/** Read the capped URL-prefix pools, plus exact/shorter records and the most
 * recent visit's redirect chain. No persistent cache or schema changes. The
 * caller supplies URL fixup and cancellation; private contexts must not call
 * this reader. Places records typed visits individually, unlike its boolean
 * moz_places.typed field. Hidden redirect targets still participate in culling.
 */
export async function readCommandPrefixHistory(db, text, {
  canonicalize, now = Date.now(), limit = 3, current = () => true,
  ...options
}) {
  const empty = () => ({ initial: [], final: [] });
  if (!text || limit <= 0 || !current()) return empty();
  const end = now * 1000, records = new Map();
  async function read(sql, params) {
    await db.executeCached(sql, { ...params, end }, (value, cancel) => {
      if (!current()) { cancel(); return; }
      const row = Object.fromEntries(FIELDS.map(key => [key, value.getResultByName(key)]));
      records.set(row.url, row);
    });
  }
  for (const [leading] of COMMAND_URL_PREFIXES) {
    const prefix = leading + text, filter = originFilter(prefix);
    // Prefix caps precede significance/exclusion. Filtering out weak or
    // excluded matches here would incorrectly backfill them with lower rows.
    await read(`SELECT * FROM (
      SELECT ${RECORD} FROM moz_origins o CROSS JOIN moz_places p ON p.origin_id = o.id
      WHERE ${filter.condition} AND ${VISIBLE} AND p.url >= :prefix AND p.url < :prefixEnd
      UNION ALL
      SELECT ${RECORD} FROM moz_places p WHERE p.origin_id IS NULL AND ${VISIBLE}
        AND p.url >= :prefix AND p.url < :prefixEnd
    ) ORDER BY typedCount DESC, visitCount DESC, lastVisit DESC LIMIT :maximum`,
    { prefix, prefixEnd: prefix + "\uffff", maximum: limit * 2, ...filter.params });
    if (!current()) return empty();
  }
  const modelOptions = { ...options, text, canonicalize, now, limit };
  const lookups = commandPrefixHistoryLookups([...records.values()], modelOptions);
  for (const request of lookups.shorter) {
    await read(`SELECT ${RECORD} FROM moz_places p
      WHERE p.origin_id IS (SELECT origin_id FROM moz_places
        WHERE url_hash = hash(:best) AND url = :best)
        AND ${VISIBLE} AND p.url ${request.mayAddBase ? ">=" : ">"} :base
        AND p.url < :best AND substr(:best, 1, length(p.url)) = p.url
        AND p.visit_count >= :minimumVisits AND typedCount >= :minimumTyped
      ORDER BY p.url ASC LIMIT 1`,
    { best: request.best, base: request.base, minimumVisits: request.minimumVisits,
      minimumTyped: Math.max(request.minimumTyped, Number(request.typedOnly)) });
    if (!current()) return empty();
  }
  if (lookups.exactURLs.length) {
    await read(`SELECT ${RECORD} FROM json_each(:urls) wanted CROSS JOIN moz_places p
      ON p.url_hash = hash(wanted.value) AND p.url = wanted.value WHERE ${VISIBLE}`,
    { urls: JSON.stringify(lookups.exactURLs) });
    if (!current()) return empty();
  }
  const redirects = new Map();
  if (records.size) {
    // Follow only the newest visit, including when it has no redirect. An old
    // redirect must not remove a separately visited result in a later session.
    await db.executeCached(`WITH RECURSIVE chains(source, id, path, depth) AS (
      SELECT p.url, v.id, ',' || v.id || ',', 0
      FROM json_each(:ids) wanted CROSS JOIN moz_places p ON p.id = wanted.value
      JOIN moz_historyvisits v ON v.id = (
        SELECT id FROM moz_historyvisits WHERE place_id = p.id AND visit_date <= :end
        ORDER BY visit_date DESC, id DESC LIMIT 1)
      UNION ALL
      SELECT chains.source, next.id, chains.path || next.id || ',', chains.depth + 1
      FROM chains JOIN moz_historyvisits next ON next.id = (
        SELECT id FROM moz_historyvisits WHERE from_visit = chains.id
          AND visit_type IN (5, 6) AND visit_date <= :end ORDER BY id LIMIT 1)
      WHERE instr(chains.path, ',' || next.id || ',') = 0
    ) SELECT chains.source, p.url FROM chains
      JOIN moz_historyvisits v ON v.id = chains.id JOIN moz_places p ON p.id = v.place_id
      WHERE chains.depth > 0 ORDER BY chains.source, chains.depth`,
    { ids: JSON.stringify([...records.values()].map(row => row.id)), end }, (value, cancel) => {
      if (!current()) { cancel(); return; }
      const source = value.getResultByName("source");
      if (!redirects.has(source)) redirects.set(source, []);
      redirects.get(source).push(value.getResultByName("url"));
    });
  }
  return current() ? commandPrefixHistory([...records.values()], { ...modelOptions, redirects }) : empty();
}
