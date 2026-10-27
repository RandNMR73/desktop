# Optional native Space material

This bundle-local macOS renderer keeps the imported theme's negative
extended-sRGB channels in an RGBA16Float Metal surface. The existing PNG
theme path clips those values. The surface sits below Gecko's ChildView,
has no hit testing or accessibility children, and does not change the
website compositor or color-management preferences.

The Astralforge companion tool builds the signed dylib, shader and theme-only
resources from the imported Arc snapshot:

```sh
python3 tools/zen-bench/build_native_theme_runtime.py \
  --desktop /absolute/path/to/desktop \
  --output /absolute/path/to/new-native-theme-bundle
```

Run that command from Astralforge. Its installer copies the library to
`Contents/MacOS/libzen-native-theme.dylib` and the resource directory to
`Contents/Resources/zen-native-theme`, before signing the staged application.
The two `ZenNativeTheme*` modules are exported by `src/zen/spaces/moz.build`.
Without the optional bundle, ordinary builds retain the existing CSS theme.
The shader is shared with `../native-theme-proof/theme.metal`.

The renderer matches an imported Space ID and its complete normalized Zen
theme. Only picker-coordinate metadata is ignored. Changed, new, private,
unsynced, unsupported-appearance and accessibility-restricted windows retain
CSS. Native resources are checked for types, dimensions, finite channel values,
alpha, file size and symlinks. Allocation is bounded and shared across windows.
Unsupported native host layouts also fall back instead of inserting into an
unknown view hierarchy.

CSS stays visible until a matching GPU command completes. Readiness checks use
animation frames only during theme/window invalidation, with a two-second
deadline, then stop. Close, stale requests, errors and shutdown restore CSS.
The view is paused and redraws on invalidation. Asynchronous ctypes callbacks
must not be used: they crashed Gecko's JavaScript runtime in an isolated test.
The dylib remains loaded for the process lifetime because Objective-C class
registrations outlive individual views.

Validation includes `node --test scripts/tests/native-theme*.test.mjs`, the real
native resource validator (`check-resources.m` with `test_resources.py`), and
native app captures. Five matched blank-sidebar sample sets improved, most
strongly Main Space (mean channel error 10.73 to 0.64 on a 0–255 scale).
The generated grain is approximate. These samples do not certify pixel parity,
hover parity, native inactive materials, or faster overall browsing. A separate
page fixture found a pre-existing Display P3 CSS rendering difference from Arc;
the new background layer preserves the installed Zen page colors unchanged.
