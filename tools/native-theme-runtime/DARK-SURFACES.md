# Dark panel palette regression

Live theme updates selected tokens by the application appearance, while the
address editor, command rows and site-control panel explicitly use a dark color
scheme. Light application appearance consequently produced a near-white address
editor with white labels, pale selection colors, and dark text on the dark site
controls. These surfaces now use the current Space’s dark semantic palette in
both application appearances. Adaptive sidebar/Library icons retain light-dark
CSS tokens. No per-Space color table or new timers were added.

A headed before/after run found 46 mismatches against the previously imported Arc
CSS and contrast bounds before the correction, and none afterward. Sixteen cases
cover five saved Spaces and three edited primary colors in both appearances.
A real pointer click opened the 350×310-point editor; clearing its field showed
a white magnifier on an opaque rgb(15,42,50) Main Space background. The source
suite passes 769 tests, including appearance-independent control colors and no
redundant style writes on appearance-only changes.

The existing sidebar-panel six-percent lift remains a calibration. This change
restores the established colors; it does not certify the complete native panel
material, precise trackpad bounce, full Arc parity or browser-wide speed.
