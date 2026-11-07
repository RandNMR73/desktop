/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { SITE_TITLE_RULES } from "./ZenSiteSearchTitleRules.mjs";

// Foundation's whitespace set includes NEL, but not the JS-only BOM character.
const EMPTY_TITLE = /^[\p{White_Space}\u200b]*$/u;
const regex = pattern => new RegExp(pattern.replaceAll("\\s", "\\p{White_Space}")
  .replaceAll("\\–", "–"), "gu");

/** Compile once; the five recent candidates share the same immutable rules. */
export function siteTitleCleaner(configuration = SITE_TITLE_RULES) {
  const hosts = new Map(Object.entries(configuration).map(([host, rules]) => [host,
    rules.map(({ match, title }) => {
      const [kind, value] = Object.entries(match ?? {})[0] ?? [];
      return { kind, value,
        match: kind?.endsWith("Regex") ? regex(value) : null,
        always: title.always,
        remove: (title.removingPatterns ?? (title.removingPattern === undefined ? [] :
          [title.removingPattern])).map(regex),
      };
    }),
  ]));
  return (url, title) => {
    if (typeof title !== "string") return null;
    let uri;
    try { uri = new URL(url); } catch { return null; }
    const rules = hosts.get(uri.hostname.replace(/^www\./, ""));
    if (!rules) return null;
    // URL.path removes a single trailing slash except at the root. Its fragment
    // getter keeps percent escapes, while its path getter decodes them.
    let path = uri.pathname;
    try { path = decodeURIComponent(path); } catch { /* Retain malformed escapes. */ }
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    const fragment = uri.hash ? uri.hash.slice(1) : null;
    for (const rule of rules) {
      if (rule.kind) {
        const value = rule.kind.startsWith("path") ? path : fragment;
        if (value === null) continue;
        if (rule.match) {
          rule.match.lastIndex = 0;
          if (!rule.match.test(value)) continue;
        } else if (value !== rule.value) continue;
      }
      let result = rule.always ?? title;
      for (const pattern of rule.remove) result = result.replace(pattern, "");
      // The reference tests trimmed emptiness, but preserves surrounding space
      // in the returned label. A blank rewrite falls back to the original title.
      return EMPTY_TITLE.test(result) ? null : result;
    }
    return null;
  };
}

export const tidySiteSearchTitle = siteTitleCleaner();
