# Download hover file actions

Reference: Arc 1.171.0 (89666), executable SHA-256
`e82d2a4245b6239860e41a149cb31c0c030e35b383456544c81f21d45ee03376`.
Arc was inspected read-only. No Arc file actions or sharing operations were invoked.

The native HomeBadgingCell context-menu closure (`0x102695188`, through
`0x10269f038`, `0x102697c0c`, `0x10269f24c`) builds its menu at
`0x10269830c`. The ordinary-file branch begins at `0x102699434`; the
completed-download branch at `0x102699754`. Both order their actions as:
Copy [kind], separator, Send via iMessage, AirDrop, separator, Open in
[application], Show in Finder, separator, Hide from [browser], Move to Trash.
The active-download branch (`0x10269a254`) offers Cancel Download only.
Failed/paused/cancelled branches produce an empty view. Source-URL actions
belong to captures, not ordinary downloaded files.

The kind helper (`0x10261523c`) uses UTType.image, movie and pdf. The English
labels are Image, Video, PDF and File. The open-label helper (`0x1026ee350`,
`0x1026366d4`) resolves the default application using NSWorkspace and NSBundle.
The browser Hide callback (`0x10269fa80`, through `0x10269f818` with action 3)
emits removeDownload(id); FileQueryClient separately exposes ignorePath and
persists ignored paths. Zen maps these onto its combined browser-record and
Downloads-directory feed, keeping ordinary hidden files separate from hidden
browser records. The latter suppress only the hover's disk fallback, not Media.
Ordinary page visits and the downloaded file are preserved. Private hides do
not write paths to the persistent store.

Native copy writes an NSImage for image files and a file URL for other files.
Sharing invokes the macOS Messages or AirDrop interface only on an explicit
menu command. Trash uses NSFileManager.trashItemAtURL, with no permanent-delete
fallback. Tests use a unique private pasteboard and owned files; the trashed
fixture is restored before cleanup. Sharing delivery is not exercised.

The live Arc PDF preview's More menu was separately inspected via native UI:
Open PDF, Copy PDF, Show in Finder, Hide from Arc, Move to Trash. That preview
integration and PDF/image click routing remain separate unfinished work; this
change wires the hover menu only. The UI uses Zen's own product name.

Validation: 437 source tests, 105 configuration tests, 429 owned headed checks
and 21 native file-action checks. The headed scripts include all five Space
menus, hover retention/dismissal, backfill, download-only history removal,
private-window persistence boundaries and an actual browser restart. A grouped
progress-geometry check initially failed; its unchanged isolated rerun passed
62/62. Native CUA inspection verified the visible four-item preview and menu
labels. The native menu was opened by an event in the owned profile; CUA has no
hover API, so this is not a claim of native Arc pointer-event capture.

Overlay 0123 reconstructs every browser/root archive entry and reapplies as a
no-op. Theme resources remain byte-identical. The strict configuration suite
still stops at the unrelated tips_tmux.lua:366 const-assignment error. These
checks do not claim full Arc parity or browser-wide performance superiority.
