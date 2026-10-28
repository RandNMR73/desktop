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

`ZenWindowCapture` provides an on-demand viewport snapshot for the future
Capture Window preview. It is not wired to a user-facing command yet. The
portrait compositor, background choices and watermark remain outstanding;
`capture-validation.json` records that limitation explicitly.

The service locks the snapshot to the selected tab/document, rejects stale
results after navigation, tab/Space changes or resize, and releases pixels on
close/teardown. Its HTTP(S) child actor only answers a geometry query: no page
listeners, DOM mutations, overlay or polling. Preview and copy share one PNG
encoding. Viewports exceeding 32 megapixels or a 16,384-pixel edge fail before
snapshot allocation, without silently cropping the page.

With the isolated profile and local capture fixture, run
`capture-runtime-smoke.js` using the same async chrome-context harness. It
checks all five Spaces and pending-capture/clipboard races. Setting
`w.captureEvidenceDir` to a private existing directory saves synthetic viewport
PNGs and a JSON report; the service itself never writes files. A real clipboard
copy was also opened and visually inspected in macOS Preview. Neither this
check nor the source tests establish portrait UI or full-browser parity.
