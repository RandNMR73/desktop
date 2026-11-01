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
ordinary unsynced, unsupported-appearance and accessibility-restricted windows retain
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

An optional, separately ticketed floating sidebar surface is documented in
[NATIVE-SIDEBAR.md](NATIVE-SIDEBAR.md). Its controller is not enabled by default;
the ABI and native rendering are being validated in disposable profiles.

Little windows can select a separate `role: little` resource. This requires
both the internal Little flag and document role, a nonprivate window, a matching
appearance, and the optional `zen_theme_material_version()` capability (1).
The resource is not added to the Space lookup. Changing the main window's
destination Space therefore does not repaint Little. Older libraries retain
Little's CSS fallback. The same first-frame and accessibility guards apply.

Resources may specify `material: light` or `dark`; absent metadata keeps the
existing legacy Light/Aqua material. Dark uses legacy Dark/Dark Aqua. The
companion builder currently supplies Arc's built-in dark Little gradient:
Display P3 `01021E` and `17011E`, intensity 0.8, no overlay or grain. Its values
are converted to extended sRGB before field generation. The toolbar and empty
search window reveal this native surface after readiness; the optional panel
material described below supplies the fresh search panel fill. Light Little appearance remains unvalidated.
Native inspection plus five-Space lifecycle checks establish this
bounded correction, not full-window pixel parity or overall speed superiority.

Fresh Little panels optionally synchronize a separate Core Animation shadow
through `zen_little_shadow_sync`: black, opacity 0.5, radius 48 points and a
24-point downward offset. These are native layer values from the installed Arc
reference, not CSS blur values. The shadow sits above the native theme and below
Gecko, follows the actual panel rectangle and scaled corner radius, and clips
to the window. Short result lists expose its falloff over the gradient.

The existing Little resize/lifecycle hooks, inline style changes and finite
panel animations update geometry. Unchanged geometry does no layer work; idle
periods and destination-Space changes add neither shadow updates nor Metal
frames. Closing the panel, converting to a page, losing the Little role or
falling back clears it. Native validation requires the current window, ticket,
ready Little resource and bounded finite geometry. Older libraries remain
compatible. See `little-shadow-validation.json` for the five-Space checks and
the limits of the native visual comparison.

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

Existing engines register an optional `NSPopoverWillShowNotification` observer
through `zen_popover_observe_appearance`. Apple's [will-show notification](https://developer.apple.com/documentation/appkit/nspopover/willshownotification)
precedes display. The observer matches the notification's exact popover to one
Gecko `PopupWindow` in this process and copies its requested appearance before
AppKit renders it. It does not replace methods or delegates, poll, or call JS.
Registration is idempotent and removed at shutdown. Site controls await the
shared native loader before opening, and abandon a delayed request if its tab,
panel or window is no longer current.

Older bundles can use the optional `zen_popover_sync_appearance` ABI from
`ZenNativePopover.m`. It only considers this process's shown Gecko popovers,
requires the supplied browser parent and matching content screen bounds, and
rejects ambiguous matches. It copies the backing appearance, including nil to
restore inheritance. There are no background timers. The site-control
handler runs after opening and positioning; a bounds mismatch gets one
animation-frame retry. Cold openings can report empty bounds at `popupshown`,
so `popuppositioned` also synchronizes after AppKit creates the visible surface.
This fallback alone can show a light surface before that event. The before-show
observer addresses that ordering without requiring a full engine rebuild.

An isolated signed candidate passed automatic appearance checks in all five
Spaces after a fresh launch. A full-screen capture made through the native
Screenshot UI confirms the dark translucent surface; app-only captures omit
this separate window. Wrong owner, wrong bounds, nonfinite input and empty
bounds fail without changing its appearance. See `popover-validation.json`.
`check-popover.m` exercises actual AppKit notifications, exact object identity,
light/dark/inherited appearance, ambiguity, background-thread rejection,
idempotent registration, removal and reinstall. JS tests cover loader fallback,
shutdown ordering and delayed opening. These checks do not certify frame-by-frame
visual parity, exact tint/shadow matching,
panel placement, hover behavior or overall browser speed.

## Fresh Little command panel material

The optional `zen_little_panel_version()` capability (1) extends the existing
Little geometry synchronization with an AppKit popover effect using within-window
blending, window-active state, no emphasis and Dark Aqua. A separate decoration
view places a 70% wash of RGB 0.065 above it, followed by a black 90% outer border
one backing pixel wide and a white 23% inner border one point wide. Continuous
corner curves follow the panel radius; the inner border uses radius minus one.
These functional settings were traced from the installed Arc reference.

Gecko reveals the material only after a successful current geometry request.
Old libraries, render failures, unsupported roles and accessibility fallback keep
the CSS fill. Closing or converting the panel clears both the native view and
its CSS handoff marker. The effect and decoration views have no interaction or
accessibility content; DOM controls retain keyboard handling and accessibility.
The existing finite geometry updates are reused, with no new polling.

Five-Space packaged tests cover shrinking/restoring results, idle counters,
destination changes, invalid requests, close/reopen and page conversion. Native
captures show the material and double border. A subsequent layout correction
removes the one-point panel inset, retains the half-point Retina divider in
flow, and uses a 264-point results viewport. The background now measures
490 by 328.5 points with five rows and 490 by 128.5 with one row, starting at
the window origin. Native material and shadow follow those fractional bounds.
See `little-panel-insets-validation.json` for the layout trace and five-Space
checks. The close accessory now uses the traced 16-point IcoMoon glyph and
a 24-point continuous-corner vector (radius 6), with GrayA4 dark fill at
7.7% opacity. The background stays steady on hover and press; the template
glyph brightens from 55% to 85% on press, matching an AppKit fixture using
the traced unbordered momentary-change button configuration. See
`little-close-button-validation.json` for provenance and five-Space checks.
The normal input magnifier now uses its own traced 14pt IcoMoon U+E9CC
resource centered in a 16pt view. The fresh Little input has a 52pt left
inset and 56pt right inset, leaving clearance before Close; scoped search
keeps its pill at x54. Its title uses the traced 13pt medium font with a
16pt line height. See `command-input-validation.json` for native layout
fixtures and five-Space checks.

The optional `zen_command_scope_metrics_version` / `zen_command_scope_metrics`
ABI measures the scoped label with AppKit's 13pt medium system font. It returns
the display-rounded alignment width, height and the actual OpenType weight
(510 on this macOS 26 installation). CSS weight 500 had slightly narrower
advances; rounding those advances alone gives the wrong width for several
labels. The DOM retains the text, accessibility, truncation and interaction.
Its width and font weight use these native metrics; missing or older native
libraries retain intrinsic CSS sizing. Requests are bounded and restricted to
the main thread. A 128-entry cache keys the label and display scale, and mode
generations prevent a late response from resizing a different scope. Ordinary
typing and same-scale window resizing do not remeasure text.

`check-scope-metrics.m` exercises the compiled ABI's invalid inputs, Unicode,
display scales and main-thread guard. Compile it with AppKit and pass the
bundle's dylib path. The configuration repository's
`smoke_site_search_metrics.py` compares actual settled DOM bounds against a
separate AppKit reference across five Spaces and six window contexts. Motion
can write an inline scale outside the Web Animations API, so the test waits for
that scale to return to identity before comparing bounds. This closes the
measured pill-width gap, including 73pt YouTube and 123.5pt Google Calendar on
the tested Retina display; it does not certify glyph rasterization equality.
Exact pixel parity, saturated CSS selection colors, light appearance and
main/loaded-page panels remain open work. See
`little-panel-material-validation.json` for evidence and limitations.

### Command typography

`command-typography-validation.json` traces the command input and result font paths. Default result titles and URLs use the 13pt base medium face; this supersedes the older 14pt claim. The large input uses its 18pt derivative and developer input uses the bundled OFL Inconsolata Medium 3.001 at 13pt. The exact unmodified font bytes and full license are embedded in `Inconsolata-Medium.css` so source builds and text-only installation overlays use the same resource.

The native medium weight is read once per process through the existing optional metrics API and installed once per window. There is no per-keystroke font measurement. Older native bundles keep CSS weight 500. Normal kerning reduces a measured placeholder advance difference to 0.12pt; glyph rasterization is not certified as identical.

### Command caret and selected text

The command caret uses the macOS system accent color, independently of input text. The five imported main Spaces use `SemanticColorPalette.subtitle` for selected text, retaining the input's glyph color. Arc's input-container publisher and inherited field-editor selection dictionary establish this mapping; `command-selection-validation.json` records the trace and limitations.

Gecko 158 requires an author-origin selection color declaration to paint it. A userChrome `::selection` rule can report the intended computed color while rendering the system highlight. Zen therefore owns the paint rule and the imported configuration supplies only palette variables. The default window palettes add no typing handlers or native calls. Fresh and loaded Little use the default subtitle palette, independently of the parent Space; see `little-selection-validation.json`.

Scoped searches derive selected-text colors from the scope's original sRGB or
Display P3 color through the optional version-1
`zen_command_selection_palette` ABI. The native calculation preserves the input
color space through HSL lightness adjustment and converts to extended sRGB for
the semantic subtitle blend. It returns dark and light colors; CSS chooses the
input's appearance. A registered property on the command bar resolves `calc()`
channels before the call. Its non-inherited value must be set on that element,
not only its result rows and scope indicator.

The 128-entry process cache avoids repeated native calculation. Scope generations
guard both icon lookup and palette completion, including A–B–A transitions;
leaving a scope clears its color immediately. Ordinary typing does not request a
palette. Older libraries and failed lookups retain the window palette.
`scope-reference.swift` independently calculates the reference fixtures;
`check-scope-selection.m` checks the compiled ABI, invalid inputs and thread
guard. `scope-selection-validation.json` records rendered-pixel validation and
remaining limits. Private selection colors, caret geometry/blink, full light
appearance and overall visual parity remain unfinished.
