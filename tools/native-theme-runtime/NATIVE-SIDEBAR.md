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

Updates coalesce into animation frames. Native readiness waits at most two
seconds, then restores the original sidebar on failure. A completed render does
not poll. Unsupported layouts, pinned mode, unexpected popup closure and
teardown restore the original controls. The first move waits for a running
reveal animation or an already-open editor to finish.

## Reference settings

Read-only inspection of Arc's `FloatingSidebarBackgroundView` found:

- `0x100391dc0`: within-window blending, emphasized, material raw value 6
  (`NSVisualEffectMaterialPopover`, not Sidebar).
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

The source uses those settings and inherits appearance. AppKit can restore
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

Thirteen controller tests cover original-control identity, late loading,
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

These checks do not establish full visual parity. Automatic hover timing,
the reference's complete floating geometry, effective appearance, composed
theme-field appearance, drag behavior and screen-reader interaction need verification
before enabling the controller. Arc also has a separate behind-window material
branch whose state transitions are not yet integrated. The generated theme
grain remains approximate.


CUA captures can omit the separate popup windows, so a main-window screenshot
alone cannot establish composed visual parity. Coordinate clicks also update
`:hover` without delivering mouseover/mouseleave in the observed test session;
those clicks do not verify hover-entry or hover-exit timing. The controller stays
opt-in until those interaction and visual comparisons are complete.
