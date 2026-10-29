# Optional native Space material

This bundle-local macOS renderer keeps the imported theme's negative
extended-sRGB channels in an RGBA16Float Metal surface. The existing PNG
theme path clips those values. The surface sits below Gecko's ChildView,
has no hit testing or accessibility children, and does not change the
website compositor or color-management preferences.

The imported light translucency uses AppKit's legacy `Light` material with
an Aqua appearance, active behind-window blending, and no emphasis. The
previous `HUDWindow` material brightened solid-color Spaces despite identical
RGBA16Float fields. A matched-size native comparison across five Spaces reduced
Stanford's sampled mean channel error from 1.255 to 0.156 and Exploration's
from 1.641 to 0.003 (0–255 RGB scale). The three textured Spaces retained small
differences; their generated grain is still approximate. The isolated proof
provides Light, HUD, and appearance-based material controls for comparison.

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

## Encoded PNG clipboard ABI

The optional library also exports `zen_clipboard_version()` (1) and
`zen_clipboard_copy_png(bytes, length)`. `ZenImageClipboard.sys.mjs` discovers it
once, keeps the library loaded, and falls back to Gecko if the ABI is absent.
The synchronous call copies the supplied ArrayBuffer into owned NSData; it has
no callback, deferred provider, file output or retained JavaScript pointer.

Only the browser's bounded, 8-bit RGB/RGBA canvas PNG is accepted. The native
writer checks framing, dimensions, chunk CRCs and static-image constraints before
changing the pasteboard; it deliberately does not decode arbitrary pixel streams.
It writes the original PNG bytes, allowing macOS to advertise its normal aliases
and convertible image types. A failed native write is reported rather than followed
by an unrequested second backend write. Return codes are 0 (success), 1 (invalid
input), 2 (wrong thread), and 3 (pasteboard failure).

Run these macOS checks against a private named pasteboard (they leave the general
clipboard alone):

```sh
xcrun clang -fobjc-arc -Wall -Wextra -Werror -Wno-unused-parameter \
  -framework AppKit tools/native-theme-runtime/ZenNativeClipboard.m \
  tools/native-theme-runtime/check-clipboard.m -lz -o /tmp/zen-check-clipboard
/tmp/zen-check-clipboard
```

Source tests cover backend caching/fallback, stale ownership during discovery and
failure propagation. Actual candidate/native paste checks and timing measurements
are recorded in `../developer-mode/image-clipboard-validation.json`. This capture
optimization does not change ordinary webpage image copying or certify general
Arc parity or performance superiority.

## Native site-control popover appearance

Gecko's backing `PopupWindow` can request Dark Aqua while its separate visible
`NSPopover` inherits Vibrant Light from the browser. The engine patch copies
the requested appearance to the popover both when it changes and before showing
it. That C++ patch applies without fuzz to the Firefox 158 reference, but has
not been compiled into a complete engine in this validation run.

Existing engines can use the optional `zen_popover_sync_appearance` ABI from
`ZenNativePopover.m`. It only considers this process's shown Gecko popovers,
requires the supplied browser parent and matching content screen bounds, and
rejects ambiguous matches. It copies the backing appearance, including nil to
restore inheritance. There are no hooks or background timers. The site-control
handler runs after opening and positioning; a bounds mismatch gets one
animation-frame retry. Cold openings can report empty bounds at `popupshown`,
so `popuppositioned` also synchronizes after AppKit creates the visible surface.
A cold-opening trace still shows a brief light surface before that event; the
unbuilt engine patch is needed to apply appearance before display.

An isolated signed candidate passed automatic appearance checks in all five
Spaces after a fresh launch. A full-screen capture made through the native
Screenshot UI confirms the dark translucent surface; app-only captures omit
this separate window. Wrong owner, wrong bounds, nonfinite input and empty
bounds fail without changing its appearance. See `popover-validation.json`.
These checks do not certify first-frame flicker, exact tint/shadow matching,
panel placement, hover behavior or overall browser speed.
