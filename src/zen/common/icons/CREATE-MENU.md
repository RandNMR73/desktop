The six 24pt SVGs are copied byte-for-byte from Astralforge’s
`config/zen/arc-icons/create-*.svg`; its manifest and builder reproduce them.

Space, Tab, Boost and Split use the template assets `add-space`, `add-tab`,
`boost_legacy` and `split-add-right` in Arc’s `ARC_SidebarPlusButton.bundle`.
The similarly named `space`, `tab` and `boost` assets are colored illustrations;
turning those into alpha masks produces incorrect filled silhouettes.
Folder and Easel use SF Symbols `folder` and `scribble`, calibrated against
the supplied screenshot. Their exact shape parity remains unverified.

The menu references these resources through its `image` attribute, which Gecko
forwards to the HTML image’s `srcset`. `list-style-image` on the parent does
not override that image. Artwork comparisons alone do not certify native
popup rendering or antialiasing at every display scale.
