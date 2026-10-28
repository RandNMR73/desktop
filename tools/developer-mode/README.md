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
