# Additional discretionary-hyphen references

The six lossless screenshots were captured from native Arc through its DevTools
full-size screenshot command, at DPR 2. The owned comparison page records loaded
fonts, case, role, viewport, and frame bounds. The original provisional manifest
and all three proposals are preserved unchanged.

`verify.py` rechecks capture hashes, pixel differences, bounds, nonblank tiles,
and fixture hashes. The blur and underline pairs match Arc exactly in all 16
tiles. The RTL pair differs by 947 pixels in seven tiles; it is an invalid
reference and is not an acceptance test.

The candidate below is source `1e8bc767f3930b1fbfdd2ee9b7341b80681c299b`,
engine SHA-256 `3cd2c57da9ae3f5f67f85e5ea4d9491e0e3ba5b03ff45914e3d794566b1b80ac`.
Both owned headless test processes completed normally and confirmed that engine
was loaded. Default color mode, DPR 2:

| Case | Compositor differing pixels | Software differing pixels | Status |
| --- | ---: | ---: | --- |
| Blurred hyphens | 12 | 1,074 | Fails valid Arc reference |
| Underlined hyphens | 2,832 | 2,832 | Fails valid Arc reference |
| RTL hyphens | 0 | 0 | Diagnostic only; reference fails Arc |

Zero tolerance is retained. These failures are separate from the passing
80-tile matrix and prevent installation of this candidate. A self-matching
candidate RTL pair is not evidence of Arc parity. The test harness used the
same fixture bytes, promoted only blur/underline to required checks, and
recorded the reference report hash in each run.
