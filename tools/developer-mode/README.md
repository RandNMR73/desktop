# Developer Mode prototype

This feature remains opt-in with `zen.developer-mode.enabled` (default false).
It is not a complete Arc implementation. See `validation.json` for tested
behavior and the remaining gaps; do not treat the prototype as a parity pass.

## Extension regression

Use a disposable profile and the candidate browser. Install `fixtures/popup`
and `fixtures/action` as temporary add-ons with `AddonManager.installTemporaryAddon`.
These self-authored fixtures use only `activeTab`, have no remote resources,
and must not be installed in a personal profile. Run a local fixture server
on `127.0.0.1:62979` that returns a simple HTML document for arbitrary paths.

Set `zen.developer-mode.fixture-tests` to true only in that profile, then run
`extensions-runtime-smoke.js` as an async chrome-context function body with
`w` bound to the test browser window. The Astralforge browser harness's `run`
helper supports this form. Seed the test profile with five Spaces first.

The regression creates and removes its own tabs, restores the original Space,
tab and extension placements, and closes its private window. It checks real
extension actions, tab-specific state, all five Spaces, stale popup requests,
private access filtering and unchanged-refresh DOM mutations. Separate native
UI tests are required for pointer/keyboard operation and appearance; programmatic
clicks and these checks do not certify hover or visual parity. Temporary add-ons
are removed when the test browser exits.

Source unit checks: `node --test scripts/tests/*.test.mjs`.

## Page capture foundation

`ZenWindowCapture` provides the document-bound snapshot consumed by the opt-in
Capture Window preview. The historical backend checks remain in
`capture-validation.json`; current portrait checks are in
`portrait-validation.json`. Neither report is a complete parity certificate.

The service locks the snapshot to the selected tab/document, rejects stale
results after navigation, tab/Space changes or resize, and releases pixels on
close/teardown. Its HTTP(S) child actor only answers a geometry query: no page
listeners, DOM mutations, overlay or polling. Preview and copy share one PNG
encoding. Captures exceeding 32 megapixels or a 16,384-pixel edge fail before
snapshot allocation, without silently cropping the page.

With the isolated profile and local capture fixture, run
`capture-runtime-smoke.js` using the same async chrome-context harness. It
checks all five Spaces and pending-capture/clipboard races. Setting
`w.captureEvidenceDir` to a private existing directory saves synthetic viewport
PNGs and a JSON report; the service itself never writes files. A real clipboard
copy was also opened and visually inspected in macOS Preview. Neither this
check nor the source tests establish portrait UI or full-browser parity.

## Site control capture actions

The site control header now follows the observed Arc action order: Share, New
Boost, Capture a portion of this page, Capture the full page. Bookmark and Reader
View remain available through their ordinary browser commands. The Boost action
moves out of the footer. Full-page capture copies directly without opening a
portrait preview. Portion capture uses Gecko's selection overlay; Escape from
its nested shadow-root controls now cancels correctly. Header order is no longer
reversed when the sidebar is on the left.

The full-page geometry query preserves negative RTL origins, excludes scrollbar
gutters, and reads document extents without rounding viewport and scroll ranges
separately. Zoom changes invalidate pending work. The header action releases its
canvas, listeners and encoded PNG after copying. There is no page mutation,
automatic capture, or file write in this service.

`site-control-validation.json` records fifteen real-engine capture checks across
five Spaces: normal, horizontally overflowing RTL, and 125% zoom. All four corner
colors, full document dimensions and clipboard writes passed. Native CUA also
opened the actual header, activated full-page capture, verified the resulting PNG
dimensions, and tested portion capture and Escape after a fresh launch.

A further runtime pass opened the real site panel in each of five Spaces on a
loopback web page and on `about:blank`. All ten states retained four visible
actions in left-to-right order and the expected capture availability. The
browser tests now cover these controls instead of the removed Bookmark/Reader
header buttons. The full Mochitest suite has not run on a rebuilt engine.

Native full-page captures in Arc and the candidate at scroll position 600 preserve
the current fixed and sticky element positions without scrolling the page. Both
exports are 2944×4800 pixels. Run `site-control-fixture.py`, set
`w.siteCaptureFixtureBase` to its printed loopback address, and run
`scrolled-capture-runtime-smoke.js` in the disposable harness to repeat the Zen
regression. All fifteen cases (five Spaces at scroll positions 0, 600 and 1200)
preserved scrolling, full height, and the fixed/sticky/bottom marker positions.
The all-Space extension is a runtime test; native Arc reference clicks covered
the 600-pixel position in Main Space only.

Color comparisons must preserve Arc's native image profile. A PNG read back
through Gecko's clipboard conversion lost that profile, producing misleading
raw RGB differences. The native Arc image saved through Preview retains its
display profile; converting that reference to sRGB matches the sampled red,
blue and background colors in Zen. Green remains (6, 180, 1) versus (0, 180, 0),
and edge antialiasing differs. The exports are not pixel-identical.

This is still a draft, not installed in the production app. A separate native Arc
comparison exposed incorrect repeating-gradient painting in Gecko's software
snapshot path, despite correct live page rendering. The same defect reproduced
through Gecko's built-in tiled capture helper. A separate
[engine correction](https://github.com/RandNMR73/desktop/pull/65) now normalizes
interpolated color stops; it still needs compilation and post-fix rendering
validation. Exact popup materials and icon
artwork, Option-click portrait behavior, and full-page pixel parity remain
unverified or incomplete. Do not interpret
successful geometry tests as a rendering parity pass.

## Portrait capture prototype

The Developer Mode toolbar now opens a preview with a color slider and watermark
toggle. Return copies the composition and leaves the preview available, as does
the capture button; Escape or outside dismissal cancels it. Unchanged repeat
copies reuse the encoded PNG. Editing either control invalidates that encoding.
Option-click invokes the same capture with saved defaults without opening the
preview. The direct quick-capture method is tested; physical Option-click has not
been exercised through CUA. The watermark identifies Zen.

The preview is 140×96 CSS pixels with a 280-pixel-wide backing canvas. Editing
coalesces within an animation frame; full export is performed only on acceptance,
in a one-job module worker. Closing, navigating or changing Spaces terminates
that job. Disabling or removing its owning Developer Mode toolbar also cancels
pending snapshots and visible previews, without cancelling a different pane's
capture. The Space manager callback invalidates shared favorites even when the
selected tab does not change, and returning to the original Space cannot revive
an old preview. Output is bounded to 32 megapixels and 16,384 pixels per edge.

Run `portrait-runtime-smoke.js` in the same isolated setup. It visits all five
Spaces, changes both controls, checks preview dimensions, copies the result in
every Space, verifies retained previews and focus, checks reuse and invalidation
of the encoding, and exercises stale selection/closure and a shared-favorite
Space roundtrip. It restores its tabs and preferences. Run
`portrait-lifecycle-smoke.js` to disable the owning toolbar during preview and
PNG decoding in every Space, recreate it, and check cached-copy cancellation
and quick-capture cleanup. Separate native checks covered mouse/keyboard controls
and a real PNG pasted into Preview. Private-window changes did not persist
preferences. Current results are in `portrait-preview-validation.json`.

Two Arc exports establish the current reference proportions at a 1472 CSS-pixel
viewport width. Other window sizes, split panes, zoom, full-page output, exact
popover visuals/icons, website tint, desktop wallpaper and the complete palette
remain unverified or missing. The custom palette gradient away from its default
is provisional. CUA omits separate popup windows from screenshots, so accessibility
inspection is not a visual sign-off. No broad performance superiority is claimed.

Profiling found ~0.84 seconds of synchronous full-image composition in the first
implementation. Rendering/encoding now runs off the browser's main thread. The
optional macOS bundle also accepts the encoded PNG directly, avoiding Gecko's
redundant synchronous image decode and PNG/TIFF conversion. Older bundles and
other platforms keep Gecko's clipboard path. Native write errors propagate without
a second write, and ownership is checked again after backend discovery.

The same 5088×3506 PNG took 495–570 ms through Gecko and 1.5–46 ms through the new
path in three alternating observations per backend. The 16 ms timer probe observed
maximum intervals of 589 ms and 66 ms respectively. A complete quick capture on
the synthetic page took 538 ms with a maximum 30 ms timer interval in one run.
These are local observations, not an overall browser or Arc performance benchmark.
See `image-clipboard-validation.json` for raw measurements and limitations.

To repeat the clipboard comparison, set `w.captureBenchmarkPNG` to a synthetic
PNG in the disposable profile harness, then run `image-clipboard-benchmark.js`.
It writes the system clipboard. Keep the candidate in the foreground and use
identical input, window and load conditions. The native writer is compiled into
the optional bundle; see `../native-theme-runtime/README.md` for its isolated
pasteboard checks. Native pastes into both Zen and Arc preserved the PNG checksum,
including after priming Gecko's image cache with a different image.

An older installed native bundle was tested in a separate cold start: the missing
clipboard ABI fell back to Gecko, and native paste preserved dimensions and the
sampled color. Gecko re-encoded the image as expected. No production app was changed.

## Combined site settings validation

The candidate now combines automatic Picture-in-Picture with Developer Mode and
capture actions. With ten temporary extension actions and Add Extensions, its
site panel measures 236×377 CSS pixels in all five Spaces. Header tiles are
48×32 with 8-pixel gaps; both settings rows contain 32-pixel circles and have a
43-pixel pitch. Labels use 14-pixel text. The additional-actions circle is 32×32.
These measurements come from the supplied 2× Arc screenshot, not from an
assertion that the popup material or every Space's text color is identical.

Tracking Protection is available as a checkbox in the additional-actions menu
instead of an extra main settings row. Its real engine handlers are unchanged.
Opening either way refreshes its state; commands retained across navigation are
rejected. Developer Mode now rejects the same stale-document case and localizes
its labels. The runtime test stubs the protection-changing handlers when checking
command dispatch; it never disables protection on the test page.

`site-control-settings-smoke.js` checks the live layout and both toggles across
five Spaces, then navigates and tries retained controls to verify they cannot
change a different document. `site-control-settings-validation.json` records the
result, repeat automatic PiP tests, native button clicks and Library regression
check. The combined source suite passes 289 tests. Package generation must expand
CSS `%include` directives: copying the source stylesheet directly would drop the
Library widget and media preview rules. The tested overlay preserves these.

The combined candidate is still not installed. Native popup translucency, exact
hover/Option-click behavior, and capture rendering gaps listed above remain open.
