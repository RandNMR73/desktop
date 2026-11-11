# RTL discretionary-hyphen reference, revision 2

The prior RTL reference in `../hyphen-variants/` did not match Arc. This
revision leaves the actual case and font unchanged. Its reference isolates
line stacking and places the hyphen behind the preceding foreground glyphs,
matching native Arc in all eight writing modes with zero pixel tolerance.
The actual capture also matches the prior actual capture inside the frame.

The two lossless PNGs were captured from native Arc at DPR 2. `verify.py`
rechecks their hashes, nonblank content, all eight tile comparisons and fixture
hashes. The complete frame has zero differing pixels.

`parent-validation.json` records the prior candidate
`1e8bc767f3930b1fbfdd2ee9b7341b80681c299b`: two of eight tiles match, with
920 differing pixels across the other six in default compositor capture.
The browser fixture completed and confirmed its engine hash. The outer probe
exit status was not recoverable after tool-output truncation; no exit code is
inferred. This corrected reference exposes a real candidate discrepancy;
matching the invalid earlier reference never established RTL parity.

Newer candidate results are recorded separately. This verifies a limited
rendering case, not complete browser or physical-display parity.
