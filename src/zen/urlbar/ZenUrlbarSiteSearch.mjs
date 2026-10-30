// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/** Resolve a bare alias, or the alias of a domain being completed. */
export function siteSearchEngine(query, engines, completionURL = null) {
  // An explicit scheme, path or space is address/query input, not an alias.
  // In particular, do not trim a space typed after dismissing a scope.
  if (!query || /\s/u.test(query)) return null;
  const typed = query.toLowerCase();
  const exact = engines.find(engine =>
    engine.aliases.some(alias => alias.toLowerCase() === typed));
  if (exact) return exact;
  if (/[/:?#@]/u.test(query)) return null;
  let host;
  try {
    const uri = new URL(completionURL);
    if (!/^https?:$/.test(uri.protocol) || uri.username || uri.password) return null;
    host = uri.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
  if (!host.startsWith(typed)) return null;
  return engines.find(engine => engine.aliases.some(alias =>
    alias.toLowerCase() === host)) ?? null;
}
