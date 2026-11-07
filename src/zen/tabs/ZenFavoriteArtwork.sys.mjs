/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Arc's default AppTray highFidelityIconMatchingApps set contains these five
// entries. Other sites keep their own favicon, including website-driven date updates.
const APPS = [
  ["twitter", "twitter.com", "twitter.com"],
  ["gmail", "mail.google.com", "gmail.com"],
  ["spotify", "spotify.com", "spotify.com"],
  ["youtube", "youtube.com", "youtube.com"],
  ["whatsapp", "web.whatsapp.com", "whatsapp.com"],
];

function parseURL(spec) {
  const url = new URL(spec);
  // Unlike WHATWG URL.hostname, Foundation preserves the host's casing.
  // Keep it for Arc's case-sensitive host predicate; the display alias below
  // has its own lowercasing step. Browser-saved URLs are normally canonical.
  const authority = /^[^:/?#]+:\/\/([^/?#]*)/.exec(spec)?.[1];
  let host = authority === undefined ? url.hostname
    : authority.slice(authority.lastIndexOf("@") + 1).replace(/:\d*$/, "");
  try { host = decodeURIComponent(host); } catch {}
  return { url, host, spec };
}

function redirectedURL(parsed) {
  if (parsed.host !== "accounts.google.com") return parsed;
  // Foundation URLComponents decodes percent escapes, but preserves literal
  // plus signs. Its first continue/followup item wins, including an empty one.
  try {
    for (const item of parsed.url.search.slice(1).split("&")) {
      const separator = item.indexOf("=");
      const name = decodeURIComponent(separator < 0 ? item : item.slice(0, separator));
      if (name !== "continue" && name !== "followup") continue;
      if (separator < 0) return parsed;
      try {
        return parseURL(decodeURIComponent(item.slice(separator + 1)));
      } catch {
        return parsed;
      }
    }
  } catch { /* Malformed redirect query retains the original URL. */ }
  return parsed;
}

export function favoriteAppArtwork(spec) {
  let parsed;
  try {
    parsed = redirectedURL(parseURL(spec));
  } catch {
    return null;
  }
  const { url } = parsed;
  const host = parsed.host.replace(/^www\./, "");
  const alias = parsed.spec.replace(/^https?:\/\//, "").replace(/^www\./, "")
    .replace(/\?$/, "").replace(/\/$/, "").toLowerCase();
  for (const [id, domain, displayDomain] of APPS) {
    if (host !== domain && !host.endsWith(`.${domain}`) && alias !== displayDomain) continue;
    if (id === "youtube" && parsed.host === "music.youtube.com") return null;
    if (id === "gmail") {
      // URL.pathComponents ignores repeated separators and decodes the path.
      let path = url.pathname;
      try { path = decodeURIComponent(path); } catch {}
      if (path.split("/").filter(Boolean)[0] === "chat") return null;
    }
    const base = `chrome://browser/content/zen-images/favicons/app-tray/${id}`;
    return { id, light: `${base}-light.svg`, dark: `${base}-dark.svg` };
  }
  return null;
}

/** Remember a favicon supplied by the pinned page, not a different destination. */
export function refreshedPinnedArtwork({ pinnedURL, pageURL, image, savedImage }) {
  if (typeof image !== "string" || !image || image === savedImage ||
      image === "chrome://global/skin/icons/defaultFavicon.svg" ||
      image === "chrome://global/skin/icons/info.svg") return null;
  try {
    const pinned = new URL(pinnedURL), page = new URL(pageURL);
    if (!/^https?:$/.test(pinned.protocol)) return null;
    pinned.hash = page.hash = "";
    return pinned.href === page.href ? image : null;
  } catch {
    return null;
  }
}
