import assert from "node:assert/strict";
import test from "node:test";
import { favoriteAppArtwork } from "../../src/zen/tabs/ZenFavoriteArtwork.sys.mjs";

// Cases from the reference's five-entry TopApp set, URL matching branches,
// and Google account URLComponents redirect handling. No service is contacted.
const cases = [
  ["https://twitter.com/", "twitter"],
  ["https://mobile.twitter.com/home", "twitter"],
  ["https://TWITTER.com/home", null],
  ["https://TWITTER.com/", "twitter"],
  ["https://x.com/", null],
  ["https://mail.google.com/mail/u/2/", "gmail"],
  ["https://gmail.com/", "gmail"],
  ["https://gmail.com/?", "gmail"],
  ["https://gmail.com?/", null],
  ["https://gmail.com/inbox", null],
  ["https://mail.google.com/chat", null],
  ["https://mail.google.com//chat/u/0", null],
  ["https://mail.google.com/%63hat/u/0", null],
  ["https://mail.google.com/Chat", "gmail"],
  ["https://mail.google.com/mail/chat", "gmail"],
  ["https://open.spotify.com/album/fixture", "spotify"],
  ["https://youtube.com/watch?v=fixture", "youtube"],
  ["https://www.youtube.com/", "youtube"],
  ["https://music.youtube.com/", null],
  ["https://www.music.youtube.com/", "youtube"],
  ["https://web.whatsapp.com/send", "whatsapp"],
  ["https://whatsapp.com/", "whatsapp"],
  ["https://whatsapp.com/download", null],
  ["https://calendar.google.com/", null],
  ["https://notion.so/", null],
  ["https://slack.com/", null],
  ["https://figma.com/", null],
  ["https://accounts.google.com/?continue=https%3A%2F%2Fmail.google.com%2F", "gmail"],
  ["https://accounts.google.com/?followup=https%3A%2F%2Fyoutube.com%2F&continue=https%3A%2F%2Fmail.google.com%2F", "youtube"],
  ["https://accounts.google.com/?continue=&followup=https%3A%2F%2Fyoutube.com%2F", null],
  ["https://accounts.google.com/?continue=https%3A%2F%2Fmusic.youtube.com%2F", null],
  ["https://accounts.google.com/?continue=https%3A%2F%2Fmail.google.com%2Fchat", null],
  ["https://accounts.google.com/?Continue=https%3A%2F%2Fyoutube.com%2F", null],
  ["https://accounts.google.com.example.test/?continue=https%3A%2F%2Fyoutube.com%2F", null],
  ["https://youtube.com.example.test/", null],
  ["https://notyoutube.com/", null],
  ["https://example.test/?url=https://youtube.com", null],
  ["about:blank", null],
  ["", null],
];

for (const [url, expected] of cases) {
  test(`app artwork: ${url || "empty URL"}`, () => {
    assert.equal(favoriteAppArtwork(url)?.id ?? null, expected);
  });
}

test("all replacements provide both bundled appearance variants", () => {
  for (const url of ["twitter.com", "mail.google.com", "spotify.com", "youtube.com", "web.whatsapp.com"]) {
    const artwork = favoriteAppArtwork(`https://${url}/`);
    for (const appearance of ["light", "dark"]) {
      assert.equal(artwork[appearance],
        `chrome://browser/content/zen-images/favicons/app-tray/${artwork.id}-${appearance}.svg`);
    }
  }
});
