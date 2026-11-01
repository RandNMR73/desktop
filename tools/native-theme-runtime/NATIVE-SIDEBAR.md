# Floating sidebar surface (not enabled by default)

The optional `zen_sidebar_surface_version()` capability returns 1. The
`createNativeSidebarSurface(window)` adapter exposes apply, status, activate,
clear and destroy operations for the window's validated native Space. A caller
cannot supply a theme index or native window handle. Unsupported bundles keep
the existing CSS rendering.

`apply` takes six CSS-pixel values: x, y, width, height, viewport width and
viewport height, followed by a nonzero uint32 request ticket. The native ABI
also receives the owning main theme's ticket. It rejects stale themes,
unknown windows, unsupported host hierarchies, nonfinite or excessive geometry,
inconsistent viewport scaling and accessibility fallbacks. Readiness and
activation require both tickets to match. Clearing the main theme also removes
the sidebar surface. Completed identical geometry/theme requests adopt a new
ticket without submitting another Metal frame.

The decorative surface lives inside Gecko's `ChildView`, above its pixel host;
Gecko remains the final child of the main content view. It has neither hit
testing nor accessibility children. Interactive controls require a transparent
Gecko popup above it, with the original navbar in its own popup when expanded.
The `ZenNativeSidebar` controller integrates that host with compact mode when
`zen.native-sidebar.enabled` is explicitly set to true on macOS. The preference
defaults to false; this is not enabled in production. Unsupported native bundles
retain the existing CSS sidebar.

The controller follows compact mode's existing hover, explicit-show, empty-tab,
popup, drag and rename states. It moves the original toolbox with the guarded
URL bar move API. An inert placeholder shares the existing compact-mode geometry
rules, so resize measurements never detach the live editor. The native surface
uses the placeholder's titlebar bounds and the transparent popup retains the
original controls and their padding. The toolbox cannot shrink to the popup's
narrower background width.

In a normal window the floating frame is inset five points from the top, bottom
and outer edge. Its width remains the effective sidebar width. The opt-in
controller sets the shared compact spacing to ten CSS pixels, which the layout
halves for those insets. Resize calculations exclude the actual floating
padding, use logical sidebar widths for limits, and commit a queued final
pointer move before release. They do not overwrite that width with a native
popup frame that may still describe the previous placement. Double-click reset
updates the visible and persisted width together.

Updates coalesce into animation frames. Native readiness waits at most two
seconds, then restores the original sidebar on failure. A completed render does
not poll. Unsupported layouts, pinned mode, unexpected popup closure and
teardown restore the original controls. The first move waits for a running
reveal animation or an already-open editor to finish.

## Optional floating-to-pinned transition primitive

`zen_sidebar_transition_version()` returns 1. The optional `startTransition`
adapter method accepts the target rectangle and the existing visible surface's
ticket. Native start also validates the main theme ticket and rejects Reduce
Motion or fullscreen. `transitionStatus` returns -1 for unavailable/stale work,
0 while animation or rendering is pending, and 1 after both finish. Older
libraries retain their existing surface support without this capability.

An 80 ms AppKit transaction uses the traced cubic bezier
`(.25, .46, .45, .94)`, moves the surface frame and crossfades the within-window
Popover/shadow against an emphasized behind-window material. The latter uses
the main theme's validated material. During frame movement, renderer layout
recalculates window-relative texture coordinates; using the destination
coordinates from the start shifted the gradient and grain in an earlier
candidate. The final material remains until the host restores or clears it.

Cancellation invalidates the generation before replacing the NSView frame
animation with a zero-duration transaction and removing layer animations.
Removing CALayer animations alone did not stop AppKit's frame updates. Reapply
restores the normal floating layers; changing the main theme or clearing the
window cancels the old surface. No asynchronous ctypes callback enters Gecko.

The opt-in controller invokes this primitive when a ready, visible floating
sidebar is pinned in a normal window. Before removing explicit-show state,
`ZenCompactMode` offers it the synchronous pinned-layout commit. The controller
keeps the original controls in their popup, measures their old and new positions,
and animates the top buttons, address bar, tabs and footer without scaling their
icons or text. The footer compensates for its moving parent. A temporary flex
spacer animates the webpage's actual layout reservation. Both DOM and native
animations use 80 ms and the traced curve; DOM start times are explicitly set
at native submission to avoid a stale refresh tick starting them early.

The controls return to the original browser parent only after DOM animation
and native rendering complete, or after a bounded failure/cancellation. Space,
viewport or layout changes, unexpected popup closure and destruction cancel the
transition and restore one pinned toolbox. Toolbar reconstruction temporarily
preserves the sidebar's own popup. Open editors or other popups, reduced motion,
fullscreen, tab dragging and unavailable capabilities retain the existing
immediate path. While an editor is open, toolbar reconstruction moves its
return anchor instead of the live navbar. The popup keeps the same input,
selection and Undo transaction; closing restores the navbar at the new position.
This remains opt-in; composed transition parity is unproved.

## Reference settings

Read-only inspection of Arc's `FloatingSidebarBackgroundView` found:

- `0x100391dc0`: within-window blending, emphasized, material raw value 6
  (`NSVisualEffectMaterialPopover`, not Sidebar).
- `0x100219424`: normal floating presentation gives `(minX + 5, minY + 5,
  effectiveSidebarWidth, height - 10)`, then backing-aligns the rectangle.
  `0x100218a18` consumes that first result rectangle and sets the floating
  container frame at `0x100218b28`. Home/fullscreen layout transforms remain
  separate and are not covered by this normal-window result.
- `0x1003a3878`: radius 12 points on macOS 26+, otherwise 8.
- `0x100a1a4a4`: a stretched rounded NSBezierPath mask, 2r+1 points square,
  with r-point cap insets.
- `0x100391cd0`: `CellDropShadow`, independent-axis scaling, alpha 0.2.
  The view initializer positions it ten points beyond each edge.
- `0x1003925f0`: an unclipped layer and a one-point SidebarBorderColor border.
  That named color is white at 30% alpha in both appearances.
- The initializer calls `0x101539c74(1)` (contentFillMode) and
  `0x101539aa8(false)` (canDisplayTranslucency). The experimental renderer's
  protocol witnesses are `0x1015416dc` and `0x1015414d0` respectively. The latter
  hides its extra translucency view; the separate Popover material remains.
- `0x101541fc8`, mode 1: convert the background bounds to the window content
  view, flip y with `0x100a1155c`, then normalize min/max x/y by the content
  width/height. This is a crop of the whole window theme, not a new gradient
  stretched across the sidebar. Mode 0 uses `(0,0,1,1)`; the other mode also
  accounts for a parent window and is not used by the floating initializer.
- `0x10152f490`: divide drawable dimensions by the normalized region's span
  before deriving gradient aspect and grain repeats. `0x10152f838` passes the
  region to the final vertex stage. The grain therefore shares the window
  origin and pixel scale.
- `WindowViewController.viewDidLoad` (`0x1002f2350`) adds the main background
  at `0x1002f2434` and floating background at `0x1002f2844` to the same parent
  view. The floating initializer does not override appearance. Its appearance
  therefore follows the window, independently of the sidebar controls' own
  appearance bindings. `MainWindowController.init` copies `NSApp.appearance`
  onto the window at `0x10031afc8`.

The source uses those settings and the validated theme bundle's appearance.
Gecko's `ChildView` can supply VibrantLight even when the imported theme and
browser chrome preference are dark. Only the decorative floating surface gets
an explicit Aqua/DarkAqua override; the window, controls and webpage retain
their existing appearances. Missing or unsupported appearance metadata leaves
the main renderer available but disables the optional floating surface.

AppKit can restore
default clipping during layout: the root opts out of default clipping and
reasserts its unclipped layer during updates. The blur and theme renderer keep
their own rounded masks. CSS scaling applies to the radius, border and outsets.

The sidebar uses the optional `themeRegionVertex` pipeline, preserving the
original shader entry point and fragment parameters for the main window and
older bundles. Missing region support falls back only the floating surface.
Viewport changes invalidate the normalized coordinates even if the sidebar's
own size stays unchanged. Completed identical requests still avoid a redraw.

## Validation scope

Node tests exercise the adapter's initial readiness, changed Space ownership,
stale requests, malformed inputs, unsupported bundles, window closure and
idempotent destruction. The native ABI checks use a disposable profile
with a fixed-size test popup. They check five-Space changes, current-ticket
activation, repeated-request draw counts, CSS-to-AppKit scaling, geometry
rejection, teardown, actual material values and shadow clipping after layout.

Eighteen controller tests cover original-control identity, late loading,
current-ticket readiness, coalesced resize, unavailable native bundles, bounded
failure, teardown, existing show-state policy and deferred editor/animation
handoff. Packaged controller checks additionally exercise all five Space
selections, actual native render idleness, measured toolbox/background geometry,
real search editing and Undo across window resize, Create-menu popup tracking,
compact-to-pinned transitions and unexpected-close recovery. Native accessibility
inspection finds the original sidebar buttons, tabs and search controls in the
popup's accessibility tree. Screen-reader interaction remains unverified.

`TestThemeRegion.m` renders offscreen with the built Metal pipelines. It compares
floating-region pixels against the corresponding whole-window pixels across
landscape/portrait windows, unchanged sidebar bounds after a width change, and
an offset region. The test includes every bundled theme, grain and extended RGB
channels; it also confirms the prior local-gradient path fails the comparison.
Build and run it with:

```sh
xcrun clang -fobjc-arc -Wall -Wextra -Werror -framework Foundation \
  -framework Metal tools/native-theme-runtime/TestThemeRegion.m -o /tmp/TestThemeRegion
/tmp/TestThemeRegion /absolute/path/to/native-theme-bundle
```

The six-resource bundle passed 24 comparisons with a maximum channel error of
0.000244141 in float RGBA; the prior local-gradient path reached 0.307617188.
The packaged browser additionally passed five-Space changes, an unchanged
sidebar rectangle during a width-only window resize, idle-frame checks and
cleanup. See [sidebar-region-validation.json](sidebar-region-validation.json).

`TestThemeAppearance.m` loads the built native library and checks dark, light,
missing and unsupported metadata, including a parent with the opposite vibrant
appearance. It creates no window. Build and run it with:

```sh
xcrun clang -fobjc-arc -Wall -Wextra -Werror -framework AppKit \
  tools/native-theme-runtime/TestThemeAppearance.m -o /tmp/TestThemeAppearance
/tmp/TestThemeAppearance /absolute/path/to/native-theme-bundle
```

The packaged dark-theme candidate reported DarkAqua on the surface and
VibrantDark on the Popover material across all five Spaces. Its window remained
Aqua and its Gecko chrome remained VibrantLight. Each completed Space change
stayed idle. Before/after captures show the correction affects the floating
background while sampled page and top-border pixels remain identical. This is
a regression comparison, not an Arc pixel comparison. After raising the main
window, native ordering kept the controls popup above its parent and real
coordinate clicks still changed Spaces, although captures omitted that popup.
See [sidebar-appearance-validation.json](sidebar-appearance-validation.json).

The geometry correction passed 651 source tests, including ten resize cases.
The packaged candidate passed real pointer drags in pinned, floating-left and
floating-right layouts, reverse dragging without width drift, and double-click
reset. All five Spaces retained matching control/background bounds and idle
native rendering. Real window width and height changes preserved the five-point
insets; a draft, caret and original editor survived a width-only window resize,
and real keyboard Undo restored the address. See
[sidebar-geometry-validation.json](sidebar-geometry-validation.json) for the
binary reference, measurements, candidate versions and remaining limits.

These checks do not establish full visual parity. Automatic hover timing,
home/fullscreen geometry, complete control placement, composed
theme-field appearance, tab dragging and screen-reader interaction need verification
before enabling the controller. Arc also has a separate behind-window material
branch used during the floating-to-locked transition: an 80 ms animation fades
the within-window material and shadow out while fading the behind-window
material in, then restores the normal floating layers after completion. The
controller now coordinates the original controls and page layout with that
primitive. The binary trace and its remaining limits are in [sidebar-transition-reference.json](sidebar-transition-reference.json).
The native primitive passed live opacity-curve, moving-coordinate, completion
and cancellation probes across all five Spaces, plus 55 surface checks and a
Space-change cancellation. The source suite passed 654 tests; the rebuilt
bundle passed 24 GPU region comparisons and four appearance cases. Recorded
opacity animations have duration 80 ms; the first completed status was sampled
about 96–102 ms after the request. This is not an end-to-end Arc timing result.
See [sidebar-transition-validation.json](sidebar-transition-validation.json).
Controller integration measurements and remaining timing limits are recorded in
[sidebar-pin-validation.json](sidebar-pin-validation.json). The generated theme
grain remains approximate.


CUA captures can omit the separate popup windows, so a main-window screenshot
alone cannot establish composed visual parity. Coordinate clicks also update
`:hover` without delivering mouseover/mouseleave in the observed test session;
those clicks do not verify hover-entry or hover-exit timing. The controller stays
opt-in until those interaction and visual comparisons are complete.
