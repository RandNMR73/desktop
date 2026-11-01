The six 24pt SVGs are copied byte-for-byte from Astralforge’s
`config/zen/arc-icons/create-*.svg`; its manifest and builder reproduce them.

Space, Tab, Boost and Split use the template assets `add-space`, `add-tab`,
`boost_legacy` and `split-add-right` in Arc’s `ARC_SidebarPlusButton.bundle`.
All six images use the same native NSImageView export: preserving the 2x
source alpha and the compositor’s fractional placement also avoids the
edge softening caused by the former 3x-to-2x resampling.
The similarly named `space`, `tab` and `boost` assets are colored illustrations;
turning those into alpha masks produces incorrect filled silhouettes.
Folder and Easel use SF Symbols `folder` and `scribble` at 20pt medium.
Arc places an NSImageView with proportional-down scaling in a 24pt alignment
rectangle. AppKit's symbol alignment insets make its frame larger than that
rectangle; fitting a symbol's ink bounds directly to 24pt changes the glyph.
Astralforge's `sf-aligned` exporter preserves the native image's alpha and
placement, sampling its fractional frame with the compositor's bilinear rule.
The resulting 2x masks retain context-fill so menu foreground tint still works.
Comparisons recover alpha from each row’s own background and white foreground;
the highlighted New Tab row must not be thresholded as if its background were black.

Read-only inspection of Arc 1.171.0's native menu setup established the symbol
names, 20pt medium configuration, 24pt image alignment rectangle, 8pt label gap,
and 13pt medium system font. These are general layout properties, not per-icon
pixel offsets. The supplied 2x reference remains the visual comparison target.

The menu references these resources through its `image` attribute, which Gecko
forwards to the HTML image’s `srcset`. `list-style-image` on the parent does
not override that image. Artwork comparisons alone do not certify native
popup rendering or antialiasing at every display scale.
