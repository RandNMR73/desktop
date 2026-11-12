# Xray native methods with unrelated extension properties

This fixture runs in a temporary WebExtension content script, so DOM accesses
exercise Xray wrappers. Running the same JavaScript in the page does not test
the changed engine path.

The fixture checks method replacement on the owner, instance and intermediate
prototype, native-method aliases, accessors, deletion, custom instance and
intermediate prototypes, cross-realm function identity and a DOM proxy. A shared
lookup site exercises sixteen DOM interfaces before and after instance and owner
overrides, including native-function replacements. Properties that need mutation
are explicitly writable and configurable. Ordinary assignment to an Xray can
create a non-writable, non-configurable expando; silently failed assignments or
deletions would invalidate these cases.

The timing probe performs 48,000 `matches` calls over 1,600 elements of 16 distinct HTML
interfaces. It compares direct lookup, an unrelated `Element.prototype` property,
a cached copy of the same method and lookup after confirmed deletion. These
short timings diagnose the lookup path; they are not a browser benchmark.

## Run

Use a signed, owned copy of the candidate macOS app and the companion
Astralforge `tools/zen-bench` helpers. Do not reuse a real browsing profile.
The runner creates and removes its own profile, runs headlessly, checks its
profile and mapped engine identity, and preserves results and the browser log.
Run without a concurrent build or other timed workload.

```sh
python3 run.py --bench-root /path/to/Astralforge/tools/zen-bench \
  --manifest /path/to/candidate-app.json --output /path/to/new-result-directory
```

The JSON manifest requires `app` (owned `.app` path), `files` (relative app
paths mapped to SHA-256 hashes), and `installedFiles` (relative paths and hashes
for `/Applications/Zen.app`). Include the engine, launcher, native theme library,
both `omni.ja` files and update configuration. The installed app is only hashed;
the runner never writes to it or its profile. At least 256 MiB must be free;
the owned process stops below 128 MiB or if its profile exceeds 64 MiB.

`result.json` records exceptions as well as completed checks. A successful run
requires all 98 semantic checks and all 11 timing rows to pass. Preserve failed
runs instead of overwriting them.

## Validation status

The installed baseline engine passes all 98 checks. Both changed C++ files
pass syntax checks with the configured macOS compiler and apply cleanly to
the reconstructed upstream source. Candidate runtime correctness, the mixed
class speedup, the unchanged Svelte workload and the full native browser
benchmark remain required before merging or installing the optimization.

Native methods use the foldable DOM-class guard even with unrelated expandos.
Each entry retains the instance expando shape and each prototype's Xray and
expando shape. These references are traced; the guard checks default prototypes
and the target realm, and rejects invalidated shape wrappers. Actual method
overrides still fall back because their values can change without a shape change.
Getter eligibility is unchanged. The fixture checks distinct prototype identities;
sixteen different tag names alone would not establish sixteen DOM interfaces. The baseline's unrelated-property slowdown is
not evidence that the candidate fixes it.

## DOM proxy transition diagnostic

Add `--scenario proxy-transition` to run a separate diagnostic. Three independent
lookup sites process the same 1,600 native elements across sixteen interfaces.
Each site is timed before and after one read of a button, select, or form,
then after 64 additional trigger reads. The button is the unchanged control;
the native element set is identical in every timed row. No expando or prototype
mutation is performed. The default, broader fixture still includes form and
select interfaces and is not replaced by this control.

The transition scenario requires 50 checks and 39 timing rows. Three fresh baseline
processes show a sustained increase in subsequent native-only lookup time after
one select or form read, while the button control stays fast. This supports
investigating the generic proxy fallback at a mixed lookup site; it does not
prove the exact cache transition or any candidate speedup. The proposed engine
still needs runtime validation and the unchanged browser benchmark.
