# Favorite app artwork

The app tray substitutes its own artwork for Twitter, Gmail, Spotify,
YouTube and WhatsApp. The 40-point image view retains the padding inside each
asset; the ordinary favicon view remains 16 points. Light and dark variants
are selected by the Space appearance, with system appearance as the fallback.
Custom artwork takes precedence. Saved destination changes refresh both
windows, and changing appearance refreshes the selected outline.

## Reference evidence

Read-only inspection of the installed Arc arm64 executable, SHA-256
`e82d2a4245b6239860e41a149cb31c0c030e35b383456544c81f21d45ee03376`:

- `0x10019d71c` calls the default matching set constructor `0x100d69990`.
  Its static array at `0x104588d18` contains five TopApp values, `[1,2,5,6,0]`.
  The set is written into AppTrayViewControllerViewState and propagated by
  `0x101d36d90` to the item view state.
- `0x100d699c0` maps those values to `TwitterAppTrayIcon`, `GmailAppTrayIcon`,
  `SpotifyAppTrayIcon`, `YouTubeAppTrayIcon`, and `WhatsAppAppTrayIcon`.
  Other TopApp values exist but are not in the default replacement set.
- `0x101d26740` calls the image lookup at `0x101d4b3b0`. Successful replacement
  selects a 40×40-point view; the normal favicon branch selects 16×16.
- URL preprocessing at `0x101d4b564` follows the first `continue` or `followup`
  query item on `accounts.google.com`. Matching at `0x101d4bb7c` checks the
  canonical host/subdomain or the normalized display alias. Gmail excludes a
  first path component `chat`; YouTube excludes exactly `music.youtube.com`.
  The reference does not add `x.com` as a Twitter alias. Existing Favorites
  whose saved destination is twitter.com retain the Twitter artwork after
  navigation, consistent with the saved-destination behavior used by Zen.
- Asset export uses AppKit under Aqua and Dark Aqua, from the original
  ARCClients_BaseAssets.bundle. The source image size is 46×46 points. Each is
  drawn into the reference's 40-point view at this Mac's 2× scale and embedded
  unchanged in a 40-point SVG wrapper. Transparency and internal padding are
  preserved. Twitter and Spotify have visibly different appearance variants.

These are static control-flow and asset observations, not execution of Arc's
entire private icon provider. URL parsing edge cases beyond the recorded
fixtures and rendering at other display scales are not certified here.

## Verification

`npm run test:astral`: 844 passing checks. `browser-app-artwork.js` runs only
against a disposable profile and exercises the packaged browser with the
matching profile stylesheet: 30 passing checks, including five light/dark
assets, decoding and geometry, custom artwork, exclusions, redirects,
appearance-dependent outlines, and changes across windows. Light/dark browser
captures were inspected. Calendar and saved-favicon checks remain passing.

This change does not complete the broader Arc parity or performance work.
The last accepted comparable Speedometer result still trails Arc by about 28%.
