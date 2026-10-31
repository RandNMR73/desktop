# Developer Mode sidebar details

Developer sites now retain their host beneath the tab title. Their active row receives Arc's two-layer yellow/black outline. Ordinary tabs use the AppKit rounded path and width-dependent dashes; Favorites use a continuous SwiftUI corner and fixed 6-point dashes. Inactive rows retain the subtitle and hide the outline. Host labels use the system 11-point font and 14-point line height, with the measured half-opacity foreground asset.

The controller updates background tabs on top-level navigation and all stored Spaces when site settings change. One ResizeObserver updates enabled rows only, with no layout reads, polling or animation loop. Unchanged hosts and dimensions do not rewrite the DOM. Closing tabs and controller teardown release nodes and observations; private decisions keep the existing private setting scope.

Validation: 404 source tests pass; 63 packaged browser checks cover all five Spaces, resize breakpoints, Favorites, activation/deactivation, background navigation and tab closure. Another 17 checks cover controller teardown/recreation and private settings. Native inspection covers Zen's five Spaces and Favorite; the Arc reference was directly inspected for active/inactive ordinary rows in Main Space and Stanford. Favorite geometry is independently reproduced with owned SwiftUI Path fixtures and checked against all 18 path commands at three sizes.

This is a scoped visual correction. It does not certify full pixel parity, all hover/split/group combinations, wide-gamut rendering or a speed advantage over Arc. In particular, the preexisting changed-pin reset control still shifts the title horizontally and needs a separate regional-hover correction.
