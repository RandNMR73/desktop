# Downloads hover preview

The reference is the user-provided Arc capture, 478 × 552 physical pixels at 2×. The sidebar portion ends near x=456. The visible rows have 40 pt thumbnails at x=8, titles at x=60, and a 56 pt vertical pitch. AppKit system font measurements support 14 pt titles and 12 pt subtitles. The newest of the four items is nearest the footer. Document thumbnails are rounded; file-type icons retain their native silhouette. The flyout has no separate opaque panel.

Read-only Arc 1.171.0 reflection identifies HomeBadgingDataItem's file/capture/download cases, HomeBadgingItems' fileQueryResultsLoaded action, HomeBadgingFeatureState's button/flyout hover states, and HomeBadgingCellStack. Its height helper at 0x1026e14c4 computes 56 × count + 32. The screenshot and Arc Downloads library show different file sets, consistent with the flyout including Downloads-folder files as well as browser history.

Implementation merges the four most recent local Downloads-folder files with persisted browser downloads, deduplicates paths, and keeps public folder contents out of private windows. Native folder metadata and Quick Look thumbnail work run asynchronously; only four results are returned, thumbnails are cached with a 16-entry bound, and outstanding work is cancelled on teardown. Cloud placeholders are never fetched for a thumbnail. The optional native ABI falls back to Gecko file icons and download history when unavailable.

Validation: 420 source tests; 17 native ABI/date/list checks; 129 headed five-Space checks; 12 headed interaction/privacy checks; 41 configuration/native/overlay tests. The headed checks use DOM mouseenter/mouseleave in an owned disposable profile, and include actual Quick Look thumbnail generation. Native CUA inspection confirmed the candidate's rendered flyout. The full strict config suite stops at the pre-existing tips_tmux.lua:366 const-assignment error.

Remaining reference validation: the computer-use API has no native hover operation, and pointer scroll/drag did not reproduce Arc's live flyout. Read-only code tracing now establishes the 150 ms button hover requirement: HomeButtonHoverRegionTracker at 0x1026ed30c creates HomeButtonRegion with lingerRequirement 0.15 and hasLingered fidelity; 0x1026ed7f0 accepts only states beyond inside, and HoverRegionTracker schedules now + that requirement at 0x1009e6a94. Zen waits for that continuous dwell, cancels on exit or Library opening, and prevents a fast directory result from bypassing the timer. The footer badge shares the row’s cached native thumbnail, with stale-result protection. Exact live native pointer timing and Arc row-click/context-menu parity are not certified by these tests. The supplied screenshot is the visual reference; synthetic hover tests establish Zen's behavior, not a direct native Arc timing comparison. The overall Arc parity goal remains open.

Apple thumbnail API: https://developer.apple.com/documentation/quicklookthumbnailing/qlthumbnailgenerator/generatebestrepresentation(for:completion:)

Timing follow-up validation: 420 source tests, 41 configuration/overlay tests, 11 headed interaction checks, and 129 headed five-Space checks. Layout checks await the row transitions before measuring; an earlier sample caught the top row 0.033 pt before settling. A separate timer trace recorded the 150 ms request firing after 156 ms, and cancellation/re-entry tests pass. The first fixed-deadline test sampled before a delayed callback during concurrent validation; the final test waits for completion after asserting no early opening.

The hover-region follow-up replaces the blanket 200 ms close delay with Arc's region rules: leaving the rectangular flyout/button area closes immediately, crossing the footer dock remains open, and 500 ms of continuous dock hover closes it. Returning to the rows cancels the dock timer. Arc's region registration is at 0x1026ed30c, geometry at 0x1026ed97c, immediate outside state at 0x1009e7f58, and reducer recomputation at 0x1026afe7c. The dock guard keypath refers to `shouldTrackDockRegionHover`, confirmed from ViewState descriptor 0x103d61640. A transparent 32 pt target surrounds the existing 28 pt visible button; no icon or row layout changes. Cached rectangles avoid style/layout reads during pointer movement, and pointer listeners exist only while the preview is open. Window blur cancels pending entry and closes the preview; context-menu ownership holds it open until dismissal.

Hover-region validation: 41 coordinate-bearing headed checks and 129 five-Space layout checks pass. The 32 pt outer inset is verified with actual DOM hit testing; the dock timer fired after 510 ms in the headed run. The candidate was also inspected through native CUA. These tests verify Zen against the read-only Arc code reference; they do not constitute native Arc pointer capture.

The row-motion follow-up uses Arc’s native `interactiveSpring(response: 0.15, dampingFraction: 0.86, blendDuration: 0.25)` with a 12.5 ms reverse-row stagger. Ordinary rows close 56 pt downward; the bottom row closes 20 pt downward. Read-only addresses and reflection findings are recorded in `arc-motion-reference.json`. `SpringReference.swift` samples the independent SwiftUI implementation; 1,803 native samples match the analytic curve to floating-point precision. The fixed response/damping parameters require no response blending. Interrupted transitions carry position and velocity into the next spring, including any pending stagger. The distinct visible-footer-badge trajectory and sidebar masking curve remain separate work.

Motion uses compositor transform/opacity keyframes, with no per-frame JavaScript. Curve simplification and a bounded eight-entry resting-transition cache keep interpolation error below 0.02 pt in the tested trajectories. A headed four-row scheduling measurement improved from median 7.36 ms to 2.79 ms (20 immediate reversals on this machine); this is a local setup-time comparison, not a browser-wide speed claim. Close completion is tied to the latest transition, preventing an older completion from hiding a newly closing preview. Rows become interactive after the native global 150 ms lifecycle; reduced motion creates no row animation.

Motion validation: 426 source tests, 27 headed rendered-motion checks, 18 interaction/reduced-motion checks, 41 hover-region checks, and 129 five-Space layout checks pass. `motion-headed.js`, `motion-interaction-headed.js`, and `motion-validation.json` preserve the test and results. Native CUA inspection confirmed the rendered candidate. The headed tests use an owned disposable profile and synthetic pointer events; they do not certify direct native Arc hover capture. Image/PDF click previews, context actions, and the clear-preview cutoff remain outstanding.


Completed-download badge follow-up: the footer thumbnail now measures 22 pt (40 pt × 0.55), centered 10 pt right and 12 pt above the button center. Opening animates the actual row from that location, avoiding a duplicate-image handoff. The native 40 pt to full-width layout and scale compose into a curved horizontal path; the vertical position follows the same native spring. Inserted text fades and moves independently to match SwiftUI layout. `BadgeClockReference.swift` and `BadgeBlocksReference.swift` reconstruct the read-only Arc modifier trace in an owned offscreen NSHostingView. 65 native frames verify icon centroids within 0.04 pt and inserted-details centroids within 0.08 pt. These are reconstructed native reference measurements, not a recording of production Arc hover.

Arc consumes a completed download badge when the flyout opens. A quick exit continues its expansion while fading/moving to the ordinary closed-row position, preserving incoming momentum. Active downloads retain the existing separate badge path; their artwork, arrival/dismissal phases, and failed/cancelled states still need parity work. The read-only addresses and limitations are recorded in `arc-badge-reference.json`.

Adaptive sampling retains a tested sub-0.02 pt compositor interpolation bound across 160–984 pt row widths and repeated reversals. A local 20-run comparison reduced median badge-frame preparation from 15.99 ms to 1.23 ms; no per-frame JavaScript is used. This measures animation preparation, not browser-wide performance versus Arc.

Validation: 429 source tests, 105 configuration/native/overlay tests, 16 headed badge checks, 129 five-Space checks, 41 hover-region checks, 27 ordinary-motion checks, and reduced-motion checks. Native CUA inspected the rendered candidate. Full strict configuration checks still stop at the pre-existing `tips_tmux.lua:366` const-assignment error. Image/PDF click previews, context actions, cutoff behavior, and native pointer capture remain open.


Active-download artwork follow-up: every row reserves a 40 pt thumbnail frame, keeping active-download titles at the same 60 pt leading position as completed files. Arc's DownloadProgressBadge trace specifies a 24 pt face, 1 pt half-opacity outline, 21.5 pt progress frame, 2.5 pt round-ended stroke, 20% track, and `arrow.down` in the heavy 10 pt system font. The footer uses the same frame at 0.8 scale and the native +10/−12 pt center offset. Paused downloads use an empty thumbnail slot. Zero progress produces no round-cap dot. The Space marker now also reaches the footer; generated palette tokens use cutoutColor, foregroundPrimary, and maxContrastColor with sidebar contrast.

`ProgressReference.swift` independently reconstructs the static native drawing. At 2×, SwiftUI rounds the 21.5 pt frame's 9.25 pt origin to a display pixel, shifting only the rings by 0.25 pt; Zen applies this placement using the current device pixel size. The native system arrow is retained as a 2× template mask. The reference is reconstructed from Arc's read-only code, not captured from Arc's live hover. Other display scales, active badge travel/arrival/dismissal, progress rotation, and completion choreography remain open.

Validation: 429 source tests, 105 configuration/native/overlay tests, 62 active/paused/resumed five-Space checks, 129 completed-row checks, 41 hover-region checks, 16 completed-badge checks, 27 ordinary-motion checks and 20 interaction/reduced-motion checks pass. Full and incremental overlays reconstruct the candidate byte-for-byte and reapplication is a no-op. CUA inspection confirms the rendered candidate. The 25 static 2× comparisons against the native reconstruction have mean absolute RGB error 0.224–0.613/255 over each 80×80 image; individual edge pixels differ by up to 94/255. Geometry and palette agreement do not imply pixel-identical antialiasing. Full strict configuration checks retain the unrelated Neovim error described above.

Active-download motion follow-up: the actual row now travels from its 32 pt footer frame to its 40 pt preview frame and returns along the native layout curve. It remains opaque while the details fade independently. Rapid reversal preserves position and velocity, and the footer copy stays hidden until the row returns. Cancelling the old visibility transition prevents a delayed or duplicate icon. A pending download retains its footer selection when the preview closes, so completion afterwards keeps its thumbnail until the completed item is viewed. Reused rows release their old animation state and close from their current expanded layout.

`arc-active-motion-reference.json` records the read-only Arc addresses and scope. `ActiveBadgeReference.swift` independently renders 129 opening/closing native frames. The measured geometry agrees within 0.029 pt for icon centroids, 0.097 pt for size, and 0.016 pt for detail centroids. Timing uses the separately verified native spring. These are reconstructed SwiftUI measurements, not production Arc hover recordings. Arrival/dismissal phases, progress rotation, completion choreography, failed/cancelled visuals, and image/PDF/context-menu actions still require work.

Validation: 431 source tests, 105 configuration/native/overlay tests, and 329 headed checks, including 34 active-motion/lifecycle checks and the existing five-Space, hover-region, completed-badge and reduced-motion coverage. The final row-replacement change was rechecked with active-motion and five-Space layout suites. Evidence is in `active-motion-headed.js` and `active-motion-headed.json`; the configuration repository retains the package reconstruction report. Full strict checks still stop at the unrelated `tips_tmux.lua:366` const-assignment error. This does not establish full Arc parity or browser-wide speed superiority.

Progress/completion follow-up: active progress changes now use the native 350 ms ease-out trim, retargeted from the visible arc when interrupted. Reaching 100% while active swaps to a size-9 heavy checkmark and halves ring opacity. The native late pulse begins at 1.15 s, grows to 1.03 at 1.3 s, then contracts to 0.97 and fades by 1.45 s. The footer and row share the item's original completion clock; replacement, pause, success and teardown cancel stale animations. Success immediately exposes the downloaded file without waiting for the decorative fade. Initial 100% does not run the native on-change callback.

`arc-completion-reference.json` records the read-only addresses, including states that are written but never drawn. `CompletionReference.swift` confirms that the early 0.9-to-1 writes coalesce; no early pulse or unused-state ripple is invented. Its 102 geometry samples support the shape of the late animation, with approximately 10–20 ms render-clock uncertainty. Independent public SwiftUI UnitCurve samples validate the easing separately. Constant-angle rotation modifiers do not establish continuous rotation.

Validation: 431 source tests, 105 configuration tests, 366 headed checks (37 new completion/progress lifecycle checks), and 30 native static comparisons. The existing 25 progress comparisons retain mean RGB error 0.224–0.613/255; the five new completion comparisons measure 0.815–0.884/255, with individual edge differences up to 35/255. This is not pixel-identical rasterization. Native CUA inspection confirms four rows and the completion icon in the candidate. Full strict configuration checks still stop at the pre-existing Neovim const-assignment error. Direct production Arc hover capture, all-DPI rendering, arrival/dismissal, file actions and browser-wide performance remain outside this increment.


Folder-recency correction (2026-10-31): Arc's FileQueryItem reads `NSFileModificationDate`, rather than file birth time. The native folder query now selects its four entries using modification time, and the JS adapter uses the same timestamp for ordering and the displayed relative age. Browser download records keep their existing priority and start times. This adds no scans, timers, or per-frame work.

`arc-recency-reference.json` records the read-only reference. `TestDownloadRecency.m` loads the compiled ABI and creates six disposable files whose creation and modification orders disagree; it also checks replacement after hiding the newest item. Compile with `xcrun clang -fobjc-arc -Wall -Wextra -Werror -framework Foundation tools/native-theme-runtime/TestDownloadRecency.m -o /tmp/TestDownloadRecency` and pass the native dylib path. All 40 checks pass.

The 154 headed checks in `recency-headed.js` use six owned `recency-0.json` through `recency-5.json` files with modification ages 1–6 days and creation ages 12–7 days. They verify selection, labels and the existing geometry/hover behavior across five Spaces. 445 source tests pass. CUA inspected the rendered candidate. The initial run used an obsolete pointer helper; its eight failures and the corrected run are preserved in the configuration evidence. Direct production Arc hover capture, source preference controls and full visual parity remain open.


Source-query foundation (in progress, 2026-10-31): the optional native bridge can now combine Downloads with media from Documents, Desktop, and the configured macOS screenshot location. It accepts images and movies for media sources, filters before choosing four entries, deduplicates shared folders, and resolves settings plus files in one background request. Requests and returned results retain their existing bounds; older candidate files skip unnecessary media-type lookups. Capture saving is a separate Arc setting and is not implemented by this adapter.

The source query is now connected to the hover widget and its native source menu in the draft candidate. `arc-sources-reference.json` records the read-only reference and remaining capture/default questions. `source-query-validation.json` records 448 passing source tests, 124 native source checks and 40 recency checks against the complete signed native bundle, with all nine rendering assets unchanged. `TestDownloadSources.m` uses disposable folders only; reading the current screenshot-location preference does not alter it. The old library fails the new media-selection regression. This foundation validation predates the source-control UI checks below. This work in progress has not been installed.

Source membership follow-up: shared folders retain both Downloads and media eligibility. Hiding a browser download excludes its folder fallback without hiding an independently eligible image/movie; hiding a discovered disk file still excludes it from all folder sources. This is checked before choosing four entries, so another eligible item fills the vacant slot. The adapter retains media membership for the widget integration. The complete signed native bundle passes the 124 source and 40 recency checks; all nine rendering assets remain unchanged.


Source controls follow-up (draft): the Library button's native context menu now has Arc's disabled “Show media from:” heading and five independently persisted checkboxes in the observed order. The widget merges the selected folder sources, drops stale query results, and keeps one scan in flight. Source reconfiguration removes existing DownloadData when Downloads is disabled, while subsequent live arrivals still appear; this follows the read-only reducer trace. Restored history is kept for the Library view but is not treated as a new preview arrival. Normal windows share process arrivals; private windows share only their private session and clear it when its final window closes. An unrelated source change preserves an eligible unread download badge.

Capture controls and preview-source integration are still unfinished. The “Arc Captures” checkbox persists but is not connected to the capture store yet, so this remains an unmerged, uninstalled draft. The menu is inspected through native CUA accessibility; screenshots were unavailable, so this is not a pixel-parity claim.

Source-control validation: 453 source tests, 124 compiled native source checks, 40 native recency checks, 99 headed source/menu checks across five Spaces, 15 headed normal/private-window checks, and 154 recency/layout/hover checks pass. The source-race checks use controlled folder results plus a real native query of owned Downloads fixtures; native fixtures test actual media filtering without reading the user's Documents/Desktop folders. The prior candidate fails the unread-badge regression and the corrected candidate passes. An initial new-window failure was a fixture issue: the incomplete sample had never refreshed its target metadata. The corrected test verifies that the owned file exists before simulating completion. `source-query-validation.json` retains the final candidate hashes and validation limits. No production profile was instrumented. Final overlay reconstruction and installation remain pending.


Capture-store follow-up (draft): `ZenLibraryCaptures.sys.mjs` implements the observed CaptureData fields with independent PNG revisions, a persistent manifest, and change notifications. Updating a selection keeps its identity; a failed image or metadata write leaves the previous capture intact. Deletion commits before reclaiming images and journals cleanup for retry. The store supports creation-date selection of four recent captures without sorting the full collection, and a clear-store operation. Metadata and image bytes are copied before asynchronous work so later page changes cannot alter the saved capture. No capture UI calls this store yet.

Validation: 462 source tests pass, including nine capture-store tests using disposable files. The real browser adapter passes eight write/update checks and ten restore/delete checks after a process restart in an owned disposable profile. The first browser run exposed a cross-realm byte-array check; the correction has both browser and Node regression coverage. `capture-store-validation.json` records the exact source and signed-candidate hashes. This validates storage, not capture UI, capture-source visibility, private behavior, or exact Arc visuals. Arc's registered save default and complete UI lifecycle remain open; copying alone has not been wired to save.


Media source follow-up: the default grid now reads the direct children of Downloads, Desktop, Documents, and the configured macOS screenshot folder. A separately versioned native query shares the hover source scanner but retains up to fifty image/movie files, applies hidden-file exclusions before the bound, and merges those files with captures into a fifty-item chronology. Custom folder preferences remain supported. Open views refresh after folder preference changes and file hiding; stale query completions cannot replace newer results. Native type classification and cloud-placeholder metadata survive the adapter.

`media-source-reference.json` records the read-only query evidence and limits. Validation: 480 source tests, 334 native file checks, ten headed source checks, 39 Media integration checks, and 28 visual geometry checks across five Spaces. CUA inspection confirmed the candidate grid renders portrait/landscape/video/capture fixtures. The first hidden-file integration assertion used a temporary path alias rather than the file path returned to the UI; using the actual item path makes it exercise the production hide behavior and passes. Full Arc parity is not claimed. Deployment of this follow-up is pending; the previous 0126 source-preference/Media-visual update is installed.


Media query recovery (2026-10-31): a supported native query that fails or times out now reports failure instead of selecting the Gecko scanner, which could block on the same directory indefinitely. Only a missing native capability uses Gecko, with its own ten-second wait. Failed refreshes retain the previous files and intervening captures; the view shows “Couldn’t load media” with a working “Try Again” action. Replaced/disconnected scans discard stale callbacks and clear their timeout. An already blocked operating-system call cannot be cancelled by this UI change.

Validation: 487 source tests, 12 headed failure/recovery checks, ten native-source integration checks, and 28 existing visual checks across five Spaces. CUA inspected the error state and clicked Try Again, restoring real owned-folder thumbnails. `media-failures-validation.json` records candidate hashes and limitations. An initial headed check assumed switching Library tabs unmounted the Media section; the corrected test uses the actual Media off/on flow. The production Downloads/Documents access stall remains unresolved. This recovery change does not establish Arc visual/feature parity or browser-wide performance superiority.

Folder-query lifecycle follow-up: polling handles no longer determine the native worker bound. Identical pending folder requests share one read, including after all previous owners time out; at most 32 native jobs remain outstanding. Finished scans are discarded so the next query sees new files. Directory errors and timed-out/rejected requests now differ from a successful empty directory, allowing the widget to retain its last successful rows. This addresses retry accumulation and disappearing previews; it does not grant macOS folder access.

Validation: 489 source tests, 358 native lifecycle checks, 334 native source checks, and ten headed browser checks pass. The old installed library fails the new retry regression. The headed test uses actual owned files and injected failures, verifies recovery and the 56-point pitch, and was inspected with CUA. The candidate remains uninstalled pending the signing/folder-access work. See `query-lifecycle-headed.js`, `query-lifecycle-validation.json`, and `../native-theme-runtime/TestDownloadLifecycle.m`.

## Downloads Library presentation (2026-10-31)

The Downloads list now uses the measured ContentCell list geometry: 56pt rows,
12pt side padding, a 24pt accessory, 8pt spacing, 14pt regular lowercase titles
and 12pt subtitles. Completed rows show the ordered native UTType category
and source hostname instead of size and calendar date. Native Quick Look
provides document previews, with at most three Library requests active;
search/filter changes drop queued work and teardown cancels pending handles.
The separate footer preview retains its 40pt thumbnail request.

`library-presentation-validation.json` records read-only Arc reference sites,
owned fixture results, and the remaining differences. Run
`library-presentation-headed.js` only in a disposable profile whose path
contains `zen-region-colors-native-`, passing a folder with the owned
`Preview fixture.pdf` and `Preview fixture.png` inputs. It creates eight
fixture download records in that disposable profile and leaves the Library
open for visual inspection. No production data or permissions are changed.

Full Library chrome and physical hover parity are still
unverified/unfinished. The measured accessory frame does not establish Arc's
internal Quick Look request size, nor do CSS rounded corners establish a
pixel-identical match to SwiftUI continuous corners.

## Downloads Library date groups (2026-10-31)

Downloads now sort by creation time and share headings by the native relative
date label. Arc's calendar Today/Yesterday checks precede its full numeric
NSRelativeDateTimeFormatter; the original creation time is retained rather
than truncated to midnight. Missing dates use NSDate.distantPast. The optional
native grouping ABI uses the macOS calendar/time zone; older bundles retain a
local-calendar fallback whose relative-unit rounding is not identical on all
platforms. `library-dates-reference.json` records the read-only evidence.

Headings use 12pt semibold type, 12pt horizontal/8pt top/4pt bottom padding,
and the GrayA11 light/dark asset values. Searches and pagination keep only
nonempty groups. List ordering is cached until download data changes; native
labels are cached for the visible timestamps within a minute and refreshed on
reopening. The minute refresh stops when the section is hidden or closed.

Thumbnail refresh also recognizes a changed on-disk file size. Native results
that provide a file type without an image retain that type while allowing a
later image retry, instead of caching the missing image indefinitely.

`TestDownloadDateGroups.m` tests the native ABI in an owned process across five
time zones, day boundaries, daylight-saving changes, missing dates and buffer
limits. `library-dates-headed.js` exercises actual native labels, shuffled
insertion with identical completion dates, grouping, search, pagination,
changed timestamps, heading geometry and timer cancellation in a disposable
profile. These checks do not establish full Arc parity or native hover parity.

## Downloads search and profile filters (2026-10-31)

Downloads now exposes the reference Profiles filter instead of file-type and
rolling-date filters. It uses the same public contextual identities that Zen
already calls Space profiles, plus Default. Filtering uses each download’s
persisted source identity; records without an identity belong to Default.
Several selections form a union, and search intersects that selection. Profile
renames, additions, removals and reordering invalidate the cached options.
Names and option counts are browser data, not copied from Arc’s single-profile
installation.

The Downloads header has measured 8pt horizontal/10pt vertical insets, 36pt
controls, 14pt medium text, 15pt system symbols, and GrayA11 foregrounds.
Selected profiles appear below it with 13pt medium labels, 8pt padding and a
14pt removal symbol. The selected-state search placeholder is “Search…”.
Other Library sections retain their existing controls pending their reference
checks. `SearchSymbols.swift` reproduces the native resizable symbols in an
owned process; `library-search-reference.json` records the binary evidence.

`library-search-headed.js` exercises actual download serialization, profile
filter unions, query preservation, chip removal, default/legacy downloads,
profile rename/deletion and measured layout in all five Spaces. It requires
an owned disposable profile. 83 checks pass, alongside 36 date/grouping and
18 row-presentation regression checks. CUA inspection verifies the rendered
filter panel and selected chip. The transition follow-up below establishes the
native timing and layout. Native continuous corners,
alternate display scales, physical hover and full Library parity remain open; these checks do not establish complete Arc equivalence.


## Downloads empty state (2026-10-31)

Empty Downloads now centers the native 48pt arrow-down-circle symbol above
“Nothing here yet!” and the reference two-line message. An unsuccessful search
omits the title and displays the exact query, including surrounding spaces.
Query markup and entity sequences stay literal through DOM localization.
Other Library sections retain their previous query normalization.

The state uses measured 16pt symbol spacing, 8pt title/subtitle spacing,
17pt semibold title, and 14pt regular subtitle capped at 270pt. Its entrance
combines a 16pt upward spring with a separate 125ms opacity transition.
`EmptySpring.swift` samples the public native Spring with response .35 and
damping .6; CSS interpolates those samples. Reduced motion suppresses both.
The Downloads placeholder uses the native plain text field default color
(black or white at 63/255 alpha), established with `FieldReference.swift`.
That color is an inference from the matching native control, not a pixel
measurement of Arc's glyphs.

`library-empty-reference.json` records the observed behavior, read-only
reference addresses and limitations. `library-empty-headed.js` requires an
owned disposable profile and the absolute `empty-spring-samples.json` path.
It checks the real empty/history/search lifecycle, literal queries, all-five-
Space geometry/colors, spring interpolation, long query wrapping, profile
filtering and reopening. Native entrance frames, exact search latency,
continuous corners, other display scales and physical hover remain unverified.

Validation: 68 empty-state checks pass across five Spaces, alongside 497 source
tests, 83 search/filter, 36 date/grouping and 18 row-presentation checks. CUA
inspected both no-results and empty-history rendering. The candidate remains
uninstalled pending the earlier macOS signing decision.


## Downloads Library removal actions (2026-10-31)

Hide from Zen now shares the preview's download-only history removal and
hidden-file persistence. It retains the completed file and ordinary visits,
uses the original URL for redirected downloads, and suppresses the hidden
record's disk fallback without excluding independent Media membership.
Private records never persist hidden paths. Blocked downloads retain Firefox's
required cleanup before finalization.

Delete File still respects browser.download.clearHistoryOnDelete: mode 0
retains the record/history, mode 1 removes the live record, and mode 2 also
removes download visits. Mode 2 now preserves ordinary source-page visits.
File removal itself continues to use the existing Firefox helper.

`library-actions-headed.js` requires an owned disposable profile. It opens
real Library menus and exercises direct/redirected Hide, actual file removal,
ordinary/download visits, persisted download history, fallback suppression
and all three deletion preferences. The old candidate fails nine of its 50
checks; the updated candidate passes all 50. The shared preview's 14 normal/
private-window checks, 503 source tests and 29 archive tests also pass. CUA
opened the owned Library menu and verified Hide removes the selected row.

`library-actions-validation.json` records the exact candidate and limits. This
fix leaves visual assets unchanged; Arc's Library context-menu contents and
physical hover are still unverified. Production installation remains pending
the earlier macOS signing decision.


## Downloads restored from history (2026-10-31)

HistoryDownload has no live startTime. Its Places node can initially expose the
creation time, but after reopening it may expose a later ordinary page visit.
The Library now reads the latest DOWNLOAD visit for each history URL, so restored
records keep the creation-date headings and order established in
`library-dates-reference.json`. Completion metadata never substitutes for that
creation time. Live downloads retain their own startTime.

The lookup uses indexed, parameterized batches of up to 200 URLs, deduplicates
sources, and permits one read at a time per Library section. Weak caches avoid
repeated reads during search and thumbnail repaints. Reopening refreshes the
cache; invalidation and teardown discard stale results. Existing rows remain
visible while dates load, and a changed history node retains its last resolved
date during refresh. A failed read settles without a retry loop and retries
when the Library reopens.

`library-history-dates-headed.js` uses real persisted download visits, later
ordinary visits, redirected URLs, missing files and mixed live/history rows.
Run its `create` phase, restart the same owned profile, then run `restore`.
`history-date-batches-headed.js` checks 205 owned history URLs across the query
batch boundary and cleans them up. Both require a disposable profile whose
path contains `zen-region-colors-native-`.

Validation: 507 source tests, 44 history/restart checks, six checks covering
205 history records, 36 existing date/grouping checks, 50 Library action checks
and 29 archive tests pass. CUA inspected the final rendered headings after
restart. Full strict checks still stop at the existing Neovim const-assignment
error. `library-history-dates-validation.json` records the earlier failed
approach, final results and limits. Production installation, physical hover,
remaining Library visuals and browser-wide performance comparisons remain open.

## Downloads filter transitions (2026-10-31)

Opening and closing Profiles now uses the reference 300ms
`cubic-bezier(.25,.1,.25,1)` transaction. The whole search branch, including
selected chips, crossfades with the whole filter branch. Both keep their
natural geometry and fixed top inset while the outer height moves the results.
The old `display:none` height jump and independent 280ms header fade are gone.

`library-filter-transitions-reference.json` records the read-only Arc evidence
and its limits. `FilterTransitionReference.swift` renders an owned SwiftUI
conditional view with separate diagnostic colors. Its 43 samples establish
stationary branch tops and animated result displacement. Pixel channel values
are affected by color conversion, so `FilterOpacityCalibration.swift` also
renders static native opacities at the expected curve positions. Eight opening
and closing comparisons have zero channel error against that calibration.
Overlapping diagnostic colors also establish that the incoming branch paints
above the outgoing branch in both directions; two static stacking comparisons
have zero channel error. Keeping the filter above the search during closing
produces a different blend, so the active branch receives the higher layer.
These are independent native reconstructions, not production Arc frame captures.

Compile either Swift file with `xcrun swiftc -O`, then run the resulting program
with an output JSON path. The reference also accepts `overlap`; the
calibration accepts `filter-above` or `search-above` to reproduce the stacking
comparisons. `library-filter-transitions-headed.js` requires the
owned disposable browser profile. It pauses animations before sampling, waits
for localized labels before measuring wrapped chips, and checks all five Spaces,
current-position reversal, query/selection retention, reduced motion, profile
reflow, section switching, closing/reopening and inaccessible inactive branches.
`library-search-sections-headed.js` checks the unchanged History/Media/Boosts
layout, including Media's existing opt-in state; its enabled Media fixture has
no source folders to scan.

The three animations use browser-native timelines; there is no per-frame
JavaScript. Completion, interruption and teardown release their handles.
Profile or width reflow releases the obsolete animated height. Other Library
sections retain their previous motion. Search debounce remains unchanged until
its reference timing is established. Exact production frame equivalence,
physical hover, remaining Library chrome and browser-wide speed claims are
still outside this validation.
