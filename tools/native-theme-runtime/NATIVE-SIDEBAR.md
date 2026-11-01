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
That automatic sidebar controller is not integrated yet. The native ABI alone
does not change a user's sidebar or introduce any polling.

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

The source uses those settings and inherits appearance. AppKit can restore
default clipping during layout: the root opts out of default clipping and
reasserts its unclipped layer during updates. The blur and theme renderer keep
their own rounded masks. CSS scaling applies to the radius, border and outsets.

## Validation scope

Node tests exercise the adapter's initial readiness, changed Space ownership,
stale requests, malformed inputs, unsupported bundles, window closure and
idempotent destruction. The packaged native checks use a disposable profile
with a fixed-size test popup. They check five-Space changes, current-ticket
activation, repeated-request draw counts, CSS-to-AppKit scaling, geometry
rejection, teardown, actual material values and shadow clipping after layout.

These checks do not establish full visual parity. Automatic hover/show/hide,
the reference's complete floating geometry, effective appearance, theme-field
coordinates, drag behavior and interactive accessibility need verification
before enabling the controller. Arc also has a separate behind-window material
branch whose state transitions are not yet integrated. The generated theme
grain remains approximate.
