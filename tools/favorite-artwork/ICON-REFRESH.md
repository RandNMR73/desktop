# Retain updated pinned-page artwork

Direct Arc testing on 2026-11-03 shows Calendar keep its refreshed day-3 icon after Cmd-W. The installed Zen baseline restores its imported day-18 icon. Its compiled close preference is `reset-unload-switch`; the getter fallback `switch` is not the effective preference.

Remember valid favicon changes from the canonical pinned page, ignoring fragments. Preserve the pinned address/title, custom artwork and images from other destinations. A custom icon, pending mirror, missing icon or browser error icon cannot replace this saved website artwork. No Calendar-specific date rule is used.

Gecko calls the Zen icon hook before updating the image attribute. Carry the new icon in the event payload so other windows receive the current value, including explicit clearing. This also avoids copying a process-local remote-SVG rendering URL as the favicon source.

The real-page browser regression covers three windows, custom artwork, missing/error icons, navigation to another path, reset/unload, all five Spaces and two full process restarts. PNG and SVG favicons are exercised; compare decoded SVG source identities because rendering URLs are process-specific. Native app-artwork and saved-fallback checks remain green. Full Arc parity and the performance target remain unfinished.
