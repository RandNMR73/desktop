# Shared favorite continuity

When a selected favorite is visible in the destination Space, changing Spaces
now keeps that tab selected. The previous behavior chose the destination's
remembered tab or empty page, despite the favorite remaining in the sidebar.
Native Arc clicks retained the same favorite through all five Spaces; installed
Zen dropped it on three of the six reference transitions.

Explicit tab requests take precedence, including cross-Space tab selection,
new tabs marked to change Space, Move to Space, and the existing tab-switch
helper. Container-specific favorites retain their existing visibility rules.
Startup restoration and ordinary tabs still use the remembered destination tab.

Run `node --test scripts/tests/shared-favorite-space.test.mjs` for selection,
container, closing-tab, initialization and explicit-target cases. The registered
browser test is `zen/tests/spaces/browser_shared_favorite_switch.js`; it has not
run through the full Mochitest build harness yet.

For the real-engine regression, use a disposable profile with five Spaces and
room for one additional favorite. Set `zen.developer-mode.fixture-tests=true`
in that profile and run `runtime-smoke.js` as an async chrome-context body with
`w` bound to the test window. It creates only local data-URL pages, verifies all
five Spaces without intermediate TabSelect events or document reloads, checks
explicit cross-Space selections, and restores its tabs and remembered state.
Set `w.spaceContinuityEvidenceDir` to a private existing directory to save JSON.
Optional `w.spaceContinuityKeepFixture=true` retains the fixture for native input
checks; call `await w.spaceContinuityFixture.cleanup()` afterward and clear the
fixture preference. Do not run this in a personal profile.

Native candidate clicks through all five Spaces retained both the fixture page
and its clicked counter. These results establish favorite continuity, not exact
Space colors, every-frame transition fidelity, or general speed superiority.
The runtime timings include different animation states and are not a benchmark.
Rapid tab commands during an unfinished animation remain a separate follow-up.
