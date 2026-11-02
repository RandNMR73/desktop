# Live P3 theme rendering (draft)

Previously an edit stopped matching the bundled theme key, removed the native
surface and exposed Zen's old CSS gradient. The optional
`zen_theme_dynamic_version()` / `zen_theme_apply_colors()` capability now keeps
precise P3 color-pad themes in the native renderer, including new Spaces that
have no bundled resource index. Custom CSS and unsupported themes retain their
existing fallback. Private/accessibility/host guards still apply.

The browser sends one to three P3 colors, intensity, noise, texture and renderer
appearance. A bounded native parser validates the request. AppKit converts the
colors to extended sRGB without clipping, and the CPU supplies three OKLab
stops. The shader evaluates Arc's base axis, linear-light overlay, gamma-space
underlay and premultiplied grain directly. It does not allocate or upload a
new full gradient texture for each pointer event.

The existing request ticket and first-frame activation policy also owns live
edits. The last completed native frame stays visible until the new one is ready;
stale completions cannot activate another Space. Identical requests do no work,
and the paused renderer has no idle redraw loop. Libraries without the optional
capability continue to use CSS for edited themes. Copy notifications currently
use their existing DOM fallback for live themes, since native notification
palettes are still indexed by bundled resources.

## Validation

`TestDynamicTheme.m` renders into offscreen Metal textures. It never attaches
to either browser or captures a window. `test_dynamic_theme.py` compares the
result with Astralforge's independent Python Arc equations, using AppKit's
converted input values. It checks 72 cases and 648 pixel samples: one/two/three
colors, saturated and neutral colors, dark/light underlays, tall/wide geometry,
intensity/noise variations and both 32-bit and production 16-bit float targets.
Ten invalid requests are rejected. Maximum channel errors are `1.63e-6` in
32-bit output and `0.000489` in 16-bit output.

Build and run the offscreen check on macOS:

```sh
xcrun metal -c tools/native-theme-proof/theme.metal -o /tmp/zen-dynamic.air
xcrun metallib /tmp/zen-dynamic.air -o /tmp/zen-dynamic.metallib
xcrun clang -fobjc-arc -Wall -Wextra -Werror -framework AppKit -framework Metal \
  tools/native-theme-runtime/TestDynamicTheme.m tools/native-theme-runtime/ZenDynamicTheme.m \
  -o /tmp/zen-test-dynamic
python3 tools/native-theme-runtime/test_dynamic_theme.py \
  --binary /tmp/zen-test-dynamic --metallib /tmp/zen-dynamic.metallib \
  --config /absolute/path/to/Astralforge
```

An owned headed browser fixture keeps the native surface visible through edits
and saving in all five Spaces. Each 20-event synchronous edit batch submits one
native frame and adds no idle frames. P3 persistence and ten harmony/reopen
cases also pass. These are programmatic DOM events, not a measurement of a
physical drag or sustained real-time pointer performance. Native CUA captures
confirm the changed theme appears in the browser window.

## Global appearance

Native selection now observes `zen.view.window.scheme`: explicit Light and
Dark override the system, while Automatic follows its media query. The observer
is removed when the window closes. An unchanged imported Space uses its exact
bundled texture in the bundle's appearance; the opposite appearance is rendered
from its original bundled P3 metadata. Metadata is accepted only for a matching
Space UUID and complete theme key. Edited/new Spaces use their own P3 values.
No appearance change rewrites the theme.

The dynamic identity includes appearance. Equivalent choices reuse the same
completed frame, and a real change retains that frame until its replacement is
ready. Older libraries and missing/invalid metadata retain CSS. Little's native
material is still selected only when the requested appearance matches its bundle.

This checkpoint passes 669 source tests; three regression cases fail against
the preceding source. The owned browser passes 60 cases: five Spaces, original
and edited colors, two simulated system appearances, and Light/Dark/Automatic.
Native surfaces stay visible and equivalent/idle refreshes add no frames. Two
windows showing different Spaces also retain native backgrounds while preserving
an inactive-Space edit. Native CUA captures inspect Light and Dark in Main Space;
they are different captures, not proof of complete Arc pixel parity.

An additional offscreen check uses all five imported palettes in both appearances
and both float formats: 20 cases/180 samples. Maximum errors against independent
Arc equations are `6.20e-7` (32-bit) and `0.000484` (16-bit). This supplements the
broader shader matrix above; the native shader implementation is unchanged.

## Remaining work

This is not installed and does not establish exact Arc window pixels or speed
superiority. The editor layout, controls, presets, handle motion/shadows,
semantic UI palettes and physical interaction need further work. Existing
grain statistics remain an approximation; the other texture names currently
adjust strength over the same generated tile. The browser-wide performance
comparison remains outstanding.
