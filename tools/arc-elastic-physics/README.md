# Experimental Mac elastic scrolling

The `apz.overscroll.arc_physics` preference is **off by default**. This change is
not ready to enable in a release. The engine integration and its eight APZ test
cases have compiled, but the integrated tests and browser comparisons have not
yet run.

The controller uses accumulated input force, a 10-point activation threshold,
5% resistance, and a quantized exponential return. It retains input velocity
across the first transition into momentum and starts the return clock at the
triggering native event. Native timing and backing scale travel with the pan
event, so Retina scale is distinct from browser zoom. Existing APZ handoff and
CSS overscroll restrictions still determine which scroll container can respond.

The standalone models are compared with the unchanged Chromium controller and
exponential implementation at revision
`a5de7e8894913ee20caf97ca5e0935a6ddf37e8c`. The headers under `controller-shim`
and `upstream-shim` supply small dependency interfaces for those reference
sources. They do not replace the reference gesture or exponential algorithms.
The input test also compares velocity calculations with the arithmetic
instruction sequence inspected in Arc 1.171.0's arm64 ArcCore 156.0.8078.74.
Its arm64-specific test is skipped on other architectures.

Run the standalone comparisons from the repository root:

```sh
python3 tools/arc-elastic-physics/validate.py
```

The script accepts `--cxx`, `--sysroot`, and `--output`. It writes temporary
binaries outside the repository and removes them afterward. These checks do
not establish browser or physical-trackpad parity. The engine tests are named
`ZenAPZArcElasticPhysics.*` and belong in a rebuilt `xul-gtest` library.

Before enabling the preference:

- Run the engine tests and existing overscroll/handoff regression suites.
- Verify real browser input, interruption, cancellation, scroll snap, layout
  changes, nested scrollers, display changes, and browser zoom.
- Finish handling rotated or reflected scroll containers, which currently use
  the original scrolling model.
- Compare Arc's native sidebar separately; Chromium's page controller does not
  prove that AppKit sidebar motion uses the same behavior.
- Confirm the installed Arc runtime setting for event-delta axis selection.
  Both source branches are tested by the standalone comparison.

The active local engine also contains pre-existing window-tiling and popover
changes absent from the source baseline. This patch leaves those local changes
untouched. Reconcile that source drift before claiming a reproducible release.

The adapted gesture controller carries the Chromium and Apple license notices
in its header. The reference source licenses are retained here as well.
