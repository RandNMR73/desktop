# Native toast palette diagnostic

This standalone macOS app reconstructs the notification palette and native
material stack. It does **not** modify either browser, install an extension,
read browsing data, or implement the share action. It is a diagnostic, not a
browser feature or a claim of complete toast parity.

Input is a JSON object with `spaces`, each containing a `name` and `base` array
of extended-sRGB RGBA colors. Only base colors contribute to the flat toast
palette. Do not include tab URLs, cookies, or other profile data.

Compile with the installed Xcode SDK:

```sh
xcrun swiftc -parse-as-library -O ToastPaletteProbe.swift -o ToastPaletteProbe
./ToastPaletteProbe --dump-colors /absolute/path/to/palettes.json
python3 verify.py /absolute/path/to/ToastPaletteProbe
```

For the visual diagnostic, place that executable in a new `.app` bundle with
its own bundle identifier and `palettes.json` in `Contents/Resources`. Launch
that app through the desktop's normal application controls. The comparison
uses a black backdrop, matching the measured page region. Quit or close its
only window when finished.

The color path converts extended sRGB to Display P3, adjusts HSL saturation
and lightness, averages the transformed **base** components, then interprets
those component numbers as sRGB. That last reinterpretation is intentional.
The backdrop is an active, nonemphasized, within-window NSVisualEffectView
using raw material 1 (the legacy Light material), followed by the average color
at 80% opacity and a white or black vertical highlight. The native underlay is
necessary; a flat CSS tint cannot substitute for its backdrop behavior.

The October 27 comparison reduced Main Space's top color samples from an
8-level RGB-channel difference to 1 level. Bottom samples still differ by up
to 6 levels. Capture scaling, the share button's shadow, the outer border, and
the absence of the share accessory in this proof limit that comparison.
Other Space palettes have been computed, but their live Arc toast pixels have
not yet been verified. Hover, shadow, timing, accessibility, and browser
integration remain separate work.


## Runtime overlay probe

`RuntimeProbe.m` exercises the actual Objective-C implementation from
`../native-theme-runtime/ZenNativeToast.m` in a standalone black window. It
requires `themes.json` from a five-Space native bundle in the app's resources.
Compile both sources with AppKit, QuartzCore and ARC; use a new app bundle and
unique bundle identifier. It does not load into either browser.

The bottom controls select each imported palette, copy with or without Share,
start a two-second timeout, clear the notification, or read its diagnostic
status. The shared URL is only `http://127.0.0.1:62979/`. Open and cancel the
Share picker without choosing a recipient. Check the label at native scale,
Share removal, timeout, resize cleanup, and each color. This probe can expose
material/layer and text-layout defects, but cannot certify Gecko integration.
