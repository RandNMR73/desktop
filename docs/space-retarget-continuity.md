# Continuous retargeting of Space transitions

Rapidly selecting another Space during an animation previously completed the
obsolete model change before starting the new animation. Layout cleanup parked
the sidebar at that obsolete destination even though its last animation frame
had been suppressed. The next color blend could also start from complementary
progress instead of the visible position.

The transition now retains its presented page coordinate and sampled velocity.
Obsolete queued requests finish their model work without rewriting this visual
state. The latest request continues the spring from that state. All visible
Space strips, native window/sidebar colors, CSS fallback colors, and
profile-specific Favorites derive from the same continuous circular coordinate.
The creation page is excluded from Favorite ownership. Invalid destinations,
exceptions, and Reduced Motion clear the held presentation.

## Validation — 2026-11-06

- Full source suite: **1,148 passing tests**, including circular page boundaries,
  retarget destinations, and initial position/velocity under the production
  spring integrator.
- Native-window matrix: **20 cases**, all five origins, reversal and continuing
  to a third Space, pinned and floating sidebar. The first retargeted frame has
  **zero position jump** in each case. Maximum normalized difference between
  strip position and native color progress is below **5.72e-7**. Both native
  surfaces retain alpha 1, settle at the selected Space, and clear blending.
- Baseline reproduced jumps of **81.96–184.73 percentage points** in four
  equivalent interrupted switches.
- Separate profile Favorite groups: **12 cases, 1,245 checks**, covering outgoing
  and incoming group visibility/positions across three origins and both sidebar
  modes. No errors.
- Duplicate requests, three queued requests, invalid destinations, and enabling
  Reduced Motion mid-transition: **eight cases** settle and recover on the next
  switch. Existing partial-drag/Reduced Motion checks also pass in both modes.
- Interrupting a switch by opening the actual new-Space form: six visible moving
  frames keep Favorites aligned to the outgoing Space; all Favorites are hidden
  when the creation page settles.

These tests use a disposable local profile. The 20-case and 12-case matrices ran
before the final two-line creation-page exclusion; the final package passed the
creation test and full source suite. That exclusion only affects the new-Space
form, which those two matrices do not open.

The change fixes a reproduced Zen discontinuity. It does **not** establish exact
Arc timing, physical-trackpad equivalence, or an overall performance advantage.
Mid-flight workspace reordering/removal beyond invalid-request cleanup has not
been exhaustively exercised.

## Reproduction

Use an owned disposable profile with five distinct Space themes. Start a 0→1
switch, then request 0 or 2 while the first spring is 15–70% complete. Capture
workspace transforms and native theme IDs/progress on animation frames. Repeat
from every origin with the sidebar pinned and floating. At handoff, the visible
origin transform must remain unchanged; afterward, adjacent page positions and
native blend progress must agree. Repeat with Favorites assigned to different
profile containers, queued/duplicate targets, Reduced Motion, and new-Space
creation. Do not use a normal browsing profile for this fixture.
