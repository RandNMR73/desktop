# Native copy-notification prototype

This branch is experimental and is not installed in regular Zen. The separately
merged Space handoff fix is the production build.

The AppKit implementation uses the independently verified notification palette,
a legacy Light within-window material, native text, a Share button and a child
panel. Gecko routes only the copy-URL notification through the optional ABI;
older bundles and unsupported windows use the existing DOM toast.

Compiled with warnings treated as errors. The source suite passes 219 tests,
including late localization, repeat-copy replacement and missing-native fallback.
In the isolated live app the native status and geometry report a visible panel
at the expected top-right bounds, but the CUA main-window capture does not include
it and the Share control has not been verified. Do not install or merge on the
strength of those counters. Native visibility, input, hover, sharing, animation,
all-Space comparison and accessibility still need direct validation. Consider
hosting the overlay as an AppKit sibling above Gecko if child-window capture or
input integration cannot be verified.

Private investigation files and screenshots are under the local validation
folder `native-copy-toast-2026-10-27`. No web screenshots or URL history are
included in this branch. The test app was reset to the handoff-only production
candidate; its name alone does not identify the experimental contents.
