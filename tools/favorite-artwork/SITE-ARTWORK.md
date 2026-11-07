# Website-driven Favorite artwork

## Correction to the Calendar override

Direct observation on 2026-11-03 contradicted the earlier assumption that Arc
advances Calendar's image from the local clock. Arc initially displayed the
cached blue “1” favicon. Selecting Calendar initially kept “1”; after the page
loaded, the website supplied “3”. It remained “3” after returning to the original
YouTube tab. Arc's current unselected NYT icon was white as in Zen, so no new
monochrome tint rule was justified by the earlier screenshot.

The existing default app-tray replacement set also excludes Calendar (see
`APP-ARTWORK.md`). Zen now lets Calendar use the normal website-favicon path:
cached artwork persists until the page changes it. The Calendar-only midnight,
focus, wake and timezone override is removed. Custom images and saved-destination
fallbacks remain, as do the five verified app-tray replacements.

This supersedes the synthetic clock behavior documented in the 2026-10-25
Calendar implementation. Its 31 packaged artwork resources remain available as
offline test inputs and for compatibility with the existing overlay catalog;
the runtime no longer selects them using the system date.

## Evidence and limits

- 835 source checks pass. Clock-specific expectations were replaced with tests
  for cached website artwork and incoming favicon updates.
- 25 packaged-browser checks cover five Spaces, unloaded tabs, date/timezone
  changes, favicon updates, error recovery and custom artwork.
- The same checks pass with two consecutive profile launches; restored site
  artwork is preserved on both launches.
- 14 saved-artwork and 30 app-tray checks remain passing. A separate two-window
  probe confirms a new favicon reaches the unloaded mirror and its serialized
  tab state; no additional synchronization change was needed.

Arc's observed page transition is direct UI evidence. The browser tests use
synthetic favicon events and do not claim a physical midnight observation or
complete favicon-selection parity for every website. The overall visual,
physical-trackpad and faster-than-Arc goals remain open.
