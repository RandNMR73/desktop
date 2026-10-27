# Native theme rendering proof (macOS)

This standalone diagnostic compares three ways of drawing a translucent Space
background. It is **not integrated into Zen** and changes no browser profiles,
preferences, or app bundles. It makes no network requests.

Build it with the companion Astralforge tool:

```sh
python3 /path/to/Astralforge/tools/zen-bench/build_native_theme.py \
  --desktop /path/to/desktop \
  --output '/absolute/new/path/Arc Color Proof.app'
```

Open the output app in Finder. The default is an extended-sRGB, premultiplied
RGBA16Float Metal layer over an Aqua HUD material. Its shader multiplies the
grain into the translucent theme **before** the native material composition.
The controls also expose the older Display-P3 PNG and float CGImage paths,
alternative materials, and emphasis for comparison. The generated grain has
measured statistical properties; it is not Arc's bundled image.

The Metal view is paused and draws on invalidation. Its accessibility value
reports the number of submitted frames without a polling timer. Read this value,
leave the app idle, and read it again; changing a Space or resizing should submit
new frames. This checks idle redraw behavior, not overall browser performance.

For capture comparisons, activate each app through Finder first, match window
geometry, and verify screenshot dimensions, encoding and ICC metadata. Background
accessibility actions can change selection without refreshing the captured
window. Reject frozen images and captures from different color-profile paths.
The 2026-10-27 five-Space measurements are in Astralforge's validation report.

Remaining integration requirements include active/inactive material behavior,
appearance and accessibility settings, resize and display-scale changes, resource
ownership, tab-content transparency, and preserving web-page color management.
Do not turn off Gecko's native-sRGB color management to approximate this result.
