# Selected discretionary hyphens

The fully selected plain-text fixture matches its literal-hyphen reference in
native Arc: all eight writing-mode tiles are pixel-identical at DPR 2. Captures
are lossless PNGs obtained through the DevTools full-size screenshot command in
an owned Incognito window. The original `accelerate` window was restored.

The current candidate (`1a3d792c5`) fails this new comparison in both software
and compositor capture: 180 different pixels across six of eight tiles. The
test verifies that selection setup has finished and retains the selected text
in the per-page JSON. Every process verifies the loaded engine. The two upright
modes pass. No tolerance has been relaxed.

The difference appears where the hyphen shadow overlaps preceding foreground
ink. Source inspection suggests that selection painting still combines the
generated hyphen with preceding text when drawing shadows, whereas the
ordinary-text path already handles it as a separate fragment. This diagnosis
needs implementation and verification.

The underline and partial custom-highlight proposals do not yet match Arc.
Their original differences are 686, 2,334, and 4,906 pixels. A second partial
reference excludes the literal hyphen from the highlight; this reduces the
plain and underlined differences to 44 and 252 pixels, respectively, but does
not validate either reference. Both versions and all original captures remain
diagnostics; they cannot be used as candidate acceptance criteria.

`selected-soft-hyphen.html` and its reference are the corresponding WPT pair.
They add an explicit reftest readiness barrier to the captured proposal; the
portable verifier checks that transformation and their hashes. Run:

```sh
uv run --no-project --with pillow python verify.py
```

This verifies the evidence and newly discovered failure, not rendering parity.
The production renderer is unchanged in this update. The candidate remains
uninstalled, and selected hyphens are now a confirmed open issue in addition to
the previously listed rendering and timing checks.
