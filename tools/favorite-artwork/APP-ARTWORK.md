# Favorite app artwork

The app tray substitutes its own artwork for Twitter, Gmail, Spotify,
YouTube and WhatsApp. The 40-point image view retains the padding inside each
asset; the ordinary favicon view remains 16 points. Light and dark variants
are selected by the Space appearance, with system appearance as the fallback.
Custom artwork takes precedence. App matching follows the current page URL,
including restored lazy tabs, and uses the saved destination only when no
current URL is available. Changing appearance refreshes the selected outline.

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
  The reference does not add `x.com` as a Twitter alias.
- Follow-up URL-input trace (2026-11-06): `0x10019ebcc` builds the ChildItem.
  Custom artwork from `0x100d40eb8` suppresses its matching URL; otherwise
  `0x10019f184` calls `0x102a5ca5c`. That function resolves WindowContent
  through `0x102130f4c`. Its webContent branch reads `WebContentState.url`
  at `0x102a5d18c`; only absent content/URL falls back to `SidebarTab.savedURL`
  at `0x102a5d118`. This corrects the earlier assumption that saved URLs
  always controlled app artwork. Ordinary native UI inspection confirmed a
  saved Twitter Favorite displaying the X site favicon before selection,
  during loading, and after its live x.com page loaded.
- Zen uses the current URI exposed by Gecko's lazy browser without waking
  the tab. Top-level location changes refresh both the app match and outline,
  even if the favicon did not change. Subframes leave Favorite artwork alone.
- Asset export uses AppKit under Aqua and Dark Aqua, from the original
  ARCClients_BaseAssets.bundle. The source image size is 46×46 points. Each is
  drawn into the reference's 40-point view at this Mac's 2× scale and embedded
  unchanged in a 40-point SVG wrapper. Transparency and internal padding are
  preserved. Twitter and Spotify have visibly different appearance variants.

These are static control-flow and asset observations, not execution of Arc's
entire private icon provider. URL parsing edge cases beyond the recorded
fixtures and rendering at other display scales are not certified here.

## Verification

`test-live-artwork.py` runs `browser-app-artwork.js` against a disposable
profile. It maps only the fixture's app hosts to loopback, serves its own
pages and favicon, and exercises real redirects, back/forward, lazy restore,
custom artwork, light/dark sizing and outlines, unchanged favicons across
URL exclusions, and mirrored windows. No production profile is used.
The URL matcher and manager lifecycle also have automated unit coverage.
The 2026-11-06 run passed 35 native checks and all 1,143 source checks.

Run with `--app` pointing to the candidate bundle, `--config` pointing to
Astralforge, and `--output` pointing to a local JSON evidence file.

This change does not complete the broader Arc parity or performance work.
The last accepted comparable Speedometer result still trails Arc by about 28%.
