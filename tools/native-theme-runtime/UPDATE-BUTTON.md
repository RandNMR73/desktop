# Update action material

The optional `zen_update_button_version() == 1` capability paints the update
action with two blurred, rotating capsules over the Space's semantic color.
Light appearance uses `maxContrastColor`; dark uses `cutoutColor`. Achromatic
input uses the reference's Display P3 BrandBlue. Other colors, including
negative extended-sRGB channels, remain unchanged until native composition.
The material is derived from the Space palette, with no saved-Space lookup.

The first capsule uses hue +40°, saturation 5, additive brightness 1.25,
24-point blur and an eight-second rotation. The second uses hue −20°,
saturation 2, additive brightness −0.5, 12-point blur and a twenty-second
rotation in the other direction. Both use hard-light blending. Group opacity
is 0.5; the second color has alpha 0.6. These are the independent SwiftUI
reconstruction's values, traced read-only from the reference executable.

The bounded JSON request supplies color, geometry, label and presentation
state. Window handles must identify an existing AppKit window. A floating
sidebar additionally requires one matching owned PopupWindow. The decorative
view sits inside ChildView so Gecko's accessibility bridge keeps its original
hierarchy. Native paint never accepts hits or accessibility focus. The DOM
button retains its label, keyboard handling and update action.

Opening clips to the visible action area. Collapse, idle state, unsupported
geometry, high contrast and window teardown remove native paint. Reduced motion
uses a static initial phase. Updates are event-driven; identical requests are
native no-ops, and there is no JavaScript frame loop for the rotating material.
Finite sidebar reveal and pin animations temporarily synchronize geometry each
frame, including partially offscreen action bounds.
Older runtimes retain the CSS fallback and its existing sRGB limitations.

Build the runtime with Astralforge's `build_native_theme_runtime.py`. Run the
native ownership, geometry and input checks on macOS with:

```sh
swiftc -warnings-as-errors tools/native-theme-runtime/ZenNativeUpdateButton.swift \
  tools/native-theme-runtime/TestUpdateButton.swift -o /tmp/zen-update-button-check
/tmp/zen-update-button-check
```

`update-button-validation.json` records the five-Space initial-phase comparison,
browser lifecycle checks and remaining limits. It does not certify complete
Arc parity, every animated frame, or overall browser speed.
