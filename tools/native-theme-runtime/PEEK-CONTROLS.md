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

Offscreen SwiftUI circles compared with Gecko at 2x resolution show that CSS
blur radius 8/12 is much closer to native radius 4/6 than CSS radius 4/6. CSS
`drop-shadow` is slightly less accurate than `box-shadow`. The selected box
shadow still differs outside the circle by up to 3/255 at idle and 6/255 on
hover. Exact shadow rasterization and live frame presentation remain open.
