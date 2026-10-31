# Downloads hover preview

The reference is the user-provided Arc capture, 478 × 552 physical pixels at 2×. The sidebar portion ends near x=456. The visible rows have 40 pt thumbnails at x=8, titles at x=60, and a 56 pt vertical pitch. AppKit system font measurements support 14 pt titles and 12 pt subtitles. The newest of the four items is nearest the footer. Document thumbnails are rounded; file-type icons retain their native silhouette. The flyout has no separate opaque panel.

Read-only Arc 1.171.0 reflection identifies HomeBadgingDataItem's file/capture/download cases, HomeBadgingItems' fileQueryResultsLoaded action, HomeBadgingFeatureState's button/flyout hover states, and HomeBadgingCellStack. Its height helper at 0x1026e14c4 computes 56 × count + 32. The screenshot and Arc Downloads library show different file sets, consistent with the flyout including Downloads-folder files as well as browser history.

Implementation merges the four most recent local Downloads-folder files with persisted browser downloads, deduplicates paths, and keeps public folder contents out of private windows. Native folder metadata and Quick Look thumbnail work run asynchronously; only four results are returned, thumbnails are cached with a 16-entry bound, and outstanding work is cancelled on teardown. Cloud placeholders are never fetched for a thumbnail. The optional native ABI falls back to Gecko file icons and download history when unavailable.

Validation: 420 source tests; 17 native ABI/date/list checks; 129 headed five-Space checks; 12 headed interaction/privacy checks; 41 configuration/native/overlay tests. The headed checks use DOM mouseenter/mouseleave in an owned disposable profile, and include actual Quick Look thumbnail generation. Native CUA inspection confirmed the candidate's rendered flyout. The full strict config suite stops at the pre-existing tips_tmux.lua:366 const-assignment error.

Remaining reference validation: the computer-use API has no native hover operation, and pointer scroll/drag did not reproduce Arc's live flyout. Exact native opening/closing timing, spring curves, and Arc row-click/context-menu parity are not certified by these tests. The supplied screenshot is the visual reference; synthetic hover tests establish Zen's behavior, not a direct native Arc timing comparison. The overall Arc parity goal remains open.

Apple thumbnail API: https://developer.apple.com/documentation/quicklookthumbnailing/qlthumbnailgenerator/generatebestrepresentation(for:completion:)
