# Peek control material and motion

Arc 1.172.1's `ModalButtonStyle.ButtonView` chooses `backgroundExtra` for its
button fill and `foregroundPrimary` for its symbol. The light appearance
reduces HSL lightness by `max(relativeLuminance - 0.4, 0)`; the dark appearance
leaves the foreground unchanged. The calculation preserves alpha and extended
sRGB components. The light/dark choice follows window appearance independently
of the sidebar's text-contrast choice. Colors come from the semantic Space
palette, including a custom primary color, rather than named Space overrides.

Read-only native references: the foreground branch begins at `0x10171b9d4`,
background construction at `0x10171c140`, relative-luminance calculation at
`0x1009afae4`, HSL adjustment at `0x1009ae428`, and vertical offset helper at
`0x100b0809c`. The native field order is recorded by Swift metadata, including
`backgroundExtra` at palette offset `+0xb0`.

Idle controls have black 20% shadows with radius 4 and offset (0, 1). Hover
retains the fill and symbol color, lifts the control one point, and changes the
shadow to 30% with radius 6. Press scales the control to 0.95 and returns its
shadow radius to 4. Hover uses response 0.15/damping 0.95; press uses response
0.28/damping 0.63, both with zero blend duration. Reversals retain momentum.
Changing spring parameters must advance the old spring before merging the new
parameters. The rail owns one frame loop, which stops after settling and is
reset on hiding, disabling, cancellation or window blur and destroyed on close
or expansion. Reduced motion snaps to the target without a frame loop.

`PeekControlSpringReference.swift` and
`PeekControlParameterSpringReference.swift` generate independent offscreen
SwiftUI samples, including reversals and changes between hover/press dynamics.
The generator stops sampling after `animate` returns nil: Apple defines that
return as finished. Continuing to call an underdamped spring after completion
can produce numerical values that SwiftUI would never present.

Validation so far: 95 source checks pass, including 1,269 native spring sample
rows at 1e-10 absolute tolerance. Existing browser coverage passes 361 Peek
checks. Separate headless integration checks exercise palette changes, trusted
Gecko pointer input, both sidebar states, and controller cleanup across all five
Spaces. This is not a claim of physical-input or full pixel parity.

The shadow reference must use `Capsule(style: .continuous)`, including the
34-point square controls. Read-only binding inspection resolves the corner
style loaded at `0x10171c078` from `0x10423aa00` to
`SwiftUI.RoundedCornerStyle.continuous`. Native path extraction confirms that
this shape differs from both `Circle` and a circular capsule at the same size.
The close-confirmation control widens the same capsule rather than using a
separate circular geometry.

The initial shadow study incorrectly used `Circle`. Its measured 3/255 idle
and 6/255 hover differences, and the later radial-gradient fit, are superseded
as parity evidence. The radial fit passed against that circle reference but
failed against the correct continuous capsule; it has not been installed.
Against the corrected 34-point reference, the installed rounded box shadow
has exterior maximum errors of 3/255 idle and 4/255 hover at 1x, and 2/255 idle
and 3/255 hover at 2x. These numbers exclude the antialiased shape boundary.

`PeekControlShadowReference.swift` generates independent continuous-capsule
references at widths 34, 70 and 110, both 1x and 2x, for idle, hover, press,
intermediate radius/opacity values and slight spring overshoot. Shadow and
shape matching remain experimental. Exact pixels and live frame presentation
are not yet certified.

A native paint prototype now draws the same continuous capsule through SwiftUI.
`ZenNativePeekControls.swift` accepts bounded, per-owner geometry and palette
values, renders SF Symbols, and leaves hit testing and accessibility with Gecko.
It has no event callback or independent frame loop. Stale owner cleanup cannot
remove a newer rail. This prototype is not yet connected to the browser.

The hidden-window host suite passes 58 checks covering clipping, flipped and
scaled coordinates, owner replacement, invalid requests, host limits and click
passthrough. The renderer's entire material and shadow image differs from the
independent reference by at most 1/255 across 48 cases (three widths, eight
shadow states, two densities). Regenerating the reference itself also varies
by up to 1/255, so these results do not claim bit-for-bit identity. The test
excludes the SF Symbols and live compositor/input timing. Browser integration,
visibility/occlusion handling and native UI review remain required before use.
